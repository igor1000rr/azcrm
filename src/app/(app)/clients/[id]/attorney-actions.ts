'use server';

// Установка пелномоцника (Pelnomocnik) для лида.
// Список — менеджеры легализации + админ (Анна).
// Хранится как строковое имя в lead.attorney (для гибкости — можно ввести
// и не из списка, если нужно).

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { canEditLead, assert } from '@/lib/permissions';

export async function setAttorney(leadId: string, attorneyName: string | null) {
  const user = await requireUser();

  const lead = await db.lead.findUnique({
    where: { id: leadId },
    select: { id: true, salesManagerId: true, legalManagerId: true, attorney: true },
  });
  if (!lead) throw new Error('Лид не найден');
  assert(canEditLead(user, lead));

  const trimmed = attorneyName?.trim() || null;
  if (trimmed === lead.attorney) return { ok: true };

  await db.$transaction([
    db.lead.update({
      where: { id: leadId },
      data: { attorney: trimmed },
    }),
    db.leadEvent.create({
      data: {
        leadId,
        authorId: user.id,
        kind: 'CUSTOM',
        message: trimmed
          ? `Назначен Pelnomocnik: ${trimmed}`
          : 'Pelnomocnik снят',
        payload: { from: lead.attorney, to: trimmed },
      },
    }),
  ]);

  revalidatePath(`/clients/${leadId}`);
  return { ok: true };
}
