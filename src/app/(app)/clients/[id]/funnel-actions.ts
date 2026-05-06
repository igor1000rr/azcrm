'use server';

// Server-action для смены воронки лида (Anna 01.05.2026).
// Вынесен в отдельный файл, чтобы не толкать гигантский actions.ts.
//
// Если stageId не указан — лид встаёт на первый этап новой воронки.
// Если указан — должен принадлежать новой воронке (иначе ошибка).
//
// При смене воронки сбрасываем всё связанное со старой услугой:
//   - serviceId, leadServices  (прайс-листы у воронок разные)
//   - totalAmount → 0          (#65 аудита: иначе остаётся стоимость старой услуги)
//   - LeadDocument чек-лист    (#66 аудита: документы старой услуги не подходят
//                                к новой; пересоздаём из шаблонов воронки если есть)

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
      totalAmount: true,
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

  // Шаблоны документов для НОВОЙ воронки (legacy fallback — без привязки
  // к услуге; пользователь сам потом привяжет услуги и добавит её документы).
  // Когда менеджер выберет услугу через UI, новые документы по этой услуге
  // будут добавлены отдельно (см. addLeadService в actions.ts).
  const funnelDocTemplates = await db.documentTemplate.findMany({
    where: { funnelId, serviceId: null },
    orderBy: { position: 'asc' },
    select: { name: true, position: true, isRequired: true },
  });

  const oldTotalAmount = Number(lead.totalAmount);

  await db.$transaction([
    // Прайс-листы у воронок разные → удаляем услуги и обнуляем serviceId
    db.leadService.deleteMany({ where: { leadId } }),

    // Чек-лист от старой воронки/услуги → удаляем (#66)
    db.leadDocument.deleteMany({ where: { leadId } }),

    // Лид: новая воронка/этап + сброс serviceId + обнуление totalAmount (#65)
    db.lead.update({
      where: { id: leadId },
      data:  {
        funnelId,
        stageId:     newStageId,
        serviceId:   null,
        totalAmount: 0,
      },
    }),

    // Новый чек-лист — из шаблонов новой воронки (если они заданы).
    // Если у воронки шаблонов нет — список останется пустым, менеджер
    // добавит услугу и оттуда подтянутся её документы.
    ...(funnelDocTemplates.length > 0 ? [
      db.leadDocument.createMany({
        data: funnelDocTemplates.map((t) => ({
          leadId,
          name:     t.name,
          position: t.position,
          isPresent: false,
        })),
      }),
    ] : []),

    db.leadEvent.create({
      data: {
        leadId,
        authorId: user.id,
        kind:     'STAGE_CHANGED',
        message:
          `Воронка: ${lead.funnel.name} → ${newFunnel.name} (${newStageName}). ` +
          `Сброшены услуги, чек-лист и стоимость${oldTotalAmount > 0 ? ` (была ${oldTotalAmount} zł)` : ''}.`,
        payload: {
          fromFunnelId:    lead.funnelId,
          toFunnelId:      funnelId,
          fromStageId:     lead.stageId,
          toStageId:       newStageId,
          oldTotalAmount,
          newDocsCount:    funnelDocTemplates.length,
        },
      },
    }),
  ]);

  await audit({
    userId:     user.id,
    action:     'lead.change_funnel',
    entityType: 'Lead',
    entityId:   leadId,
    before:     {
      funnelId: lead.funnelId,
      stageId:  lead.stageId,
      totalAmount: oldTotalAmount,
    },
    after:      {
      funnelId,
      stageId:     newStageId,
      totalAmount: 0,
      docsReset:   true,
    },
  });

  revalidatePath('/funnel');
  revalidatePath(`/clients/${leadId}`);
  return { ok: true };
}
