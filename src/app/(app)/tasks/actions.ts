'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { notify } from '@/lib/notify';

const taskSchema = z.object({
  id:          z.string().optional(),
  title:       z.string().min(1).max(200),
  description: z.string().nullable().optional(),
  leadId:      z.string().nullable().optional(),
  assigneeId:  z.string().nullable().optional(),
  priority:    z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  dueAt:       z.string().nullable().optional(),
});

export async function upsertTask(input: z.infer<typeof taskSchema>) {
  const user = await requireUser();
  const data = taskSchema.parse(input);

  const dueAt = data.dueAt ? new Date(data.dueAt) : null;

  if (data.id) {
    const existing = await db.task.findUnique({
      where: { id: data.id },
      select: { creatorId: true, assigneeId: true },
    });
    if (!existing) throw new Error('Задача не найдена');
    // Право: создатель, текущий исполнитель или админ
    if (
      user.role !== 'ADMIN'
      && existing.creatorId !== user.id
      && existing.assigneeId !== user.id
    ) {
      throw new Error('Недостаточно прав');
    }

    await db.task.update({
      where: { id: data.id },
      data: {
        title:       data.title,
        description: data.description ?? null,
        leadId:      data.leadId || null,
        assigneeId:  data.assigneeId || null,
        priority:    data.priority,
        dueAt,
      },
    });

    if (data.assigneeId && data.assigneeId !== existing.assigneeId && data.assigneeId !== user.id) {
      await notify({
        userId: data.assigneeId,
        kind:   'TASK_ASSIGNED',
        title:  `${user.name} назначил вам задачу`,
        body:   data.title,
        link:   '/tasks',
      });
    }
  } else {
    const created = await db.task.create({
      data: {
        title:       data.title,
        description: data.description ?? null,
        leadId:      data.leadId || null,
        assigneeId:  data.assigneeId || null,
        creatorId:   user.id,
        priority:    data.priority,
        dueAt,
      },
    });

    if (data.assigneeId && data.assigneeId !== user.id) {
      await notify({
        userId: data.assigneeId,
        kind:   'TASK_ASSIGNED',
        title:  `${user.name} назначил вам задачу`,
        body:   data.title,
        link:   '/tasks',
      });
    }

    if (data.leadId) {
      await db.leadEvent.create({
        data: {
          leadId: data.leadId, authorId: user.id,
          kind: 'TASK_CREATED', message: `Задача: ${data.title}`,
        },
      });
    }

    return { id: created.id };
  }

  revalidatePath('/tasks');
  return { ok: true };
}

export async function setTaskStatus(id: string, status: 'OPEN' | 'DONE' | 'CANCELLED') {
  const user = await requireUser();
  const task = await db.task.findUnique({
    where: { id },
    select: { creatorId: true, assigneeId: true },
  });
  if (!task) throw new Error('Не найдено');
  if (
    user.role !== 'ADMIN'
    && task.creatorId !== user.id
    && task.assigneeId !== user.id
  ) {
    throw new Error('Недостаточно прав');
  }

  await db.task.update({
    where: { id },
    data: {
      status,
      completedAt: status === 'DONE' ? new Date() : null,
    },
  });
  revalidatePath('/tasks');
  return { ok: true };
}

export async function deleteTask(id: string) {
  const user = await requireUser();
  const task = await db.task.findUnique({
    where: { id }, select: { creatorId: true },
  });
  if (!task) throw new Error('Не найдено');
  if (user.role !== 'ADMIN' && task.creatorId !== user.id) {
    throw new Error('Удалять может только создатель или админ');
  }
  await db.task.delete({ where: { id } });
  revalidatePath('/tasks');
  return { ok: true };
}
