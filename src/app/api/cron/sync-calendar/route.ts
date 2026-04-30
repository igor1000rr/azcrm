// POST /api/cron/sync-calendar
// Импортирует события из Google Calendar менеджеров в CRM.
// Это нужно чтобы события созданные напрямую в Google (например, через мобилу)
// попадали в CRM-календарь.
//
// Логика:
//   - Для каждого юзера с подключённым Google
//   - Берём события за период (текущая неделя ± 30 дней)
//   - События которых нет в CRM (по googleId) — добавляем как kind=CUSTOM
//   - Не трогаем события с kind=FINGERPRINT/EXTRA_CALL — они под управлением CRM
//
// crontab: 0 * * * * curl -X POST -H "Authorization: Bearer $CRON_SECRET" .../api/cron/sync-calendar

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { listGoogleEvents } from '@/lib/google';
import { checkCronAuth } from '@/lib/cron-auth';
import { logger } from '@/lib/logger';

export async function POST(req: NextRequest) {
  const fail = checkCronAuth(req);
  if (fail) return fail;

  const users = await db.user.findMany({
    where: {
      isActive: true,
      googleRefreshToken: { not: null },
    },
    select: { id: true, name: true },
  });

  const now = new Date();
  const timeMin = new Date(now.getTime() - 30 * 86400_000);
  const timeMax = new Date(now.getTime() + 60 * 86400_000);

  let totalAdded = 0, totalUpdated = 0, totalDeleted = 0, errors = 0;

  for (const user of users) {
    try {
      const events = await listGoogleEvents(user.id, timeMin, timeMax);

      // Существующие в CRM события для этого юзера за период
      const existing = await db.calendarEvent.findMany({
        where: {
          ownerId: user.id,
          googleId: { not: null },
          startsAt: { gte: timeMin, lte: timeMax },
        },
        select: { id: true, googleId: true, kind: true },
      });
      const existingByGoogleId = new Map(existing.map((e) => [e.googleId!, e]));

      // Прошлись по событиям из Google
      const seenGoogleIds = new Set<string>();
      for (const ev of events) {
        if (!ev.start?.dateTime || !ev.end?.dateTime) continue;
        if (ev.status === 'cancelled') continue;

        seenGoogleIds.add(ev.id);
        const startsAt = new Date(ev.start.dateTime);
        const endsAt   = new Date(ev.end.dateTime);

        const existingEvent = existingByGoogleId.get(ev.id);

        if (existingEvent) {
          // CRM-управляемые события (FINGERPRINT/EXTRA_CALL) не трогаем — они source of truth
          if (existingEvent.kind === 'FINGERPRINT' || existingEvent.kind === 'EXTRA_CALL') continue;

          await db.calendarEvent.update({
            where: { id: existingEvent.id },
            data: {
              title:    ev.summary ?? '(без названия)',
              location: ev.location ?? null,
              startsAt, endsAt,
            },
          });
          totalUpdated++;
        } else {
          // Создаём новое событие kind=CUSTOM
          await db.calendarEvent.create({
            data: {
              ownerId:  user.id,
              kind:     'CUSTOM',
              title:    ev.summary ?? '(без названия)',
              location: ev.location ?? null,
              startsAt, endsAt,
              googleId: ev.id,
            },
          });
          totalAdded++;
        }
      }

      // События которые есть в CRM с googleId но в Google пропали — удаляем
      // Только не CRM-управляемые типы
      for (const ev of existing) {
        if (!ev.googleId) continue;
        if (ev.kind === 'FINGERPRINT' || ev.kind === 'EXTRA_CALL') continue;
        if (!seenGoogleIds.has(ev.googleId)) {
          await db.calendarEvent.delete({ where: { id: ev.id } });
          totalDeleted++;
        }
      }
    } catch (e) {
      logger.error(`sync-calendar for ${user.name} failed:`, e);
      errors++;
    }
  }

  return NextResponse.json({
    ok: true,
    timestamp: now.toISOString(),
    users: users.length,
    added: totalAdded,
    updated: totalUpdated,
    deleted: totalDeleted,
    errors,
  });
}
