// POST /api/messages/lead-send
//
// Универсальный endpoint отправки сообщения из карточки лида —
// роутит по `kind` канала (WHATSAPP/TELEGRAM/VIBER/MESSENGER/INSTAGRAM).
//
// Заменяет /api/whatsapp/lead-send — WhatsApp обрабатывается через тот же
// worker как раньше, остальные каналы — через server actions.
//
// Request:  { leadId, kind, accountId, body?, mediaUrl?, mediaName?, mediaType? }
// Response: { ok: boolean, error?: string }
//
// Anna 04.05.2026: добавлена возможность отправлять файлы (mediaUrl/mediaName/
// mediaType). Тело сообщения теперь не обязательно если есть файл.
//
// 06.05.2026 — пункт #4 аудита: для всех 4 каналов добавлены permission
// filters. До этого SALES мог отправить через личный бот Anna зная её
// accountId — теперь fail с 403 «Канал недоступен».

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import {
  whatsappAccountFilter,
  telegramAccountFilter,
  viberAccountFilter,
  metaAccountFilter,
  canViewLead,
} from '@/lib/permissions';
import { checkRateLimit } from '@/lib/rate-limit';
import { workerSendMessage } from '@/lib/whatsapp';
import { sendMessage as sendTelegramMessage } from '@/lib/telegram';
import { sendViberText } from '@/lib/viber';
import { sendMessengerText, sendInstagramText } from '@/lib/meta';
import { signMediaUrlForWorker } from '@/lib/storage/media-token';
import { revalidatePath } from 'next/cache';

const SEND_MAX       = 30;
const SEND_WINDOW_MS = 60 * 1000;

type ChannelKindStr = 'WHATSAPP' | 'TELEGRAM' | 'VIBER' | 'MESSENGER' | 'INSTAGRAM';
type MediaTypeStr   = 'IMAGE' | 'DOCUMENT';

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!checkRateLimit(`msg-send:${user.id}`, SEND_MAX, SEND_WINDOW_MS)) {
      return NextResponse.json({ ok: false, error: 'Слишком много сообщений. Подождите минуту.' }, { status: 429 });
    }

    const payload = await req.json().catch(() => ({}));
    const { leadId, kind, accountId, body: msgBody, mediaUrl, mediaName, mediaType } = payload as {
      leadId?: string; kind?: ChannelKindStr; accountId?: string;
      body?: string; mediaUrl?: string; mediaName?: string; mediaType?: MediaTypeStr;
    };

    const cleanBody = msgBody?.trim() ?? '';
    const hasText   = cleanBody.length > 0;
    const hasMedia  = !!mediaUrl;

    if (!leadId || !kind || !accountId || (!hasText && !hasMedia)) {
      return NextResponse.json({ ok: false, error: 'leadId/kind/accountId и body или файл обязательны' }, { status: 400 });
    }

    const lead = await db.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true, clientId: true,
        salesManagerId: true, legalManagerId: true,
        client: { select: { id: true, phone: true } },
      },
    });
    if (!lead) return NextResponse.json({ ok: false, error: 'Лид не найден' }, { status: 404 });
    if (!canViewLead(user, lead)) {
      return NextResponse.json({ ok: false, error: 'Нет доступа к лиду' }, { status: 403 });
    }

    const ctx = { user, lead, accountId, msgBody: cleanBody, mediaUrl, mediaName, mediaType };

    // Роутим по типу канала
    switch (kind) {
      case 'WHATSAPP': return await sendWa(ctx);
      case 'TELEGRAM': return await sendTg(ctx);
      case 'VIBER':    return await sendViber(ctx);
      case 'MESSENGER':
      case 'INSTAGRAM': return await sendMeta({ ...ctx, channel: kind });
      default:
        return NextResponse.json({ ok: false, error: `Канал ${kind} не поддерживается` }, { status: 400 });
    }
  } catch (e) {
    const status = (e as Error & { statusCode?: number }).statusCode ?? 500;
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status });
  }
}

type SendCtx = {
  user: { id: string; email: string; name: string; role: 'ADMIN' | 'SALES' | 'LEGAL' };
  lead: { id: string; clientId: string; salesManagerId: string | null; legalManagerId: string | null; client: { phone: string | null } };
  accountId: string;
  msgBody: string;
  mediaUrl?: string;
  mediaName?: string;
  mediaType?: MediaTypeStr;
};

/** Превью для lastMessageText: текст или метка файла. Используется и в списке
 *  переписок и в уведомлениях — поэтому если только файл, ставим читаемое
 *  «📎 имя файла» а не пустую строку. */
function makePreview(ctx: SendCtx): string {
  if (ctx.msgBody) return ctx.msgBody.slice(0, 200);
  const icon = ctx.mediaType === 'IMAGE' ? '🖼' : '📎';
  return `${icon} ${ctx.mediaName ?? 'Файл'}`;
}

/** Тип ChatMessage.type: текст / документ / фото — с учётом того что для
 *  не-WA каналов файлы пока не отправляются. */
function messageType(ctx: SendCtx): 'TEXT' | 'IMAGE' | 'DOCUMENT' {
  if (!ctx.mediaUrl) return 'TEXT';
  return ctx.mediaType ?? 'DOCUMENT';
}

// ============ WHATSAPP ============

async function sendWa(ctx: SendCtx) {
  const { user, lead, accountId, msgBody, mediaUrl, mediaName } = ctx;
  if (!lead.client.phone) {
    return NextResponse.json({ ok: false, error: 'У клиента нет номера телефона' }, { status: 400 });
  }
  const account = await db.whatsappAccount.findFirst({
    where: { id: accountId, isActive: true, ...whatsappAccountFilter(user) },
  });
  if (!account)             return NextResponse.json({ ok: false, error: 'Канал недоступен' }, { status: 403 });
  if (!account.isConnected) return NextResponse.json({ ok: false, error: `Канал «${account.label}» не подключён` }, { status: 400 });

  let thread = await db.chatThread.findFirst({
    where: { clientId: lead.clientId, whatsappAccountId: account.id, channel: 'WHATSAPP' },
    select: { id: true },
  });
  if (!thread) {
    thread = await db.chatThread.create({
      data: {
        channel: 'WHATSAPP', clientId: lead.clientId, whatsappAccountId: account.id,
        externalPhoneNumber: lead.client.phone.replace(/^\+/, ''),
      },
      select: { id: true },
    });
  }

  // Worker — отдельный процесс без auth-сессии, ему нужен абсолютный URL
  // с подписанным mediaToken чтобы скачать файл из /api/files/uploads.
  // В БД сохраняем оригинальный относительный mediaUrl (без токена) —
  // токен через 5 мин истечёт, а relative path останется валиден всегда.
  let workerMediaUrl: string | undefined;
  if (mediaUrl) {
    try {
      workerMediaUrl = signMediaUrlForWorker(mediaUrl);
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
    }
  }

  const result = await workerSendMessage(account.id, lead.client.phone, msgBody, workerMediaUrl);
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
    revalidatePath(`/clients/${lead.id}`);
    revalidatePath('/inbox');
  }
  return NextResponse.json(result);
}

// ============ TELEGRAM ============
// Файлы пока не поддерживаем — отправляем как ссылку в тексте если приложили.

async function sendTg(ctx: SendCtx) {
  const { user, lead, accountId, mediaUrl, mediaName } = ctx;
  let { msgBody } = ctx;
  // 06.05.2026 — пункт #4 аудита: добавлен telegramAccountFilter.
  const account = await db.telegramAccount.findFirst({
    where: { id: accountId, isActive: true, ...telegramAccountFilter(user) },
    select: { id: true, botToken: true, isConnected: true, label: true },
  });
  if (!account)             return NextResponse.json({ ok: false, error: 'Канал недоступен' }, { status: 403 });
  if (!account.isConnected) return NextResponse.json({ ok: false, error: `Канал «${account.label}» не подключён` }, { status: 400 });

  const thread = await db.chatThread.findFirst({
    where: { clientId: lead.clientId, telegramAccountId: account.id, channel: 'TELEGRAM' },
    select: { id: true, externalId: true },
  });
  if (!thread || !thread.externalId) {
    return NextResponse.json({ ok: false, error: 'Клиент ещё не писал в Telegram' }, { status: 400 });
  }

  // Если приложен файл — в Telegram пока шлём как ссылку с подписью.
  // Это временное решение пока не реализована полная sendDocument интеграция.
  // Ссылка кликабельна только для залогиненных в CRM (auth required) —
  // клиент в Telegram открыть её не сможет. Это known limitation, фиксим
  // когда будем делать честную sendDocument интеграцию.
  if (mediaUrl) {
    const link = mediaUrl;
    msgBody = msgBody ? `${msgBody}\n${link}` : `📎 ${mediaName ?? 'Файл'}\n${link}`;
  }

  const sent = await sendTelegramMessage(account.botToken, thread.externalId, msgBody);
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
  revalidatePath(`/clients/${lead.id}`);
  revalidatePath('/inbox');
  return NextResponse.json({ ok: true });
}

// ============ VIBER ============
// То же — файлы как ссылка пока нет sendFile.

async function sendViber(ctx: SendCtx) {
  const { user, lead, accountId, mediaUrl, mediaName } = ctx;
  let { msgBody } = ctx;
  // 06.05.2026 — пункт #4 аудита: добавлен viberAccountFilter.
  const account = await db.viberAccount.findFirst({
    where: { id: accountId, isActive: true, ...viberAccountFilter(user) },
  });
  if (!account)             return NextResponse.json({ ok: false, error: 'Канал недоступен' }, { status: 403 });
  if (!account.isConnected) return NextResponse.json({ ok: false, error: `Канал «${account.label}» не подключён` }, { status: 400 });

  const thread = await db.chatThread.findFirst({
    where: { clientId: lead.clientId, viberAccountId: account.id, channel: 'VIBER' },
    select: { id: true, externalId: true },
  });
  if (!thread || !thread.externalId) {
    return NextResponse.json({ ok: false, error: 'Клиент ещё не писал в Viber' }, { status: 400 });
  }

  if (mediaUrl) {
    msgBody = msgBody ? `${msgBody}\n${mediaUrl}` : `📎 ${mediaName ?? 'Файл'}\n${mediaUrl}`;
  }

  const res = await sendViberText(account, thread.externalId, msgBody);
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
  revalidatePath(`/clients/${lead.id}`);
  revalidatePath('/inbox');
  return NextResponse.json({ ok: true });
}

// ============ META (Messenger / Instagram) ============
// То же — файлы как ссылка пока нет attachment API интеграции.

async function sendMeta(ctx: SendCtx & { channel: 'MESSENGER' | 'INSTAGRAM' }) {
  const { user, lead, accountId, mediaUrl, mediaName, channel } = ctx;
  let { msgBody } = ctx;
  // 06.05.2026 — пункт #4 аудита: добавлен metaAccountFilter.
  const account = await db.metaAccount.findFirst({
    where: { id: accountId, isActive: true, ...metaAccountFilter(user) },
  });
  if (!account)             return NextResponse.json({ ok: false, error: 'Канал недоступен' }, { status: 403 });
  if (!account.isConnected) return NextResponse.json({ ok: false, error: `Канал «${account.label}» не подключён` }, { status: 400 });

  if (channel === 'INSTAGRAM' && !account.hasInstagram) {
    return NextResponse.json({ ok: false, error: 'Instagram не подключён к этой Page' }, { status: 400 });
  }

  const thread = await db.chatThread.findFirst({
    where: { clientId: lead.clientId, metaAccountId: account.id, channel },
    select: { id: true, externalId: true },
  });
  if (!thread || !thread.externalId) {
    return NextResponse.json({ ok: false, error: `Клиент ещё не писал в ${channel === 'INSTAGRAM' ? 'Instagram' : 'Messenger'}` }, { status: 400 });
  }

  if (mediaUrl) {
    msgBody = msgBody ? `${msgBody}\n${mediaUrl}` : `📎 ${mediaName ?? 'Файл'}\n${mediaUrl}`;
  }

  const send = channel === 'INSTAGRAM' ? sendInstagramText : sendMessengerText;
  const res  = await send(account, thread.externalId, msgBody);
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
  revalidatePath(`/clients/${lead.id}`);
  revalidatePath('/inbox');
  return NextResponse.json({ ok: true });
}
