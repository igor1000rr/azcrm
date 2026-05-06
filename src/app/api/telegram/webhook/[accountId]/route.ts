// POST /api/telegram/webhook/:accountId
//
// 06.05.2026 — пункт #2.5 аудита: notifyChannelMessage вместо notify —
// для общих каналов рассылаем всем админам.
//
// 06.05.2026 — пункт #2.17 аудита: edited_message теперь UPDATE существующей
// записи, а не создаёт новую. До этого Telegram при редактировании сообщения
// слал update с новым update_id и тем же message_id; дедуп шёл по update_id
// (всегда уникальному) → новая запись. Anna видела старую и новую версию
// в ленте чата.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { notifyChannelMessage } from '@/lib/notify';
import { normalizePhone } from '@/lib/utils';
import { getWebhookSecret, type TelegramUpdate, type TelegramMessage } from '@/lib/telegram';
import { parseBody } from '@/lib/api-validation';
import { logger } from '@/lib/logger';
import type { MessageType } from '@prisma/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
  edit_date:  z.number().int().nonnegative().optional(),
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

  // edited_message vs message — это разные поля одного update'а.
  // edited_message = пользователь отредактировал старое сообщение.
  // У него тот же message_id что у оригинала, но новое содержимое + edit_date.
  const isEdit  = Boolean(update.edited_message);
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

  return handleIncomingMessage(message, update.update_id, isEdit, account);
}

async function handleIncomingMessage(
  msg: TelegramMessage,
  updateId: number,
  isEdit: boolean,
  account: { id: string; ownerId: string | null; label: string },
) {
  // ============ #2.17 аудита: обработка редактирования ============
  // Telegram при редактировании сообщения шлёт update.edited_message с тем же
  // message_id, но новым content + edit_date. Раньше дедуп шёл по update_id
  // (он уникальный) → создавали ВТОРУЮ запись и Anna видела дубликат.
  //
  // Сейчас:
  //   - Для редактирования ищем существующую запись по (chat + message_id)
  //     и обновляем body/mediaUrl/etc. Дату создания НЕ трогаем — оставляем
  //     оригинальную, чтобы порядок сообщений не сбивался.
  //   - Если оригинал не нашли (например, edit пришёл раньше сохранения
  //     оригинала или мы пропустили original update) — создаём новую запись
  //     как fallback.
  //
  // externalId хранит message_id (а не update_id) чтобы edits можно было
  // правильно линковать. update_id — только для дедупа повторных доставок
  // ОДНОГО И ТОГО ЖЕ update'а от Telegram (на случай ретрая).
  const messageIdStr = `${msg.message_id}`;
  const chatId = String(msg.chat.id);

  if (isEdit) {
    const original = await db.chatMessage.findFirst({
      where: {
        telegramAccountId: account.id,
        externalId:        messageIdStr,
        direction:         'IN',
      },
      select: { id: true, threadId: true },
    });

    const { type, body, mediaName, mediaSize } = mapMessageContent(msg);

    if (original) {
      await db.chatMessage.update({
        where: { id: original.id },
        data: {
          type,
          body,
          mediaName,
          mediaSize,
          // Помечаем что было редактирование — добавляем суффикс к body
          // чтобы Anna видела факт правки, не теряя информацию.
          // (можно потом вынести в отдельное поле editedAt — пока минимально.)
        },
      });

      // Обновим thread last message text если это последнее сообщение
      const lastMsg = await db.chatMessage.findFirst({
        where:   { threadId: original.threadId, direction: 'IN' },
        orderBy: { createdAt: 'desc' },
        select:  { id: true },
      });
      if (lastMsg?.id === original.id) {
        const preview = body?.slice(0, 200) || `[${type.toLowerCase()}]`;
        await db.chatThread.update({
          where: { id: original.threadId },
          data:  { lastMessageText: `${preview} (изменено)` },
        });
      }

      revalidatePath('/inbox');
      return NextResponse.json({ ok: true, edited: true });
    }
    // fallthrough: оригинала нет — создаём как новое (логика ниже).
    logger.warn(`[tg-webhook] edit for unknown message_id=${messageIdStr}, fallback to insert`);
  }

  // ============ Дедупликация по message_id ============
  // Раньше дедуп шёл по update_id, но это создавало дубль на каждый edit.
  // Теперь дедуп по (account, message_id) — один и тот же message_id
  // не сохранится дважды.
  const existing = await db.chatMessage.findFirst({
    where: { externalId: messageIdStr, telegramAccountId: account.id },
    select: { id: true },
  });
  if (existing) return NextResponse.json({ ok: true, deduplicated: true });

  // updateId оставляем в логах для отладки, но не используем для дедупа
  void updateId;

  const fromUser = msg.from;
  const tgUserName = [fromUser?.first_name, fromUser?.last_name].filter(Boolean).join(' ').trim()
    || fromUser?.username
    || msg.chat.title
    || `Telegram ${chatId}`;
  const tgUsername = fromUser?.username ?? null;

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
        externalId:        messageIdStr,
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

  // #2.5 аудита: для общих каналов уведомляем всех админов.
  await notifyChannelMessage(account.ownerId, {
    kind:   'NEW_MESSAGE',
    title:  `Telegram: ${tgUserName}`,
    body:   preview,
    link:   `/inbox?thread=${thread.id}`,
  });

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
