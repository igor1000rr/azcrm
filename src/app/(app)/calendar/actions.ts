'use server';

// Server Actions для календаря — создание и редактирование встреч с участниками.
// CalendarEvent уже умеет всё что нужно (kind, owner, leadId, participants),
// просто не было UI для создания/редактирования общих встреч (только
// FINGERPRINT/EXTRA_CALL внутри карточки лида).

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { canEditLead, assert } from '@/lib/permissions';
import { notify } from '@/lib/notify';
import { audit } from '@/lib/audit';

const createMeetingSchema = z.object({
  title:        z.string().min(1, 'Укажите название'),
  kind:         z.enum(['INTERNAL_MEETING', 'CONSULTATION', 'CUSTOM']).default('INTERNAL_MEETING'),
  startsAt:     z.string().min(1, 'Укажите дату начала'),
  durationMin:  z.coerce.number().int().min(5).max(720).optional(),
  endsAt:       z.string().optional(),
  location:     z.string().optional(),
  description:  z.string().optional(),
  leadId:       z.string().optional(),
  participantIds: z.array(z.string()).optional(),
});

/**
 * Создать встречу. Любой пользователь может создавать встречи себе и другим
 * (Anna просила: «каждый может делать встречу друг другу»). При наличии leadId
 * проверяем право на редактирование этого лида (стандартная visibility).
 *
 * Длительность: либо явный endsAt, либо durationMin (default 30 мин).
 * Участники: получают push-уведомление через notify() (kind=CUSTOM).
 */
export async function createCalendarMeeting(input: z.infer<typeof createMeetingSchema>) {
  const user = await requireUser();
  const data = createMeetingSchema.parse(input);

  const startsAt = new Date(data.startsAt);
  if (isNaN(startsAt.getTime())) throw new Error('Некорректная дата начала');

  let endsAt: Date;
  if (data.endsAt) {
    endsAt = new Date(data.endsAt);
    if (isNaN(endsAt.getTime())) throw new Error('Некорректная дата окончания');
    if (endsAt <= startsAt) throw new Error('Окончание должно быть позже начала');
  } else {
    const minutes = data.durationMin ?? 30;
    endsAt = new Date(startsAt.getTime() + minutes * 60 * 1000);
  }

  // Валидация привязки к лиду (если есть)
  if (data.leadId) {
    const lead = await db.lead.findUnique({
      where: { id: data.leadId },
      select: { id: true, salesManagerId: true, legalManagerId: true },
    });
    if (!lead) throw new Error('Лид не найден');
    assert(canEditLead(user, lead));
  }

  // Уведомляем всех кроме самого создателя
  const participantIds = (data.participantIds || []).filter((id) => id && id !== user.id);
  const uniqueParticipants = [...new Set(participantIds)];

  const event = await db.$transaction(async (tx) => {
    const created = await tx.calendarEvent.create({
      data: {
        ownerId:     user.id,
        leadId:      data.leadId || null,
        kind:        data.kind,
        title:       data.title.trim(),
        location:    data.location?.trim() || null,
        description: data.description?.trim() || null,
        startsAt,
        endsAt,
      },
    });

    if (uniqueParticipants.length > 0) {
      const validUsers = await tx.user.findMany({
        where: { id: { in: uniqueParticipants }, isActive: true },
        select: { id: true },
      });
      const validIds = validUsers.map((u) => u.id);

      if (validIds.length > 0) {
        await tx.calendarEventParticipant.createMany({
          data: validIds.map((userId) => ({
            eventId: created.id,
            userId,
          })),
          skipDuplicates: true,
        });
      }
    }

    return created;
  });

  for (const participantId of uniqueParticipants) {
    try {
      await notify({
        userId: participantId,
        kind:   'CUSTOM',
        title:  `${user.name} пригласил(а) вас на встречу`,
        body:   `${data.title.trim()} — ${startsAt.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
        link:   '/calendar',
      });
    } catch (e) {
      console.error('failed to notify participant', participantId, e);
    }
  }

  await audit({
    userId:     user.id,
    action:     'calendar.create_meeting',
    entityType: 'CalendarEvent',
    entityId:   event.id,
    after:      {
      title:        data.title,
      kind:         data.kind,
      startsAt:     startsAt.toISOString(),
      leadId:       data.leadId ?? null,
      participants: uniqueParticipants,
    },
  });

  revalidatePath('/calendar');
  if (data.leadId) revalidatePath(`/clients/${data.leadId}`);

  return { id: event.id };
}

// ====================== РЕДАКТИРОВАНИЕ ======================

const updateMeetingSchema = createMeetingSchema.extend({
  id: z.string().min(1),
});

/**
 * Обновить встречу. Только владелец события или админ может редактировать.
 *
 * Особенности:
 *   - FINGERPRINT и EXTRA_CALL события создаются через карточку лида с Google
 *     Calendar синхронизацией — их редактировать через эту функцию НЕ даём,
 *     иначе разсинхронизация. Менять надо через карточку лида.
 *   - Список участников полностью пересоздаётся (deleteMany + createMany) —
 *     проще чем дифф, и notify-логика остаётся прозрачной (новых уведомляем,
 *     удалённых нет — это редактирование, не создание).
 */
export async function updateCalendarMeeting(input: z.infer<typeof updateMeetingSchema>) {
  const user = await requireUser();
  const data = updateMeetingSchema.parse(input);

  const existing = await db.calendarEvent.findUnique({
    where: { id: data.id },
    select: {
      id: true, ownerId: true, kind: true, googleId: true, leadId: true,
      participants: { select: { userId: true } },
    },
  });
  if (!existing) throw new Error('Событие не найдено');

  // Только владелец или админ
  if (user.role !== 'ADMIN' && existing.ownerId !== user.id) {
    throw new Error('Только владелец или админ может редактировать');
  }

  // Запрещаем редактировать FINGERPRINT/EXTRA_CALL — они синхронизированы
  // с Google Calendar через свои actions.
  if (existing.kind === 'FINGERPRINT' || existing.kind === 'EXTRA_CALL') {
    throw new Error('Это событие создано из карточки клиента. Редактируйте через карточку.');
  }

  const startsAt = new Date(data.startsAt);
  if (isNaN(startsAt.getTime())) throw new Error('Некорректная дата начала');

  let endsAt: Date;
  if (data.endsAt) {
    endsAt = new Date(data.endsAt);
    if (isNaN(endsAt.getTime())) throw new Error('Некорректная дата окончания');
    if (endsAt <= startsAt) throw new Error('Окончание должно быть позже начала');
  } else {
    const minutes = data.durationMin ?? 30;
    endsAt = new Date(startsAt.getTime() + minutes * 60 * 1000);
  }

  if (data.leadId) {
    const lead = await db.lead.findUnique({
      where: { id: data.leadId },
      select: { id: true, salesManagerId: true, legalManagerId: true },
    });
    if (!lead) throw new Error('Лид не найден');
    assert(canEditLead(user, lead));
  }

  const newParticipantIds = (data.participantIds || []).filter((id) => id && id !== user.id);
  const uniqueNew = [...new Set(newParticipantIds)];
  const oldIds = new Set(existing.participants.map((p) => p.userId));
  // Кого нужно уведомить (новые приглашённые) — только тех кого ещё не было
  const newlyInvited = uniqueNew.filter((id) => !oldIds.has(id));

  await db.$transaction(async (tx) => {
    await tx.calendarEvent.update({
      where: { id: data.id },
      data: {
        kind:        data.kind,
        title:       data.title.trim(),
        location:    data.location?.trim() || null,
        description: data.description?.trim() || null,
        leadId:      data.leadId || null,
        startsAt,
        endsAt,
      },
    });

    // Перезаписываем участников полностью
    await tx.calendarEventParticipant.deleteMany({
      where: { eventId: data.id },
    });

    if (uniqueNew.length > 0) {
      const validUsers = await tx.user.findMany({
        where: { id: { in: uniqueNew }, isActive: true },
        select: { id: true },
      });
      const validIds = validUsers.map((u) => u.id);
      if (validIds.length > 0) {
        await tx.calendarEventParticipant.createMany({
          data: validIds.map((userId) => ({
            eventId: data.id,
            userId,
          })),
          skipDuplicates: true,
        });
      }
    }
  });

  // Уведомления только новым
  for (const participantId of newlyInvited) {
    try {
      await notify({
        userId: participantId,
        kind:   'CUSTOM',
        title:  `${user.name} пригласил(а) вас на встречу`,
        body:   `${data.title.trim()} — ${startsAt.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
        link:   '/calendar',
      });
    } catch (e) {
      console.error('failed to notify participant', participantId, e);
    }
  }

  await audit({
    userId:     user.id,
    action:     'calendar.update_meeting',
    entityType: 'CalendarEvent',
    entityId:   data.id,
    after:      {
      title:        data.title,
      kind:         data.kind,
      startsAt:     startsAt.toISOString(),
      leadId:       data.leadId ?? null,
      participants: uniqueNew,
    },
  });

  revalidatePath('/calendar');
  if (existing.leadId) revalidatePath(`/clients/${existing.leadId}`);
  if (data.leadId && data.leadId !== existing.leadId) {
    revalidatePath(`/clients/${data.leadId}`);
  }

  return { id: data.id };
}
