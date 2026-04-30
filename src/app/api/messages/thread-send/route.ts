// POST /api/messages/thread-send
//
// Отправка сообщения по существующему ChatThread из inbox.
// В отличие от /api/messages/lead-send этот endpoint не требует leadId —
// resolver вытаскивает kind/account из самого thread'а.
//
// Inbox оперирует thread'ами а не лидами, и не всегда у thread'а есть leadId
// (новый клиент без созданного лида).
//
// Request:  { threadId, body, mediaUrl? }
// Response: { ok: boolean, error? }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { whatsappAccountFilter } from '@/lib/permissions';
import { checkRateLimit } from '@/lib/rate-limit';
import { workerSendMessage } from '@/lib/whatsapp';
import { sendMessage as sendTelegramMessage } from '@/lib/telegram';
import { sendViberText } from '@/lib/viber';
import { sendMessengerText, sendInstagramText } from '@/lib/meta';
import { revalidatePath } from 'next/cache';

const SEND_MAX       = 30;
const SEND_WINDOW_MS = 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!checkRateLimit(`msg-send:${user.id}`, SEND_MAX, SEND_WINDOW_MS)) {
      return NextResponse.json({ ok: false, error: 'Слишком много сообщений. Подождите минуту.' }, { status: 429 });
    }

    const payload = await req.json().catch(() => ({}));
    const { threadId, body: msgBody, mediaUrl } = payload as {
      threadId?: string; body?: string; mediaUrl?: string;
    };
    if (!threadId || !msgBody?.trim()) {
      return NextResponse.json({ ok: false, error: 'threadId и body обязательны' }, { status: 400 });
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

    // Роутим по channel самого thread'а
    switch (thread.channel) {
      case 'WHATSAPP': return await sendWa(user, thread, msgBody, mediaUrl);
      case 'TELEGRAM': return await sendTg(user, thread, msgBody);
      case 'VIBER':    return await sendViber(user, thread, msgBody);
      case 'MESSENGER':
      case 'INSTAGRAM': return await sendMeta(user, thread, msgBody);
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

async function sendWa(
  user: { id: string; role: string },
  thread: ThreadCtx,
  msgBody: string,
  mediaUrl?: string,
) {
  if (!thread.whatsappAccountId) {
    return NextResponse.json({ ok: false, error: 'У треда нет WhatsApp канала' }, { status: 400 });
  }
  const account = await db.whatsappAccount.findFirst({
    where: { id: thread.whatsappAccountId, isActive: true, ...whatsappAccountFilter(user as Parameters<typeof whatsappAccountFilter>[0]) },
  });
  if (!account)             return NextResponse.json({ ok: false, error: 'Канал недоступен' }, { status: 403 });
  if (!account.isConnected) return NextResponse.json({ ok: false, error: `Канал «${account.label}» не подключён` }, { status: 400 });

  const phone = thread.client?.phone || (thread.externalId ? `+${thread.externalId}` : null);
  if (!phone) return NextResponse.json({ ok: false, error: 'Нет номера получателя' }, { status: 400 });

  const result = await workerSendMessage(account.id, phone, msgBody, mediaUrl);
  if (result.ok) {
    await db.$transaction([
      db.chatMessage.create({
        data: {
          threadId: thread.id, whatsappAccountId: account.id,
          direction: 'OUT', type: mediaUrl ? 'DOCUMENT' : 'TEXT',
          body: msgBody, mediaUrl: mediaUrl ?? null,
          externalId: result.messageId ?? null, senderId: user.id,
        },
      }),
      db.chatThread.update({
        where: { id: thread.id },
        data: { lastMessageAt: new Date(), lastMessageText: msgBody.slice(0, 200) },
      }),
    ]);
    revalidatePath('/inbox');
  }
  return NextResponse.json(result);
}

async function sendTg(user: { id: string }, thread: ThreadCtx, msgBody: string) {
  if (!thread.telegramAccountId || !thread.externalId) {
    return NextResponse.json({ ok: false, error: 'Нет Telegram канала или chat_id' }, { status: 400 });
  }
  const account = await db.telegramAccount.findFirst({
    where: { id: thread.telegramAccountId, isActive: true },
    select: { id: true, botToken: true, isConnected: true, label: true },
  });
  if (!account)             return NextResponse.json({ ok: false, error: 'Канал недоступен' }, { status: 403 });
  if (!account.isConnected) return NextResponse.json({ ok: false, error: `Канал «${account.label}» не подключён` }, { status: 400 });

  const sent = await sendTelegramMessage(account.botToken, thread.externalId, msgBody);
  await db.$transaction([
    db.chatMessage.create({
      data: {
        threadId: thread.id, telegramAccountId: account.id,
        direction: 'OUT', type: 'TEXT', body: msgBody,
        externalId: `${sent.message_id}`, senderId: user.id,
        createdAt: new Date(sent.date * 1000),
      },
    }),
    db.chatThread.update({
      where: { id: thread.id },
      data: { lastMessageAt: new Date(), lastMessageText: msgBody.slice(0, 200) },
    }),
  ]);
  revalidatePath('/inbox');
  return NextResponse.json({ ok: true });
}

async function sendViber(user: { id: string }, thread: ThreadCtx, msgBody: string) {
  if (!thread.viberAccountId || !thread.externalId) {
    return NextResponse.json({ ok: false, error: 'Нет Viber канала или receiver_id' }, { status: 400 });
  }
  const account = await db.viberAccount.findFirst({ where: { id: thread.viberAccountId, isActive: true } });
  if (!account)             return NextResponse.json({ ok: false, error: 'Канал недоступен' }, { status: 403 });
  if (!account.isConnected) return NextResponse.json({ ok: false, error: `Канал «${account.label}» не подключён` }, { status: 400 });

  const res = await sendViberText(account, thread.externalId, msgBody);
  if (res.status !== 0) {
    return NextResponse.json({ ok: false, error: `Viber отверг: ${res.status_message}` }, { status: 400 });
  }
  await db.$transaction([
    db.chatMessage.create({
      data: {
        threadId: thread.id, viberAccountId: account.id,
        direction: 'OUT', type: 'TEXT', body: msgBody,
        externalId: res.message_token ? String(res.message_token) : null,
        senderId: user.id,
      },
    }),
    db.chatThread.update({
      where: { id: thread.id },
      data: { lastMessageAt: new Date(), lastMessageText: msgBody.slice(0, 200) },
    }),
  ]);
  revalidatePath('/inbox');
  return NextResponse.json({ ok: true });
}

async function sendMeta(user: { id: string }, thread: ThreadCtx, msgBody: string) {
  if (!thread.metaAccountId || !thread.externalId) {
    return NextResponse.json({ ok: false, error: 'Нет Meta канала или recipient_id' }, { status: 400 });
  }
  const account = await db.metaAccount.findFirst({ where: { id: thread.metaAccountId, isActive: true } });
  if (!account)             return NextResponse.json({ ok: false, error: 'Канал недоступен' }, { status: 403 });
  if (!account.isConnected) return NextResponse.json({ ok: false, error: `Канал «${account.label}» не подключён` }, { status: 400 });

  const send = thread.channel === 'INSTAGRAM' ? sendInstagramText : sendMessengerText;
  const res  = await send(account, thread.externalId, msgBody);
  if (res.error) {
    return NextResponse.json({ ok: false, error: `Meta отверг: ${res.error.message}` }, { status: 400 });
  }
  await db.$transaction([
    db.chatMessage.create({
      data: {
        threadId: thread.id, metaAccountId: account.id,
        direction: 'OUT', type: 'TEXT', body: msgBody,
        externalId: res.message_id ?? null, senderId: user.id,
      },
    }),
    db.chatThread.update({
      where: { id: thread.id },
      data: { lastMessageAt: new Date(), lastMessageText: msgBody.slice(0, 200) },
    }),
  ]);
  revalidatePath('/inbox');
  return NextResponse.json({ ok: true });
}
