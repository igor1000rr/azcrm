// Утилиты Meta Graph API для Facebook Messenger + Instagram Direct.
//
// Один MetaAccount = одна FB Page. Если к Page привязан IG Business —
// тот же аккаунт обслуживает Messenger И Instagram через один Page Access Token.
//
// Поток подключения:
//   1. Создать FB App на developers.facebook.com (Type: Business).
//   2. В App добавить Messenger product + Instagram product.
//   3. Привязать FB Page → получить Page Access Token (long-lived).
//   4. Зарегистрировать webhook URL и Verify Token (Webhooks → Messenger/Instagram).
//   5. Подписать Page на webhook fields: messages, messaging_postbacks (Messenger),
//      messages, message_reactions (Instagram).
//
// Подпись webhook: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(appSecret, raw body)
// Документация:
//   - Messenger: https://developers.facebook.com/docs/messenger-platform/
//   - Instagram: https://developers.facebook.com/docs/messenger-platform/instagram/

import crypto from 'crypto';
import { db } from './db';
import type { MetaAccount } from '@prisma/client';

const GRAPH = 'https://graph.facebook.com/v19.0';

// ============ ПРОВЕРКА ПОДПИСИ WEBHOOK ============

/**
 * Проверка X-Hub-Signature-256 (формат: "sha256=<hex>").
 * Считаем HMAC-SHA256 от RAW body с ключом = App Secret.
 */
export function verifyMetaSignature(
  appSecret: string,
  rawBody: string,
  header: string | null,
): boolean {
  if (!header || !appSecret) return false;
  const expected = header.startsWith('sha256=') ? header.slice(7) : header;
  const computed = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ============ ОТПРАВКА СООБЩЕНИЯ ============

/**
 * Отправить текст в Messenger (recipient = PSID юзера).
 * Использует POST /me/messages с Page Access Token.
 *
 * https://developers.facebook.com/docs/messenger-platform/send-messages/
 */
export async function sendMessengerText(
  account: Pick<MetaAccount, 'pageAccessToken'>,
  recipientPsid: string,
  text: string,
): Promise<{ recipient_id?: string; message_id?: string; error?: { message: string } }> {
  const res = await fetch(`${GRAPH}/me/messages?access_token=${encodeURIComponent(account.pageAccessToken)}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_type: 'RESPONSE',
      recipient:      { id: recipientPsid },
      message:        { text },
    }),
  });
  return res.json();
}

/**
 * Отправить текст в Instagram Direct. Endpoint тот же что у Messenger
 * (graph /me/messages с Page Access Token), recipient.id = IGSID юзера.
 *
 * https://developers.facebook.com/docs/messenger-platform/instagram/sending-messages
 */
export async function sendInstagramText(
  account: Pick<MetaAccount, 'pageAccessToken'>,
  recipientIgsid: string,
  text: string,
) {
  return sendMessengerText(account, recipientIgsid, text);
}

// ============ ОБРАБОТКА ВХОДЯЩЕГО WEBHOOK ============

interface MetaMessagingEvent {
  sender:    { id: string };
  recipient: { id: string };
  timestamp?: number;
  message?: {
    mid:        string;
    text?:      string;
    attachments?: Array<{
      type:    'image' | 'video' | 'audio' | 'file' | 'location' | 'fallback' | 'template';
      payload: { url?: string; coordinates?: { lat: number; long: number } };
    }>;
    is_echo?: boolean;  // эхо нашего же исходящего — игнорируем
  };
  postback?: { payload: string; title?: string };
  read?:     { watermark: number };
  delivery?: { mids: string[]; watermark: number };
}

interface MetaWebhookEntry {
  id:        string;             // pageId (Messenger) или igUserId (Instagram)
  time?:     number;
  messaging?: MetaMessagingEvent[];   // Messenger
  changes?:  Array<{ field: string; value: unknown }>;
}

export interface MetaWebhookPayload {
  object: 'page' | 'instagram';
  entry:  MetaWebhookEntry[];
}

/**
 * Обработать webhook payload от Meta. Один payload может содержать события
 * для НЕСКОЛЬКИХ аккаунтов (FB шлёт пакетно), поэтому каждый entry резолвим
 * отдельно через pageId/igUserId.
 *
 * Важно: фильтруем is_echo — это эхо собственных исходящих, иначе мы их
 * запишем как входящие.
 */
export async function handleMetaWebhook(payload: MetaWebhookPayload): Promise<{
  processed: number; skipped: number;
}> {
  let processed = 0;
  let skipped   = 0;

  if (!Array.isArray(payload.entry)) return { processed, skipped };

  for (const entry of payload.entry) {
    // Найти MetaAccount: для Messenger — pageId, для Instagram — igUserId
    const account = await db.metaAccount.findFirst({
      where: payload.object === 'instagram'
        ? { igUserId: entry.id }
        : { pageId:   entry.id },
    });
    if (!account || !account.isActive) { skipped++; continue; }

    const channel: 'MESSENGER' | 'INSTAGRAM' = payload.object === 'instagram' ? 'INSTAGRAM' : 'MESSENGER';

    for (const ev of entry.messaging ?? []) {
      // is_echo = это эхо нашего же исходящего, FB шлёт его обратно. Игнор.
      if (ev.message?.is_echo) { skipped++; continue; }
      // Postback (нажатие кнопки) — пропускаем, у нас нет кнопок
      if (!ev.message) { skipped++; continue; }

      const externalUserId = ev.sender.id;

      // Найти/создать thread
      let thread = await db.chatThread.findFirst({
        where: {
          channel,
          metaAccountId: account.id,
          externalId:    externalUserId,
        },
      });
      if (!thread) {
        thread = await db.chatThread.create({
          data: {
            channel,
            metaAccountId:    account.id,
            externalId:       externalUserId,
            unreadCount:      0,
          },
        });
      }

      // Извлечь body / media
      let body: string | null = ev.message.text ?? null;
      let mediaUrl: string | null = null;
      let mtype: 'TEXT' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT' | 'LOCATION' = 'TEXT';
      const att = ev.message.attachments?.[0];
      if (att) {
        switch (att.type) {
          case 'image':    mtype = 'IMAGE';    mediaUrl = att.payload.url ?? null; break;
          case 'video':    mtype = 'VIDEO';    mediaUrl = att.payload.url ?? null; break;
          case 'audio':    mtype = 'AUDIO';    mediaUrl = att.payload.url ?? null; break;
          case 'file':     mtype = 'DOCUMENT'; mediaUrl = att.payload.url ?? null; break;
          case 'location': mtype = 'LOCATION'; body = '[location]'; break;
          default:         body = body ?? `[${att.type}]`;
        }
      }

      await db.chatMessage.create({
        data: {
          threadId:      thread.id,
          metaAccountId: account.id,
          direction:     'IN',
          type:          mtype,
          body,
          mediaUrl,
          externalId:    ev.message.mid,
        },
      });

      await db.chatThread.update({
        where: { id: thread.id },
        data: {
          unreadCount:     { increment: 1 },
          lastMessageAt:   new Date(),
          lastMessageText: body ?? '[media]',
        },
      });

      processed++;
    }

    await db.metaAccount.update({
      where: { id: account.id },
      data:  { lastSeenAt: new Date() },
    });
  }

  return { processed, skipped };
}
