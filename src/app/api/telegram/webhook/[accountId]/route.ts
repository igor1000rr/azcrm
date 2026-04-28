// POST /api/telegram/webhook/:accountId
// Telegram Bot API слёт обновления прямо сюда. Аутентификация через заголовок
// X-Telegram-Bot-Api-Secret-Token, который мы задали при setWebhook (HMAC от accountId).
//
// Логика аналогична WhatsApp:
//   1. Проверить secret
//   2. Найти или создать клиента (по телефону из contact, или fallback по tg:<chatId>)
//   3. Если новый клиент — создать первый лид
//   4. Найти/создать ChatThread (channel=TELEGRAM, externalId=chatId)
//   5. Сохранить ChatMessage с дедупликацией по externalId = update_id

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { notify } from '@/lib/notify';
import { normalizePhone } from '@/lib/utils';
import { getWebhookSecret, type TelegramUpdate, type TelegramMessage } from '@/lib/telegram';
import type { MessageType } from '@prisma/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await ctx.params;

  // 1. Secret валидация
  let expected: string;
  try { expected = getWebhookSecret(accountId); }
  catch (e) {
    console.error('[tg-webhook] secret config error', e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  const provided = req.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (provided !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  // 2. Парсим update
  let update: TelegramUpdate;
  try { update = await req.json() as TelegramUpdate; }
  catch { return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 }); }

  const message = update.message ?? update.edited_message;
  if (!message) {
    // Сейчас callback_query и другие типы update’ов просто пропускаем (200, иначе Telegram будет ретраить)
    return NextResponse.json({ ok: true, skipped: true });
  }

  // 3. Находим аккаунт
  const account = await db.telegramAccount.findUnique({
    where: { id: accountId },
    select: { id: true, ownerId: true, label: true, isActive: true },
  });
  if (!account || !account.isActive) {
    return NextResponse.json({ ok: false, error: 'account not found or inactive' }, { status: 404 });
  }

  return handleIncomingMessage(message, update.update_id, account);
}

async function handleIncomingMessage(
  msg: TelegramMessage,
  updateId: number,
  account: { id: string; ownerId: string | null; label: string },
) {
  // Дедуп по externalId
  const externalId = `${updateId}`;
  const existing = await db.chatMessage.findFirst({
    where: { externalId, telegramAccountId: account.id },
    select: { id: true },
  });
  if (existing) return NextResponse.json({ ok: true, deduplicated: true });

  const chatId = String(msg.chat.id);
  const fromUser = msg.from;
  const tgUserName = [fromUser?.first_name, fromUser?.last_name].filter(Boolean).join(' ').trim()
    || fromUser?.username
    || msg.chat.title
    || `Telegram ${chatId}`;
  const tgUsername = fromUser?.username ?? null;

  // Находим/создаём клиента.
  // Приоритет поиска:
  //   1. Если пришёл contact с телефоном — ищем по этому номеру
  //   2. Иначе ищем существующий thread по tg-chatId и берём клиента оттуда
  //   3. Иначе — новый клиент с фиктивным телефоном (tg:<chatId>)

  let client: { id: string } | null = null;
  let phone: string | null = null;

  if (msg.contact?.phone_number && msg.contact.phone_number === fromUser?.id?.toString()
      || msg.contact?.phone_number) {
    // contact прислан самим пользователем
    try { phone = normalizePhone(msg.contact.phone_number); } catch {}
  }
  if (phone) {
    client = await db.client.findUnique({ where: { phone }, select: { id: true } });
  }
  if (!client) {
    const existingThread = await db.chatThread.findFirst({
      where: { channel: 'TELEGRAM', telegramAccountId: account.id, externalId: chatId },
      select: { id: true, clientId: true },
    });
    if (existingThread?.clientId) {
      client = { id: existingThread.clientId };
    }
  }

  if (!client) {
    const defaultFunnel = await db.funnel.findFirst({
      where: { isActive: true },
      include: { stages: { orderBy: { position: 'asc' }, take: 1 } },
    });
    if (!defaultFunnel || defaultFunnel.stages.length === 0) {
      console.error('[tg-webhook] no default funnel/stage configured');
      return NextResponse.json({ ok: false, error: 'no funnel configured' }, { status: 500 });
    }

    const fakePhone = phone || `tg:${chatId}`;
    const created = await db.client.create({
      data: {
        fullName: tgUserName,
        phone:    fakePhone,
        ownerId:  account.ownerId,
        source:   `Telegram: ${account.label}`,
      },
    });
    client = { id: created.id };

    await db.lead.create({
      data: {
        clientId:          created.id,
        funnelId:          defaultFunnel.id,
        stageId:           defaultFunnel.stages[0].id,
        salesManagerId:    account.ownerId,
        telegramAccountId: account.id,
        source:            `Telegram: ${account.label}${tgUsername ? ' (@' + tgUsername + ')' : ''}`,
        sourceKind:        'TELEGRAM',
        firstContactAt:    new Date(msg.date * 1000),
        events: account.ownerId ? {
          create: {
            authorId: account.ownerId,
            kind:     'LEAD_CREATED',
            message:  `Лид создан автоматически из Telegram (${account.label})`,
          },
        } : undefined,
      },
    });
  }

  // 4. Тред
  let thread = await db.chatThread.findFirst({
    where: { channel: 'TELEGRAM', telegramAccountId: account.id, externalId: chatId },
  });
  if (!thread) {
    thread = await db.chatThread.create({
      data: {
        channel:           'TELEGRAM',
        clientId:          client.id,
        telegramAccountId: account.id,
        externalId:        chatId,
        externalUserName:  tgUserName,
      },
    });
  } else if (thread.clientId !== client.id) {
    // Привязываем к найденному клиенту
    await db.chatThread.update({ where: { id: thread.id }, data: { clientId: client.id } });
  }

  // 5. Тип сообщения + тело
  const { type, body, mediaName, mediaSize } = mapMessageContent(msg);
  const preview = body?.slice(0, 200) || `[${type.toLowerCase()}]`;

  await db.$transaction([
    db.chatMessage.create({
      data: {
        threadId:          thread.id,
        telegramAccountId: account.id,
        direction:         'IN',
        type,
        body,
        mediaName,
        mediaSize,
        externalId,
        createdAt:         new Date(msg.date * 1000),
      },
    }),
    db.chatThread.update({
      where: { id: thread.id },
      data: {
        lastMessageAt:   new Date(msg.date * 1000),
        lastMessageText: preview,
        unreadCount:     { increment: 1 },
        externalUserName: tgUserName,
      },
    }),
  ]);

  if (account.ownerId) {
    await notify({
      userId: account.ownerId,
      kind:   'NEW_MESSAGE',
      title:  `Telegram: ${tgUserName}`,
      body:   preview,
      link:   `/inbox?thread=${thread.id}`,
    });
  }

  revalidatePath('/inbox');
  return NextResponse.json({ ok: true });
}

function mapMessageContent(msg: TelegramMessage): {
  type: MessageType;
  body: string | null;
  mediaName: string | null;
  mediaSize: number | null;
} {
  if (msg.text)     return { type: 'TEXT',     body: msg.text,    mediaName: null, mediaSize: null };
  if (msg.photo)    {
    const last = msg.photo[msg.photo.length - 1];
    return { type: 'IMAGE',    body: msg.caption ?? null, mediaName: null, mediaSize: last.file_size ?? null };
  }
  if (msg.document) return { type: 'DOCUMENT', body: msg.caption ?? null, mediaName: msg.document.file_name ?? null, mediaSize: msg.document.file_size ?? null };
  if (msg.voice)    return { type: 'AUDIO',    body: msg.caption ?? null, mediaName: null, mediaSize: msg.voice.file_size ?? null };
  if (msg.audio)    return { type: 'AUDIO',    body: msg.caption ?? null, mediaName: null, mediaSize: msg.audio.file_size ?? null };
  if (msg.video)    return { type: 'VIDEO',    body: msg.caption ?? null, mediaName: null, mediaSize: msg.video.file_size ?? null };
  if (msg.contact)  {
    const text = `📞 ${msg.contact.first_name}${msg.contact.last_name ? ' ' + msg.contact.last_name : ''}: ${msg.contact.phone_number}`;
    return { type: 'CONTACT', body: text, mediaName: null, mediaSize: null };
  }
  if (msg.location) {
    const text = `📍 ${msg.location.latitude}, ${msg.location.longitude}`;
    return { type: 'LOCATION', body: text, mediaName: null, mediaSize: null };
  }
  return { type: 'TEXT', body: '[неподдерживаемый тип сообщения]', mediaName: null, mediaSize: null };
}
