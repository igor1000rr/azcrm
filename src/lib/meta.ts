// Утилиты Meta Graph API для Facebook Messenger + Instagram Direct.
//
// Один MetaAccount = одна FB Page. Если к Page привязан IG Business —
// тот же аккаунт обслуживает Messenger И Instagram через один Page Access Token.
//
// 06.05.2026 — #2.5 аудита расширен на Meta: handleMetaWebhook теперь
// вызывает notifyChannelMessage для каждого входящего сообщения.
// 06.05.2026 — #2.16 аудита: unsubscribePageWebhook — DELETE подписки Page
// на webhook'и нашего App при удалении MetaAccount из CRM.

import crypto from 'crypto';
import { db } from './db';
import { notifyChannelMessage } from './notify';
import { logger } from './logger';
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

export async function sendInstagramText(
  account: Pick<MetaAccount, 'pageAccessToken'>,
  recipientIgsid: string,
  text: string,
) {
  return sendMessengerText(account, recipientIgsid, text);
}

// ============ ОТПИСКА PAGE ОТ WEBHOOK ============

/**
 * Отозвать подписку Page на события нашего FB App — DELETE /me/subscribed_apps.
 * 06.05.2026 — пункт #2.16 аудита.
 * https://developers.facebook.com/docs/graph-api/reference/page/subscribed_apps/
 */
export async function unsubscribePageWebhook(
  pageAccessToken: string,
): Promise<{ success?: boolean; error?: { message: string } }> {
  const url = `${GRAPH}/me/subscribed_apps?access_token=${encodeURIComponent(pageAccessToken)}`;
  const res = await fetch(url, { method: 'DELETE' });
  return res.json();
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
    is_echo?: boolean;
  };
  postback?: { payload: string; title?: string };
  read?:     { watermark: number };
  delivery?: { mids: string[]; watermark: number };
}

interface MetaWebhookEntry {
  id:        string;
  time?:     number;
  messaging?: MetaMessagingEvent[];
  changes?:  Array<{ field: string; value: unknown }>;
}

export interface MetaWebhookPayload {
  object: 'page' | 'instagram';
  entry:  MetaWebhookEntry[];
}

export async function handleMetaWebhook(payload: MetaWebhookPayload): Promise<{
  processed: number; skipped: number;
}> {
  let processed = 0;
  let skipped   = 0;

  if (!Array.isArray(payload.entry)) return { processed, skipped };

  for (const entry of payload.entry) {
    const account = await db.metaAccount.findFirst({
      where: payload.object === 'instagram'
        ? { igUserId: entry.id }
        : { pageId:   entry.id },
    });
    if (!account || !account.isActive) { skipped++; continue; }

    const channel: 'MESSENGER' | 'INSTAGRAM' = payload.object === 'instagram' ? 'INSTAGRAM' : 'MESSENGER';

    for (const ev of entry.messaging ?? []) {
      if (ev.message?.is_echo) { skipped++; continue; }
      if (!ev.message) { skipped++; continue; }

      const externalUserId = ev.sender.id;

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

      // 06.05.2026 — #2.5 аудита: уведомляем владельца или всех админов.
      // До этого Meta вообще не уведомляла. Ошибки catch'им — push/email не
      // должны ломать основной flow webhook'а.
      const preview = body?.slice(0, 200) || '[media]';
      const channelLabel = channel === 'INSTAGRAM' ? 'Instagram' : 'Messenger';
      notifyChannelMessage(account.ownerId, {
        kind:   'NEW_MESSAGE',
        title:  `${channelLabel}: ${account.label}`,
        body:   preview,
        link:   `/inbox?thread=${thread.id}`,
      }).catch((e) => logger.error('[meta] notify failed:', e));

      processed++;
    }

    await db.metaAccount.update({
      where: { id: account.id },
      data:  { lastSeenAt: new Date() },
    });
  }

  return { processed, skipped };
}
