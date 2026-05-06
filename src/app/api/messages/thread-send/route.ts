// POST /api/messages/thread-send
//
// Отправка сообщения по существующему ChatThread из inbox.
// В отличие от /api/messages/lead-send этот endpoint не требует leadId —
// resolver вытаскивает kind/account из самого thread'а.
//
// 06.05.2026 — пункты #4 и #5 аудита:
//   - permission filters для всех 4 каналов (защита от писать через чужой канал)
//   - decrypt() для токенов перед отправкой (TG/Viber/Meta хранятся зашифрованно)

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import {
  whatsappAccountFilter,
  telegramAccountFilter,
  viberAccountFilter,
  metaAccountFilter,
} from '@/lib/permissions';
import { checkRateLimit } from '@/lib/rate-limit';
import { workerSendMessage } from '@/lib/whatsapp';
import { sendMessage as sendTelegramMessage } from '@/lib/telegram';
import { sendViberText } from '@/lib/viber';
import { sendMessengerText, sendInstagramText } from '@/lib/meta';
import { signMediaUrlForWorker } from '@/lib/storage/media-token';
import { decrypt } from '@/lib/crypto';
import { revalidatePath } from 'next/cache';

const SEND_MAX       = 30;
const SEND_WINDOW_MS = 60 * 1000;

type MediaTypeStr = 'IMAGE' | 'DOCUMENT';

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!checkRateLimit(`msg-send:${user.id}`, SEND_MAX, SEND_WINDOW_MS)) {
      return NextResponse.json({ ok: false, error: 'Слишком много сообщений. Подождите минуту.' }, { status: 429 });
    }

    const payload = await req.json().catch(() => ({}));
    const { threadId, body: msgBody, mediaUrl, mediaName, mediaType } = payload as {
      threadId?: string;
      body?: string;
      mediaUrl?: string;
      mediaName?: string;
      mediaType?: MediaTypeStr;
    };

    const cleanBody = msgBody?.trim() ?? '';
    const hasText   = cleanBody.length > 0;
    const hasMedia  = !!mediaUrl;

    if (!threadId || (!hasText && !hasMedia)) {
      return NextResponse.json({ ok: false, error: 'threadId и body или файл обязательны' }, { status: 400 });
    }

    const thread = await db.chatThread.findUnique({
      where: { id: threadId },
      select: {
        id: true, channel: true, externalId: true,
        whatsappAccountId: true, telegramAccountId: true,
        viberAccountId:    true, metaAccountId:     true,
        client: { select: { phone: true } },
      },
    });
    if (!thread) return NextResponse.json({ ok: false, error: 'Thread не найден' }, { status: 404 });

    const ctx = { user, thread, msgBody: cleanBody, mediaUrl, mediaName, mediaType };

    switch (thread.channel) {
      case 'WHATSAPP': return await sendWa(ctx);
      case 'TELEGRAM': return await sendTg(ctx);
      case 'VIBER':    return await sendViber(ctx);
      case 'MESSENGER':
      case 'INSTAGRAM': return await sendMeta(ctx);
      default:
        return NextResponse.json({ ok: false, error: `Канал ${thread.channel} не поддерживает отправку` }, { status: 400 });
    }
  } catch (e) {
    const status = (e as Error & { statusCode?: number }).statusCode ?? 500;
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status });
  }
}

type ThreadCtx = {
  id: string; channel: string; externalId: string | null;
  whatsappAccountId: string | null; telegramAccountId: string | null;
  viberAccountId: string | null; metaAccountId: string | null;
  client: { phone: string } | null;
};

type SendCtx = {
  user: { id: string; email: string; name: string; role: 'ADMIN' | 'SALES' | 'LEGAL' };
  thread: ThreadCtx;
  msgBody: string;
  mediaUrl?: string;
  mediaName?: string;
  mediaType?: MediaTypeStr;
};

function makePreview(ctx: { msgBody: string; mediaName?: string; mediaType?: MediaTypeStr }): string {
  if (ctx.msgBody) return ctx.msgBody.slice(0, 200);
  const icon = ctx.mediaType === 'IMAGE' ? '🖼' : '📎';
  return `${icon} ${ctx.mediaName ?? 'Файл'}`;
}

function messageType(ctx: { mediaUrl?: string; mediaType?: MediaTypeStr }): 'TEXT' | 'IMAGE' | 'DOCUMENT' {
  if (!ctx.mediaUrl) return 'TEXT';
  return ctx.mediaType ?? 'DOCUMENT';
}

async function sendWa(ctx: SendCtx) {
  const { user, thread, msgBody, mediaUrl, mediaName } = ctx;
  if (!thread.whatsappAccountId) {
    return NextResponse.json({ ok: false, error: 'У треда нет WhatsApp канала' }, { status: 400 });
  }
  const account = await db.whatsappAccount.findFirst({
    where: { id: thread.whatsappAccountId, isActive: true, ...whatsappAccountFilter(user) },
  });
  if (!account)             return NextResponse.json({ ok: false, error: 'Канал недоступен' }, { status: 403 });
  if (!account.isConnected) return NextResponse.json({ ok: false, error: `Канал «${account.label}» не подключён` }, { status: 400 });

  const phone = thread.client?.phone || (thread.externalId ? `+${thread.externalId}` : null);
  if (!phone) return NextResponse.json({ ok: false, error: 'Нет номера получателя' }, { status: 400 });

  let workerMediaUrl: string | undefined;
  if (mediaUrl) {
    try {
      workerMediaUrl = signMediaUrlForWorker(mediaUrl);
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
    }
  }

  const result = await workerSendMessage(account.id, phone, msgBody, workerMediaUrl);
  if (result.ok) {
    await db.$transaction([
      db.chatMessage.create({
        data: {
          threadId: thread.id, whatsappAccountId: account.id,
          direction: 'OUT',
          type: messageType(ctx),
          body: msgBody || null,
          mediaUrl: mediaUrl ?? null,
          mediaName: mediaName ?? null,
          externalId: result.messageId ?? null, senderId: user.id,
        },
      }),
      db.chatThread.update({
        where: { id: thread.id },
        data: { lastMessageAt: new Date(), lastMessageText: makePreview(ctx) },
      }),
    ]);
    revalidatePath('/inbox');
  }
  return NextResponse.json(result);
}

async function sendTg(ctx: SendCtx) {
  const { user, thread, mediaUrl, mediaName } = ctx;
  let { msgBody } = ctx;
  if (!thread.telegramAccountId || !thread.externalId) {
    return NextResponse.json({ ok: false, error: 'Нет Telegram канала или chat_id' }, { status: 400 });
  }
  const account = await db.telegramAccount.findFirst({
    where: { id: thread.telegramAccountId, isActive: true, ...telegramAccountFilter(user) },
    select: { id: true, botToken: true, isConnected: true, label: true },
  });
  if (!account)             return NextResponse.json({ ok: false, error: 'Канал недоступен' }, { status: 403 });
  if (!account.isConnected) return NextResponse.json({ ok: false, error: `Канал «${account.label}» не подключён` }, { status: 400 });

  if (mediaUrl) {
    msgBody = msgBody ? `${msgBody}\n${mediaUrl}` : `📎 ${mediaName ?? 'Файл'}\n${mediaUrl}`;
  }

  // Расшифровываем токен перед вызовом Telegram API
  const sent = await sendTelegramMessage(decrypt(account.botToken), thread.externalId, msgBody);
  await db.$transaction([
    db.chatMessage.create({
      data: {
        threadId: thread.id, telegramAccountId: account.id,
        direction: 'OUT',
        type: messageType(ctx),
        body: msgBody,
        mediaUrl: mediaUrl ?? null,
        mediaName: mediaName ?? null,
        externalId: `${sent.message_id}`, senderId: user.id,
        createdAt: new Date(sent.date * 1000),
      },
    }),
    db.chatThread.update({
      where: { id: thread.id },
      data: { lastMessageAt: new Date(), lastMessageText: makePreview({ ...ctx, msgBody }) },
    }),
  ]);
  revalidatePath('/inbox');
  return NextResponse.json({ ok: true });
}

async function sendViber(ctx: SendCtx) {
  const { user, thread, mediaUrl, mediaName } = ctx;
  let { msgBody } = ctx;
  if (!thread.viberAccountId || !thread.externalId) {
    return NextResponse.json({ ok: false, error: 'Нет Viber канала или receiver_id' }, { status: 400 });
  }
  const account = await db.viberAccount.findFirst({
    where: { id: thread.viberAccountId, isActive: true, ...viberAccountFilter(user) },
  });
  if (!account)             return NextResponse.json({ ok: false, error: 'Канал недоступен' }, { status: 403 });
  if (!account.isConnected) return NextResponse.json({ ok: false, error: `Канал «${account.label}» не подключён` }, { status: 400 });

  if (mediaUrl) {
    msgBody = msgBody ? `${msgBody}\n${mediaUrl}` : `📎 ${mediaName ?? 'Файл'}\n${mediaUrl}`;
  }

  // Расшифровываем authToken in-memory
  const decryptedAccount = { ...account, authToken: decrypt(account.authToken) };
  const res = await sendViberText(decryptedAccount, thread.externalId, msgBody);
  if (res.status !== 0) {
    return NextResponse.json({ ok: false, error: `Viber отверг: ${res.status_message}` }, { status: 400 });
  }
  await db.$transaction([
    db.chatMessage.create({
      data: {
        threadId: thread.id, viberAccountId: account.id,
        direction: 'OUT',
        type: messageType(ctx),
        body: msgBody,
        mediaUrl: mediaUrl ?? null,
        mediaName: mediaName ?? null,
        externalId: res.message_token ? String(res.message_token) : null,
        senderId: user.id,
      },
    }),
    db.chatThread.update({
      where: { id: thread.id },
      data: { lastMessageAt: new Date(), lastMessageText: makePreview({ ...ctx, msgBody }) },
    }),
  ]);
  revalidatePath('/inbox');
  return NextResponse.json({ ok: true });
}

async function sendMeta(ctx: SendCtx) {
  const { user, thread, mediaUrl, mediaName } = ctx;
  let { msgBody } = ctx;
  if (!thread.metaAccountId || !thread.externalId) {
    return NextResponse.json({ ok: false, error: 'Нет Meta канала или recipient_id' }, { status: 400 });
  }
  const account = await db.metaAccount.findFirst({
    where: { id: thread.metaAccountId, isActive: true, ...metaAccountFilter(user) },
  });
  if (!account)             return NextResponse.json({ ok: false, error: 'Канал недоступен' }, { status: 403 });
  if (!account.isConnected) return NextResponse.json({ ok: false, error: `Канал «${account.label}» не подключён` }, { status: 400 });

  if (mediaUrl) {
    msgBody = msgBody ? `${msgBody}\n${mediaUrl}` : `📎 ${mediaName ?? 'Файл'}\n${mediaUrl}`;
  }

  // Расшифровываем pageAccessToken in-memory
  const decryptedAccount = { ...account, pageAccessToken: decrypt(account.pageAccessToken) };
  const send = thread.channel === 'INSTAGRAM' ? sendInstagramText : sendMessengerText;
  const res  = await send(decryptedAccount, thread.externalId, msgBody);
  if (res.error) {
    return NextResponse.json({ ok: false, error: `Meta отверг: ${res.error.message}` }, { status: 400 });
  }
  await db.$transaction([
    db.chatMessage.create({
      data: {
        threadId: thread.id, metaAccountId: account.id,
        direction: 'OUT',
        type: messageType(ctx),
        body: msgBody,
        mediaUrl: mediaUrl ?? null,
        mediaName: mediaName ?? null,
        externalId: res.message_id ?? null, senderId: user.id,
      },
    }),
    db.chatThread.update({
      where: { id: thread.id },
      data: { lastMessageAt: new Date(), lastMessageText: makePreview({ ...ctx, msgBody }) },
    }),
  ]);
  revalidatePath('/inbox');
  return NextResponse.json({ ok: true });
}
