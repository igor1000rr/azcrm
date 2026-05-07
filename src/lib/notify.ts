// Единая точка создания уведомлений: БД + push + email
import { db } from '@/lib/db';
import { sendPushToUser } from '@/lib/push';
import { sendEmail, renderEmailTemplate, isEmailConfigured } from '@/lib/email';
import type { NotificationKind } from '@prisma/client';
import { logger } from '@/lib/logger';

interface NotifyInput {
  userId: string;
  kind:   NotificationKind;
  title:  string;
  body?:  string | null;
  link?:  string | null;
  /** Отправить email-копию даже если у юзера выключено */
  forceEmail?: boolean;
}

const APP_URL = process.env.APP_PUBLIC_URL ?? 'http://localhost:3000';

/**
 * Критичные типы — для них шлём email всегда (если SMTP настроен)
 */
const CRITICAL_KINDS: NotificationKind[] = [
  'LEAD_TRANSFERRED',
  'TASK_OVERDUE',
];

export async function notify(input: NotifyInput): Promise<void> {
  // 1. БД
  await db.notification.create({
    data: {
      userId: input.userId,
      kind:   input.kind,
      title:  input.title,
      body:   input.body ?? null,
      link:   input.link ?? null,
    },
  });

  // 2. Push (fire and forget)
  sendPushToUser(input.userId, {
    title: input.title,
    body:  input.body ?? undefined,
    url:   input.link ?? undefined,
    tag:   input.kind,
  }).catch((e) => logger.error('push failed:', e));

  // 3. Email (если настроен и тип критичный)
  if (
    isEmailConfigured()
    && (input.forceEmail || CRITICAL_KINDS.includes(input.kind))
  ) {
    sendEmailNotification(input).catch((e) => logger.error('email failed:', e));
  }
}

async function sendEmailNotification(input: NotifyInput): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: input.userId },
    select: { email: true },
  });
  if (!user?.email) return;

  const url = input.link ? (input.link.startsWith('http') ? input.link : `${APP_URL}${input.link}`) : undefined;

  await sendEmail({
    to:      user.email,
    subject: input.title,
    text:    [input.title, input.body, url].filter(Boolean).join('\n\n'),
    html:    renderEmailTemplate({
      title:    input.title,
      body:     input.body ?? input.title,
      ctaUrl:   url,
      ctaLabel: 'Открыть в CRM',
    }),
  });
}

export async function notifyMany(inputs: NotifyInput[]): Promise<void> {
  // Promise.all — параллельно (07.05.2026 заменило for await для ускорения).
  await Promise.all(inputs.map((input) => notify(input)));
}

/**
 * Уведомление о событии на канале связи (WhatsApp/Telegram/Viber/Meta).
 *
 * 06.05.2026 — пункт #2.5 аудита.
 *
 * Раньше в webhook'ах было:
 *   if (account.ownerId) {
 *     await notify({ userId: account.ownerId, ... });
 *   }
 *
 * Если канал общий (ownerId === null — общий WhatsApp фирмы,
 * поддержка Telegram-бот) — никто не получал push. Сообщения
 * приходят в inbox, но Anna узнавала только случайно при заходе в систему.
 *
 * Теперь:
 *   - Если ownerId есть — уведомляем владельца как раньше.
 *   - Если ownerId === null — уведомляем всех активных ADMIN-юзеров.
 *     Админы (обычно Anna) распределяют или отвечают сами.
 *
 * 07.05.2026: рассылка админам через Promise.all — параллельно.
 * До: for (const a of admins) await notify(...) — латенси в webhook'е складывались
 * (при 5 админах и 200ms email = 1 сек). Telegram ожидает ответ за НЕСКОЛЬКО секунд,
 * иначе делает retry — поэтому webhook должен отвечать быстро.
 */
export async function notifyChannelMessage(
  ownerId: string | null,
  payload: Omit<NotifyInput, 'userId'>,
): Promise<void> {
  if (ownerId) {
    await notify({ ...payload, userId: ownerId });
    return;
  }

  const admins = await db.user.findMany({
    where:  { role: 'ADMIN', isActive: true },
    select: { id: true },
  });

  await Promise.all(
    admins.map((a) => notify({ ...payload, userId: a.id })),
  );
}
