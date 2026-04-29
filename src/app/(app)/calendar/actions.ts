'use server';

// Server Actions для календаря — создание встреч с участниками.
// CalendarEvent уже умеет всё что нужно (kind, owner, leadId, participants),
// просто не было UI для создания общих встреч (только FINGERPRINT/EXTRA_CALL
// внутри карточки лида).

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

  // Уведомляем всех кроме самого создателя (себе уведомление не нужно)
  const participantIds = (data.participantIds || []).filter((id) => id && id !== user.id);
  // Дедуп
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
      // Проверяем что все participantIds — реальные активные юзеры
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

  // Уведомления участникам — после транзакции, асинхронно (не валим встречу
  // если не отправилось).
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
