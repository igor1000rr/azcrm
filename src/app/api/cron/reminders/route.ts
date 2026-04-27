// POST /api/cron/reminders
// Вызывается раз в 30 минут через crontab или systemd timer.
// Авторизация — через CRON_SECRET в заголовке (обязательный).
//
// crontab пример:
//   */30 * * * * curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" https://crm.azgroup.pl/api/cron/reminders

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { workerSendMessage } from '@/lib/whatsapp';
import { formatTime } from '@/lib/utils';
import { checkCronAuth } from '@/lib/cron-auth';

export async function POST(req: NextRequest) {
  const fail = checkCronAuth(req);
  if (fail) return fail;

  const now = new Date();
  const in7Days = new Date(now.getTime() + 7 * 86400_000);
  const in1Day  = new Date(now.getTime() + 86400_000);

  // Окна допуска ±30 минут чтобы не пропускать
  const window = 30 * 60 * 1000;

  let sent7d = 0, sent1d = 0, errors = 0;

  // === Напоминания за 7 дней ===
  const events7d = await db.calendarEvent.findMany({
    where: {
      kind: 'FINGERPRINT',
      reminderSent7d: false,
      startsAt: {
        gte: new Date(in7Days.getTime() - window),
        lte: new Date(in7Days.getTime() + window),
      },
    },
    include: {
      lead: {
        include: {
          client: { select: { fullName: true, phone: true } },
          whatsappAccount: { select: { id: true, isConnected: true } },
        },
      },
    },
  });

  for (const ev of events7d) {
    if (!ev.lead?.whatsappAccount?.isConnected) continue;
    try {
      const text = `Здравствуйте, ${ev.lead.client.fullName}!\n\n` +
        `Напоминаем, что через неделю — ${ev.startsAt.toLocaleDateString('ru-RU')} ` +
        `в ${formatTime(ev.startsAt)} у вас назначены отпечатки${ev.location ? ' в ' + ev.location : ''}.\n\n` +
        `Возьмите оригинал паспорта и заявление.`;

      const res = await workerSendMessage(
        ev.lead.whatsappAccount.id,
        ev.lead.client.phone,
        text,
      );
      if (res.ok) {
        await db.calendarEvent.update({
          where: { id: ev.id },
          data:  { reminderSent7d: true },
        });
        sent7d++;
      }
    } catch (e) {
      console.error('reminder 7d failed:', e);
      errors++;
    }
  }

  // === Напоминания за 1 день ===
  const events1d = await db.calendarEvent.findMany({
    where: {
      kind: 'FINGERPRINT',
      reminderSent1d: false,
      startsAt: {
        gte: new Date(in1Day.getTime() - window),
        lte: new Date(in1Day.getTime() + window),
      },
    },
    include: {
      lead: {
        include: {
          client: { select: { fullName: true, phone: true } },
          whatsappAccount: { select: { id: true, isConnected: true } },
        },
      },
    },
  });

  for (const ev of events1d) {
    if (!ev.lead?.whatsappAccount?.isConnected) continue;
    try {
      const text = `${ev.lead.client.fullName}, добрый день!\n\n` +
        `Завтра в ${formatTime(ev.startsAt)} — отпечатки${ev.location ? ' в ' + ev.location : ''}.\n` +
        `Не забудьте оригинал паспорта и распечатанное заявление.\n\n` +
        `Хорошего дня!`;

      const res = await workerSendMessage(
        ev.lead.whatsappAccount.id,
        ev.lead.client.phone,
        text,
      );
      if (res.ok) {
        await db.calendarEvent.update({
          where: { id: ev.id },
          data:  { reminderSent1d: true },
        });
        sent1d++;
      }
    } catch (e) {
      console.error('reminder 1d failed:', e);
      errors++;
    }
  }

  return NextResponse.json({
    ok: true,
    timestamp: now.toISOString(),
    sent7d,
    sent1d,
    errors,
  });
}
