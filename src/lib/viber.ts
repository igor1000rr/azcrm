// Утилиты Viber Bot API.
// Документация: https://developers.viber.com/docs/api/rest-bot-api/
//
// Поток:
//   1. Создать Viber Public Account на partners.viber.com → получить X-Viber-Auth-Token.
//   2. Зарегистрировать в БД (ViberAccount) + вызвать setViberWebhook() с URL CRM.
//   3. Viber шлёт события на /api/viber/webhook с подписью X-Viber-Content-Signature.
//   4. handleViberEvent создаёт ChatThread/ChatMessage, при первом контакте — Client+Lead.
//   5. Отправка ответа: sendViberText(account, receiverId, text).

import crypto from 'crypto';
import { db } from './db';
import type { ViberAccount } from '@prisma/client';

const VIBER_API = 'https://chatapi.viber.com/pa';

// ============ ПРОВЕРКА ПОДПИСИ ============

/**
 * Viber подписывает webhook payload через HMAC-SHA256, ключ = authToken.
 * Заголовок X-Viber-Content-Signature содержит hex-строку.
 * https://developers.viber.com/docs/api/rest-bot-api/#callbacks
 */
export function verifyViberSignature(
  authToken: string,
  rawBody: string,
  signature: string,
): boolean {
  if (!authToken || !signature) return false;
  const computed = crypto
    .createHmac('sha256', authToken)
    .update(rawBody)
    .digest('hex');
  // timingSafeEqual чтобы не было утечки через тайминг-атаку
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(signature, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ============ УСТАНОВКА WEBHOOK ============

/**
 * Зарегистрировать webhook URL в Viber. Вызывается админом из UI настроек
 * после подключения Public Account. Идемпотентно — повторный вызов с тем же
 * URL просто переустановит подписку.
 *
 * url должен быть HTTPS и публично доступен (Viber его проверит).
 */
export async function setViberWebhook(authToken: string, url: string): Promise<{
  status: number; status_message: string;
}> {
  const res = await fetch(`${VIBER_API}/set_webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Viber-Auth-Token': authToken,
    },
    body: JSON.stringify({
      url,
      // Какие события хотим получать. delivered/seen опускаем — шум.
      event_types: ['message', 'subscribed', 'unsubscribed', 'conversation_started', 'failed'],
      send_name: true,
      send_photo: true,
    }),
  });
  return res.json();
}

/** Снять webhook (отключить аккаунт). */
export async function removeViberWebhook(authToken: string) {
  return setViberWebhook(authToken, '');
}

// ============ ОТПРАВКА СООБЩЕНИЯ ============

/**
 * Послать текстовое сообщение клиенту. receiverId = id юзера в Viber
 * (берётся из входящего message event, поле sender.id).
 */
export async function sendViberText(
  account: Pick<ViberAccount, 'authToken' | 'paName'>,
  receiverId: string,
  text: string,
): Promise<{ status: number; status_message: string; message_token?: number }> {
  const res = await fetch(`${VIBER_API}/send_message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Viber-Auth-Token': account.authToken,
    },
    body: JSON.stringify({
      receiver: receiverId,
      type:     'text',
      sender:   { name: account.paName },
      text,
    }),
  });
  return res.json();
}

// ============ ОБРАБОТКА ВХОДЯЩЕГО СОБЫТИЯ ============

// Структура event'ов Viber. Берём только то что нам нужно.
export interface ViberEvent {
  event: 'message' | 'subscribed' | 'unsubscribed' | 'conversation_started' | 'delivered' | 'seen' | 'failed' | 'webhook';
  timestamp?: number;
  message_token?: number;
  sender?: {
    id:     string;
    name?:  string;
    avatar?: string;
    language?: string;
  };
  user?: {
    id:    string;
    name?: string;
  };
  message?: {
    type:    'text' | 'picture' | 'video' | 'file' | 'sticker' | 'contact' | 'url' | 'location';
    text?:   string;
    media?:  string;     // URL для picture/video/file
    file_name?: string;
    file_size?: number;
    contact?: { name: string; phone_number: string };
  };
}

/**
 * Обработать event от Viber. Сохраняет/обновляет thread, добавляет message,
 * при первом обращении — создаёт Client + Lead в дефолтную воронку.
 *
 * Возвращает короткий статус для логирования.
 */
export async function handleViberEvent(
  account: ViberAccount,
  event: ViberEvent,
): Promise<{ ok: boolean; reason?: string }> {
  // Реагируем только на message — остальные события игнорируем (можно
  // потом добавить обновление isRead через delivered/seen).
  if (event.event !== 'message') {
    return { ok: true, reason: `ignored_${event.event}` };
  }
  if (!event.sender?.id || !event.message) {
    return { ok: false, reason: 'no_sender_or_message' };
  }

  const externalId = event.sender.id;
  const senderName = event.sender.name || 'Viber пользователь';

  // Найти/создать thread по (channel + accountId + externalId)
  let thread = await db.chatThread.findFirst({
    where: {
      channel:        'VIBER',
      viberAccountId: account.id,
      externalId,
    },
  });

  if (!thread) {
    thread = await db.chatThread.create({
      data: {
        channel:          'VIBER',
        viberAccountId:   account.id,
        externalId,
        externalUserName: senderName,
        unreadCount:      0,
      },
    });
  }

  // Извлекаем body для message — для не-текстовых сообщений сохраняем mediaUrl.
  let body: string | null = null;
  let mediaUrl: string | null = null;
  let mediaName: string | null = null;
  let mediaSize: number | null = null;
  let mtype: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'AUDIO' | 'LOCATION' | 'CONTACT' = 'TEXT';
  switch (event.message.type) {
    case 'text':    mtype = 'TEXT';     body = event.message.text ?? ''; break;
    case 'picture': mtype = 'IMAGE';    mediaUrl = event.message.media ?? null; break;
    case 'video':   mtype = 'VIDEO';    mediaUrl = event.message.media ?? null; break;
    case 'file':    mtype = 'DOCUMENT'; mediaUrl = event.message.media ?? null;
                    mediaName = event.message.file_name ?? null;
                    mediaSize = event.message.file_size ?? null; break;
    case 'location':mtype = 'LOCATION'; body = '[location]'; break;
    case 'contact': mtype = 'CONTACT';
                    body = event.message.contact ? `${event.message.contact.name} ${event.message.contact.phone_number}` : null;
                    break;
    default:        mtype = 'TEXT';     body = `[${event.message.type}]`;
  }

  await db.chatMessage.create({
    data: {
      threadId:       thread.id,
      viberAccountId: account.id,
      direction:      'IN',
      type:           mtype,
      body,
      mediaUrl,
      mediaName,
      mediaSize,
      externalId:     event.message_token ? String(event.message_token) : null,
    },
  });

  await db.chatThread.update({
    where: { id: thread.id },
    data: {
      unreadCount:     { increment: 1 },
      lastMessageAt:   new Date(),
      lastMessageText: body ?? `[${event.message.type}]`,
      // Если имя поменялось (юзер сменил никнейм) — обновляем
      externalUserName: senderName,
    },
  });

  await db.viberAccount.update({
    where: { id: account.id },
    data:  { lastSeenAt: new Date() },
  });

  return { ok: true };
}
