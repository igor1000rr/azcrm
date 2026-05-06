// POST /api/cron/tasks-overdue
//
// Раз в час шлёт TASK_OVERDUE уведомление assignee'ям задач у которых
// dueAt < now() AND status='OPEN'. Дедупликация — через флаг
// `overdueNotifiedAt` в БД (добавляем в Task ниже миграцией).
//
// 06.05.2026 — пункт #88 аудита: до этого NotificationKind.TASK_OVERDUE
// был объявлен в схеме, notify.ts отмечал его как CRITICAL_KIND
// (отправляется email), но НИКТО его не создавал. Просроченные задачи
// тихо висели в БД без напоминаний.
//
// Авторизация — через CRON_SECRET (как в /api/cron/reminders).
//
// crontab пример:
//   0 * * * * curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" https://crm.azgroupcompany.net/api/cron/tasks-overdue

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { notify } from '@/lib/notify';
import { checkCronAuth } from '@/lib/cron-auth';
import { logger } from '@/lib/logger';

export async function POST(req: NextRequest) {
  const fail = checkCronAuth(req);
  if (fail) return fail;

  const now = new Date();

  // Берём все OPEN задачи с прошедшим dueAt и assignee'ем.
  // Без assignee — некому слать. Без dueAt — overdue не applicable.
  //
  // ВАЖНО: дедупликация через notification.findFirst — мы создаём только
  // одну TASK_OVERDUE нотификацию на (userId, taskId). Если флаг уже есть —
  // не дублируем. Это работает без миграции схемы (Notification.link
  // содержит /tasks/<taskId> или /clients/<leadId>?task=<taskId>).
  //
  // Если в будущем нужно повторно напоминать (через 24ч после первого) —
  // добавить новое поле Task.overdueNotifiedAt и проверять > 24ч.
  const overdueTasks = await db.task.findMany({
    where: {
      status: 'OPEN',
      dueAt:  { lt: now },
      assigneeId: { not: null },
    },
    select: {
      id:         true,
      title:      true,
      dueAt:      true,
      priority:   true,
      assigneeId: true,
      leadId:     true,
      lead: { select: { client: { select: { fullName: true } } } },
    },
    take: 200, // защита: за раз не более 200 нотификаций
  });

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const task of overdueTasks) {
    if (!task.assigneeId) { skipped++; continue; }

    // Дедупликация: ищем уже созданное TASK_OVERDUE для этого юзера
    // со ссылкой на эту задачу. Используем contains — link может быть
    // /tasks/<id> или /clients/<leadId>?task=<id>.
    const existing = await db.notification.findFirst({
      where: {
        userId: task.assigneeId,
        kind:   'TASK_OVERDUE',
        link:   { contains: task.id },
      },
      select: { id: true },
    });
    if (existing) { skipped++; continue; }

    try {
      const overdueDays = Math.floor((now.getTime() - task.dueAt!.getTime()) / 86400_000);
      const overdueText = overdueDays === 0
        ? 'просрочена сегодня'
        : `просрочена на ${overdueDays} ${overdueDays === 1 ? 'день' : overdueDays < 5 ? 'дня' : 'дней'}`;

      const clientName = task.lead?.client?.fullName;
      const link = task.leadId ? `/clients/${task.leadId}?task=${task.id}` : `/tasks/${task.id}`;

      await notify({
        userId: task.assigneeId,
        kind:   'TASK_OVERDUE',
        title:  `Задача ${overdueText}: ${task.title}`,
        body:   clientName ? `Клиент: ${clientName}` : null,
        link,
      });
      sent++;
    } catch (e) {
      logger.error(`tasks-overdue notify failed for task ${task.id}:`, e);
      errors++;
    }
  }

  return NextResponse.json({
    ok: true,
    timestamp: now.toISOString(),
    found: overdueTasks.length,
    sent,
    skipped,
    errors,
  });
}
