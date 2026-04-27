// Единая точка создания уведомлений: БД + push + email
import { db } from '@/lib/db';
import { sendPushToUser } from '@/lib/push';
import { sendEmail, renderEmailTemplate, isEmailConfigured } from '@/lib/email';
import type { NotificationKind } from '@prisma/client';

interface NotifyInput {
  userId: string;
  kind:   NotificationKind;
  title:  string;
  body?:  string | null;
  link?:  string | null;
  forceEmail?: boolean;
}

const APP_URL = process.env.APP_PUBLIC_URL ?? 'http://localhost:3000';

const CRITICAL_KINDS: NotificationKind[] = [
  'LEAD_TRANSFERRED',
  'TASK_OVERDUE',
];

export async function notify(input: NotifyInput): Promise<void> {
  await db.notification.create({
    data: {
      userId: input.userId,
      kind:   input.kind,
      title:  input.title,
      body:   input.body ?? null,
      link:   input.link ?? null,
    },
  });

  sendPushToUser(input.userId, {
    title: input.title,
    body:  input.body ?? undefined,
    url:   input.link ?? undefined,
    tag:   input.kind,
  }).catch((e) => console.error('push failed:', e));

  if (
    isEmailConfigured()
    && (input.forceEmail || CRITICAL_KINDS.includes(input.kind))
  ) {
    sendEmailNotification(input).catch((e) => console.error('email failed:', e));
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
  for (const input of inputs) await notify(input);
}
