'use server';

// Server-action для смены воронки лида (Anna 01.05.2026).
// Вынесен в отдельный файл, чтобы не толкать гигантский actions.ts.
//
// Если stageId не указан — лид встаёт на первый этап новой воронки.
// Если указан — должен принадлежать новой воронке (иначе ошибка).
//
// При смене воронки обнуляем serviceId и удаляем все leadService —
// прайс-листы у воронок разные (Karta Pobytu vs Praca). Менеджер
// перевыберет услуги вручную в карточке после смены воронки.

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { canEditLead, assert } from '@/lib/permissions';
import { audit } from '@/lib/audit';

export async function changeLeadFunnel(
  leadId:    string,
  funnelId:  string,
  stageId?:  string,
) {
  const user = await requireUser();

  const lead = await db.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true, salesManagerId: true, legalManagerId: true,
      funnelId: true, stageId: true,
      funnel: { select: { name: true } },
      stage:  { select: { name: true } },
    },
  });
  if (!lead) throw new Error('Лид не найден');
  assert(canEditLead(user, lead));

  // Идемпотентность: если ничего не меняется — выходим.
  if (lead.funnelId === funnelId && (!stageId || stageId === lead.stageId)) {
    return { ok: true };
  }

  const newFunnel = await db.funnel.findUnique({
    where:  { id: funnelId },
    select: { id: true, name: true, isActive: true },
  });
  if (!newFunnel)            throw new Error('Воронка не найдена');
  if (!newFunnel.isActive)   throw new Error('Воронка отключена');

  // Резолвим этап: либо явный, либо первый этап новой воронки.
  let newStageId   = stageId;
  let newStageName: string;
  if (newStageId) {
    const stage = await db.stage.findUnique({
      where:  { id: newStageId },
      select: { id: true, name: true, funnelId: true },
    });
    if (!stage)                       throw new Error('Этап не найден');
    if (stage.funnelId !== funnelId)  throw new Error('Этап не принадлежит выбранной воронке');
    newStageName = stage.name;
  } else {
    const first = await db.stage.findFirst({
      where:   { funnelId },
      orderBy: { position: 'asc' },
      select:  { id: true, name: true },
    });
    if (!first) throw new Error('У воронки нет этапов');
    newStageId   = first.id;
    newStageName = first.name;
  }

  await db.$transaction([
    // Прайс-листы у воронок разные. Чтобы не остался «висеть» неподходящий
    // serviceId/leadServices — обнуляем. Менеджер выберет заново в карточке.
    db.leadService.deleteMany({ where: { leadId } }),
    db.lead.update({
      where: { id: leadId },
      data:  {
        funnelId,
        stageId:   newStageId,
        serviceId: null,
      },
    }),
    db.leadEvent.create({
      data: {
        leadId,
        authorId: user.id,
        kind:     'STAGE_CHANGED',
        message:  `Воронка: ${lead.funnel.name} → ${newFunnel.name} (${newStageName})`,
        payload: {
          fromFunnelId: lead.funnelId,
          toFunnelId:   funnelId,
          fromStageId:  lead.stageId,
          toStageId:    newStageId,
        },
      },
    }),
  ]);

  await audit({
    userId:     user.id,
    action:     'lead.change_funnel',
    entityType: 'Lead',
    entityId:   leadId,
    before:     { funnelId: lead.funnelId, stageId: lead.stageId },
    after:      { funnelId, stageId: newStageId },
  });

  revalidatePath('/funnel');
  revalidatePath(`/clients/${leadId}`);
  return { ok: true };
}
