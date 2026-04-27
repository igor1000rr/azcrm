'use server';

// Учёт рабочего времени. Каждый сотрудник ставит часы на день — сам.
// Админ может смотреть всех. Сотрудник — только свои.
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { canEditWorkLog, assert } from '@/lib/permissions';
import { audit } from '@/lib/audit';

const schema = z.object({
  userId:    z.string().optional(), // если не указан — себе
  date:      z.string().min(1, 'Дата обязательна'),
  startTime: z.string().regex(/^\d{1,2}:\d{2}$/, 'Формат HH:MM'),
  endTime:   z.string().regex(/^\d{1,2}:\d{2}$/, 'Формат HH:MM'),
  notes:     z.string().optional(),
});

function parseTime(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export async function upsertWorkLog(input: z.infer<typeof schema>) {
  const me = await requireUser();
  const data = schema.parse(input);
  const ownerId = data.userId || me.id;
  assert(canEditWorkLog(me, ownerId));

  const startMin = parseTime(data.startTime);
  const endMin = parseTime(data.endTime);
  if (endMin <= startMin) {
    throw new Error('Время окончания должно быть позже начала');
  }
  const hours = (endMin - startMin) / 60;

  const date = new Date(data.date + 'T00:00:00.000Z');

  await db.workLog.upsert({
    where: { userId_date: { userId: ownerId, date } },
    update: {
      startTime: data.startTime,
      endTime:   data.endTime,
      hours,
      notes:     data.notes || null,
    },
    create: {
      userId:    ownerId,
      date,
      startTime: data.startTime,
      endTime:   data.endTime,
      hours,
      notes:     data.notes || null,
    },
  });

  await audit({
    userId: me.id, action: 'worklog.upsert', entityType: 'WorkLog',
    after: { userId: ownerId, date: data.date, hours },
  });

  revalidatePath('/work-calendar');
  revalidatePath('/finance/payroll');
  return { ok: true };
}

export async function deleteWorkLog(date: string, userId?: string) {
  const me = await requireUser();
  const ownerId = userId || me.id;
  assert(canEditWorkLog(me, ownerId));

  await db.workLog.deleteMany({
    where: { userId: ownerId, date: new Date(date + 'T00:00:00.000Z') },
  });

  revalidatePath('/work-calendar');
  revalidatePath('/finance/payroll');
  return { ok: true };
}
