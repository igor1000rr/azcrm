// Web Push уведомления для PWA
//
// Поток:
//   1. Браузер запрашивает разрешение → создаёт PushSubscription
//   2. Отправляет на /api/push/subscribe → сохраняется в БД
//   3. Серверный код вызывает sendPushToUser() → web-push доставляет в браузер
//   4. service-worker.js (в /public) показывает уведомление

import webpush from 'web-push';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY  ?? '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? '';
const VAPID_SUBJECT     = process.env.VAPID_SUBJECT     ?? 'mailto:igor1000rr@example.com';

let configured = false;
function configure() {
  if (configured) return;
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    configured = true;
  }
}

export function getVapidPublicKey(): string {
  return VAPID_PUBLIC_KEY;
}

export function isPushConfigured(): boolean {
  return !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}

interface PushPayload {
  title: string;
  body?: string;
  url?:  string;
  icon?: string;
  tag?:  string;
}

/**
 * Отправить push уведомление одному юзеру (на все его устройства).
 * Все подписки шлются параллельно через Promise.allSettled — раньше
 * был последовательный цикл с await в for-of, при N подписках это
 * блокировало server action на N×latency push-сервиса.
 */
export async function sendPushToUser(
  userId:  string,
  payload: PushPayload,
): Promise<{ sent: number; failed: number }> {
  if (!isPushConfigured()) return { sent: 0, failed: 0 };
  configure();

  const subs = await db.pushSubscription.findMany({ where: { userId } });
  if (subs.length === 0) return { sent: 0, failed: 0 };

  const json = JSON.stringify(payload);

  const results = await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.authKey },
          },
          json,
        );
        // Обновляем lastUsedAt
        await db.pushSubscription.update({
          where: { id: sub.id },
          data:  { lastUsedAt: new Date() },
        });
        return { ok: true as const };
      } catch (e) {
        const statusCode = (e as { statusCode?: number }).statusCode;
        // 404/410 — подписка протухла, удаляем
        if (statusCode === 404 || statusCode === 410) {
          await db.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        } else {
          logger.error(`push failed for ${userId}:`, e);
        }
        return { ok: false as const };
      }
    }),
  );

  let sent = 0, failed = 0;
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.ok) sent++;
    else failed++;
  }
  return { sent, failed };
}

/** Послать нескольким юзерам параллельно */
export async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload,
): Promise<{ sent: number; failed: number }> {
  const results = await Promise.all(userIds.map((id) => sendPushToUser(id, payload)));
  return results.reduce(
    (acc, r) => ({ sent: acc.sent + r.sent, failed: acc.failed + r.failed }),
    { sent: 0, failed: 0 },
  );
}
