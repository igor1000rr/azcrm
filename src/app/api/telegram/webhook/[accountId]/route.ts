// POST /api/telegram/webhook/:accountId
// Telegram Bot API слёт обновления прямо сюда. Аутентификация через заголовок
// X-Telegram-Bot-Api-Secret-Token, который мы задали при setWebhook (HMAC от accountId).
//
// Логика:
//   1. Проверить secret
//   2. Найти или создать клиента (по телефону из contact, или fallback по tg:<chatId>)
//      БЕЗ автосоздания лида — менеджер создаст лид вручную из карточки
//      клиента (Anna 01.05.2026).
//   3. Найти/создать ChatThread (channel=TELEGRAM, externalId=chatId)
//   4. Сохранить ChatMessage с дедупликацией по externalId = update_id

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { notify } from '@/lib/notify';
import { normalizePhone } from '@/lib/utils';
import { getWebhookSecret, type TelegramUpdate, type TelegramMessage } from '@/lib/telegram';
import { parseBody } from '@/lib/api-validation';
import { logger } from '@/lib/logger';
import type { MessageType } from '@prisma/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ============ ZOD-СХЕМА TG UPDATE ============
const TgUserSchema = z.object({
  id:         z.number().int(),
  is_bot:     z.boolean().optional(),
  first_name: z.string().max(200).optional(),
  last_name:  z.string().max(200).optional(),
  username:   z.string().max(100).optional(),
}).passthrough();

const TgChatSchema = z.object({
  id:    z.number().int(),
  type:  z.string().max(40).optional(),
  title: z.string().max(200).optional(),
}).passthrough();

const TgMessageSchema = z.object({
  message_id: z.number().int(),
  date:       z.number().int().nonnegative(),
  chat:       TgChatSchema,
  from:       TgUserSchema.optional(),
  text:       z.string().max(20_000).optional(),
  caption:    z.string().max(5_000).optional(),
  photo:      z.array(z.object({ file_size: z.number().int().optional() }).passthrough()).optional(),
  document:   z.object({
    file_name: z.string().max(512).optional(),
    file_size: z.number().int().optional(),
  }).passthrough().optional(),
  audio:      z.object({ file_size: z.number().int().optional() }).passthrough().optional(),
  voice:      z.object({ file_size: z.number().int().optional() }).passthrough().optional(),
  video:      z.object({ file_size: z.number().int().optional() }).passthrough().optional(),
  contact:    z.object({
    phone_number: z.string().max(40),
    first_name:   z.string().max(200).optional(),
    last_name:    z.string().max(200).optional(),
  }).passthrough().optional(),
  location:   z.object({
    latitude:  z.number(),
    longitude: z.number(),
  }).passthrough().optional(),
}).passthrough();

const TgUpdateSchema = z.object({
  update_id:      z.number().int(),
  message:        TgMessageSchema.optional(),
  edited_message: TgMessageSchema.optional(),
  callback_query: z.object({}).passthrough().optional(),
}).passthrough();

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await ctx.params;

  // 1. Secret валидация
  let expected: string;
  try { expected = getWebhookSecret(accountId); }
  catch (e) {
    logger.error('[tg-webhook] secret config error', e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  const provided = req.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (provided !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const parsed = await parseBody(req, TgUpdateSchema);
  if (!parsed.ok) {
    logger.warn('[tg-webhook] invalid update payload, skipping');
    return NextResponse.json({ ok: true, skipped: true, reason: 'invalid' });
  }
  const update = parsed.data as TelegramUpdate;

  const message = update.message ?? update.edited_message;
  if (!message) {
    return NextResponse.json({ ok: true, skipped: true });
  }

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

  // Находим/создаём клиента (без автосоздания лида — Anna 01.05.2026).
  let client: { id: string } | null = null;
  let phone: string | null = null;

  if (msg.contact?.phone_number) {
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
    // Создаём ТОЛЬКО клиента. Лид менеджер создаст вручную через карточку.
    const fakePhone = phone || `tg:${chatId}`;
    const created = await db.client.create({
      data: {
        fullName: tgUserName,
        phone:    fakePhone,
        ownerId:  account.ownerId,
        source:   `Telegram: ${account.label}${tgUsername ? ' (@' + tgUsername + ')' : ''}`,
      },
    });
    client = { id: created.id };
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
    await db.chatThread.update({ where: { id: thread.id }, data: { clientId: client.id } });
  }

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
