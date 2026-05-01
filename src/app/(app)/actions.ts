'use server';

// Server Actions — все мутации над лидами
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireUser, requireAdmin } from '@/lib/auth';
import {
  canEditLead, canTransferLead, canAssignLegalManager,
  canDeletePayment,
  assert,
} from '@/lib/permissions';
import { normalizePhone } from '@/lib/utils';
import { notify } from '@/lib/notify';
import { audit } from '@/lib/audit';
import { logger } from '@/lib/logger';

// ====================== СОЗДАНИЕ ЛИДА ======================

const leadServiceItem = z.object({
  serviceId: z.string().min(1),
  amount:    z.coerce.number().min(0).optional(),
  qty:       z.coerce.number().int().min(1).default(1),
  notes:     z.string().optional(),
});

const createLeadSchema = z.object({
  // Клиент: либо существующий, либо новый
  clientId:      z.string().optional(),
  // Если новый клиент:
  fullName:      z.string().min(2, 'Укажите ФИО').optional(),
  phone:         z.string().min(5, 'Укажите телефон').optional(),
  email:         z.string().email().optional().or(z.literal('')),
  birthDate:     z.string().optional().or(z.literal('')),
  nationality:   z.string().optional(),
  addressPL:     z.string().optional(),
  addressHome:   z.string().optional(),

  // Лид
  funnelId:      z.string().min(1, 'Выберите воронку'),
  stageId:       z.string().optional(),
  cityId:        z.string().optional(),       // город обращения
  workCityId:    z.string().optional(),       // город работы (karta praca)
  source:        z.string().optional(),
  sourceKind:    z.enum(['WHATSAPP','PHONE','TELEGRAM','EMAIL','WEBSITE','REFERRAL','WALK_IN','MANUAL','IMPORT','OTHER']).optional(),
  whatsappAccountId: z.string().optional(),
  telegramAccountId: z.string().optional(),

  // Работодатель (ручной ввод, для karta praca)
  employerName:  z.string().optional(),
  employerPhone: z.string().optional(),

  // Услуги:
  //  - быстрый способ: одна услуга через serviceId
  //  - или несколько через services[]
  serviceId:     z.string().optional(),
  services:      z.array(leadServiceItem).optional(),

  salesManagerId: z.string().optional(),
  legalManagerId: z.string().optional(),
  totalAmount:   z.coerce.number().min(0).default(0),
  summary:       z.string().optional(),
});

export async function createLead(input: z.infer<typeof createLeadSchema>) {
  const user = await requireUser();
  const data = createLeadSchema.parse(input);

  // Шаг 1: клиент — найти или создать
  let clientId = data.clientId;

  if (!clientId) {
    if (!data.fullName || !data.phone) {
      throw new Error('Укажите ФИО и телефон клиента');
    }
    const phone = normalizePhone(data.phone);
    // Дедупликация по телефону
    const existing = await db.client.findUnique({ where: { phone } });
    if (existing) {
      clientId = existing.id;
    } else {
      const created = await db.client.create({
        data: {
          fullName:    data.fullName,
          phone,
          email:       data.email || null,
          birthDate:   data.birthDate ? new Date(data.birthDate) : null,
          nationality: data.nationality || null,
          addressPL:   data.addressPL || null,
          addressHome: data.addressHome || null,
          cityId:      data.cityId || null,
          ownerId:     user.id,
          source:      data.source || null,
        },
      });
      clientId = created.id;
    }
  }

  // Шаг 2: первый этап воронки если не указан
  let stageId = data.stageId;
  if (!stageId) {
    const firstStage = await db.stage.findFirst({
      where: { funnelId: data.funnelId },
      orderBy: { position: 'asc' },
    });
    if (!firstStage) throw new Error('У воронки нет этапов');
    stageId = firstStage.id;
  }

  // Шаг 3: подготовка услуг и суммы
  // Собираем итоговый список услуг: либо services[], либо [{serviceId}] если задан один
  const serviceItems = data.services && data.services.length > 0
    ? data.services
    : data.serviceId
      ? [{ serviceId: data.serviceId, qty: 1, amount: undefined as number | undefined, notes: undefined }]
      : [];

  // Подгружаем basePrice для услуг без явно указанной цены
  const serviceIds = serviceItems.map((s) => s.serviceId);
  const serviceRecords = serviceIds.length
    ? await db.service.findMany({
        where: { id: { in: serviceIds } },
        select: { id: true, basePrice: true },
      })
    : [];
  const basePriceMap = new Map(serviceRecords.map((s) => [s.id, Number(s.basePrice)]));

  // Резолвим фактическую цену каждой услуги лида
  const resolvedServices = serviceItems.map((s, i) => ({
    serviceId: s.serviceId,
    amount:    s.amount ?? basePriceMap.get(s.serviceId) ?? 0,
    qty:       s.qty ?? 1,
    notes:     s.notes,
    position:  i,
  }));

  // Сумма по всем услугам
  const calculatedTotal = resolvedServices.reduce((s, r) => s + r.amount * r.qty, 0);
  const totalAmount = data.totalAmount > 0 ? data.totalAmount : calculatedTotal;

  // Основная услуга — явный serviceId, иначе первая из services[]
  const primaryServiceId = data.serviceId ?? resolvedServices[0]?.serviceId ?? null;

  // Шаг 4: чек-лист документов
  // Приоритет — из выбранных услуг. Дедуплицируем по name.
  const docTemplates = serviceIds.length
    ? await db.documentTemplate.findMany({
        where: { serviceId: { in: serviceIds } },
        orderBy: { position: 'asc' },
      })
    : await db.documentTemplate.findMany({
        where: { funnelId: data.funnelId },
        orderBy: { position: 'asc' },
      });

  // Дедупликация по имени (две услуги могут требовать «Загранпаспорт»)
  const seenDocs = new Set<string>();
  const dedupedDocs: typeof docTemplates = [];
  for (const t of docTemplates) {
    const key = t.name.trim().toLowerCase();
    if (seenDocs.has(key)) continue;
    seenDocs.add(key);
    dedupedDocs.push(t);
  }

  // Шаг 5: создаём лида со всем в одной транзакции
  const lead = await db.$transaction(async (tx) => {
    const created = await tx.lead.create({
      data: {
        clientId,
        funnelId:       data.funnelId,
        stageId,
        cityId:         data.cityId || null,
        workCityId:     data.workCityId || null,
        source:         data.source || null,
        sourceKind:     data.sourceKind ?? 'MANUAL',
        whatsappAccountId: data.whatsappAccountId || null,
        telegramAccountId: data.telegramAccountId || null,
        employerName:   data.employerName || null,
        employerPhone:  data.employerPhone || null,
        serviceId:      primaryServiceId,
        salesManagerId: data.salesManagerId || (user.role === 'SALES' ? user.id : null),
        legalManagerId: data.legalManagerId || null,
        totalAmount,
        summary:        data.summary || null,
        firstContactAt: new Date(),
        documents: {
          create: dedupedDocs.map((t, i) => ({
            name:      t.name,
            position:  i + 1,
            isPresent: false,
          })),
        },
        events: {
          create: {
            authorId: user.id,
            kind:     'LEAD_CREATED',
            message:  'Лид создан',
          },
        },
      },
    });

    // Связь M:N с услугами
    if (resolvedServices.length > 0) {
      await tx.leadService.createMany({
        data: resolvedServices.map((r) => ({
          leadId:    created.id,
          serviceId: r.serviceId,
          amount:    r.amount,
          qty:       r.qty,
          notes:     r.notes ?? null,
          position:  r.position,
        })),
      });
    }

    return created;
  });

  revalidatePath('/funnel');
  revalidatePath('/clients');

  await audit({
    userId:     user.id,
    action:     'lead.create',
    entityType: 'Lead',
    entityId:   lead.id,
    after:      {
      clientId, funnelId: data.funnelId, totalAmount,
      services: resolvedServices.map((r) => r.serviceId),
      employerName: data.employerName, workCityId: data.workCityId,
    },
  });

  return { id: lead.id, clientId };
}

// ====================== СМЕНА ЭТАПА ======================

export async function changeLeadStage(leadId: string, stageId: string) {
  const user = await requireUser();

  const lead = await db.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true, salesManagerId: true, legalManagerId: true,
      stageId: true, funnelId: true,
      stage: { select: { name: true } },
    },
  });
  if (!lead) throw new Error('Лид не найден');
  assert(canEditLead(user, lead));

  const newStage = await db.stage.findUnique({
    where: { id: stageId },
    select: { id: true, name: true, funnelId: true },
  });
  if (!newStage || newStage.funnelId !== lead.funnelId) {
    throw new Error('Этап не принадлежит воронке лида');
  }

  if (lead.stageId === stageId) return { ok: true };

  await db.$transaction([
    db.lead.update({
      where: { id: leadId },
      data:  { stageId },
    }),
    db.leadEvent.create({
      data: {
        leadId,
        authorId: user.id,
        kind:     'STAGE_CHANGED',
        message:  `${lead.stage.name} → ${newStage.name}`,
        payload:  { fromStageId: lead.stageId, toStageId: stageId },
      },
    }),
  ]);

  revalidatePath('/funnel');
  revalidatePath(`/clients/${lead.id}`);
  return { ok: true };
}

// ====================== ПЕРЕДАЧА МЕНЕДЖЕРА ======================

export async function reassignSalesManager(leadId: string, newSalesId: string | null) {
  const user = await requireUser();

  const lead = await db.lead.findUnique({
    where: { id: leadId },
    select: { id: true, salesManagerId: true, legalManagerId: true },
  });
  if (!lead) throw new Error('Лид не найден');
  assert(canTransferLead(user, lead));

  await db.$transaction([
    db.lead.update({
      where: { id: leadId },
      data:  { salesManagerId: newSalesId },
    }),
    db.leadEvent.create({
      data: {
        leadId,
        authorId: user.id,
        kind:     'MANAGER_CHANGED',
        message:  newSalesId ? 'Сменён менеджер продаж' : 'Снят менеджер продаж',
        payload:  { type: 'sales', from: lead.salesManagerId, to: newSalesId },
      },
    }),
  ]);

  if (newSalesId && newSalesId !== user.id) {
    await notify({
      userId: newSalesId,
      kind:   'LEAD_TRANSFERRED',
      title:  `${user.name} передал вам лида`,
      link:   `/clients/${leadId}`,
    });
  }

  await audit({
    userId:     user.id,
    action:     'lead.reassign_sales',
    entityType: 'Lead',
    entityId:   leadId,
    before:     { salesManagerId: lead.salesManagerId },
    after:      { salesManagerId: newSalesId },
  });

  revalidatePath('/funnel');
  revalidatePath(`/clients/${leadId}`);
  return { ok: true };
}

export async function reassignLegalManager(leadId: string, newLegalId: string | null) {
  const user = await requireUser();

  const lead = await db.lead.findUnique({
    where: { id: leadId },
    select: { id: true, salesManagerId: true, legalManagerId: true },
  });
  if (!lead) throw new Error('Лид не найден');
  assert(canAssignLegalManager(user, lead));

  await db.$transaction([
    db.lead.update({
      where: { id: leadId },
      data:  { legalManagerId: newLegalId },
    }),
    db.leadEvent.create({
      data: {
        leadId,
        authorId: user.id,
        kind:     'MANAGER_CHANGED',
        message:  newLegalId ? 'Назначен менеджер легализации' : 'Снят менеджер легализации',
        payload:  { type: 'legal', from: lead.legalManagerId, to: newLegalId },
      },
    }),
  ]);

  if (newLegalId && newLegalId !== user.id) {
    await notify({
      userId: newLegalId,
      kind:   'LEAD_TRANSFERRED',
      title:  `${user.name} назначил вам лида (легализация)`,
      link:   `/clients/${leadId}`,
    });
  }

  await audit({
    userId:     user.id,
    action:     'lead.reassign_legal',
    entityType: 'Lead',
    entityId:   leadId,
    before:     { legalManagerId: lead.legalManagerId },
    after:      { legalManagerId: newLegalId },
  });

  revalidatePath('/funnel');
  revalidatePath(`/clients/${leadId}`);
  return { ok: true };
}

// Pelnomocnik (доверенное лицо) — см. ./clients/[id]/attorney-actions.ts (setAttorney)

// ====================== ОПЛАТЫ ======================

const addPaymentSchema = z.object({
  leadId: z.string(),
  amount: z.coerce.number().positive('Сумма должна быть положительной'),
  method: z.enum(['CARD', 'CASH', 'TRANSFER', 'OTHER']).default('CASH'),
  paidAt: z.string().optional(),
  notes:  z.string().optional(),
});

/**
 * Логика начисления премий (Anna 28.04.2026):
 *   - sequence=1 (первый платёж / предоплата)
 *       → SALES получает свой %
 *       → если этот платёж = полная стоимость лида (одна оплата за всё),
 *         то LEGAL ТОЖЕ получает свой % сразу (Anna: «вряд ли такие случаи
 *         будут, это их зп — пусть оба получат»)
 *   - sequence=2 → LEGAL получает свой % (если ещё не получил)
 *   - sequence>=3 → премий не начисляем
 *
 * % берётся в порядке приоритета:
 *   1. User.commissionPercent (персональный, если задан)
 *   2. Service.salesCommissionPercent / legalCommissionPercent (по основной услуге)
 *   3. 5% по умолчанию
 */
export async function addPayment(input: z.infer<typeof addPaymentSchema>) {
  const user = await requireUser();
  const data = addPaymentSchema.parse(input);

  const lead = await db.lead.findUnique({
    where: { id: data.leadId },
    select: {
      id: true,
      totalAmount: true,
      salesManagerId: true,
      legalManagerId: true,
      service: { select: { salesCommissionPercent: true, legalCommissionPercent: true } },
      // Персональные % менеджеров — приоритетнее % услуги
      salesManager:   { select: { commissionPercent: true } },
      legalManager:   { select: { commissionPercent: true } },
    },
  });
  if (!lead) throw new Error('Лид не найден');
  assert(canEditLead(user, lead));

  // Резолвим эффективный % для SALES и LEGAL по приоритету
  const FALLBACK_PCT = 5;
  const salesPct = lead.salesManager?.commissionPercent != null
    ? Number(lead.salesManager.commissionPercent)
    : (lead.service ? Number(lead.service.salesCommissionPercent) : FALLBACK_PCT);
  const legalPct = lead.legalManager?.commissionPercent != null
    ? Number(lead.legalManager.commissionPercent)
    : (lead.service ? Number(lead.service.legalCommissionPercent) : FALLBACK_PCT);

  // Создание платежа + комиссий + события атомарно с retry на P2002
  // (race condition: два параллельных addPayment могут получить одинаковый
  // sequence; @@unique([leadId, sequence]) отбросит второй — повторяем).
  const MAX_RETRIES = 5;
  let lastErr: unknown = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await db.$transaction(async (tx) => {
        const last = await tx.payment.aggregate({
          where: { leadId: data.leadId },
          _max:  { sequence: true },
        });
        const sequence = (last._max.sequence ?? 0) + 1;

        const payment = await tx.payment.create({
          data: {
            leadId:      data.leadId,
            amount:      data.amount,
            method:      data.method,
            paidAt:      data.paidAt ? new Date(data.paidAt) : new Date(),
            notes:       data.notes || null,
            sequence,
            createdById: user.id,
          },
        });

        // Кейс «полной оплаты сразу»: первый платёж покрывает всю сумму лида.
        // Тогда И SALES, И LEGAL получают свои % сразу с этого одного платежа.
        // Защита от плавающей запятой через малую дельту 0.01 zł.
        const isFullUpfront =
          sequence === 1
          && Number(lead.totalAmount) > 0
          && Number(data.amount) >= Number(lead.totalAmount) - 0.01;

        // Кому начисляем по этому платежу
        const accruals: Array<{
          role:    'SALES' | 'LEGAL';
          userId:  string;
          percent: number;
          amount:  number;
        }> = [];

        // SALES — на первом платеже
        if (sequence === 1 && lead.salesManagerId && salesPct > 0) {
          accruals.push({
            role:    'SALES',
            userId:  lead.salesManagerId,
            percent: salesPct,
            amount:  Math.round((data.amount * salesPct) / 100 * 100) / 100,
          });
        }
        // LEGAL — на втором платеже ИЛИ на первом если он покрыл всё
        if (lead.legalManagerId && legalPct > 0) {
          if (sequence === 2 || (sequence === 1 && isFullUpfront)) {
            accruals.push({
              role:    'LEGAL',
              userId:  lead.legalManagerId,
              percent: legalPct,
              amount:  Math.round((data.amount * legalPct) / 100 * 100) / 100,
            });
          }
        }

        // Создаём по одной premium-записи на каждое начисление через .create()
        // (а не createMany) — так проще тестировать и совместимо со старым моком
        // Prisma в integration-тестах. Премий максимум 2 — оверхед минимальный.
        for (const a of accruals) {
          await tx.commission.create({
            data: {
              paymentId:   payment.id,
              userId:      a.userId,
              role:        a.role,
              basePayment: data.amount,
              percent:     a.percent,
              amount:      a.amount,
            },
          });
        }

        // Сообщение для истории
        let commissionNote = '';
        if (accruals.length > 0) {
          const parts = accruals.map((a) =>
            `${a.role === 'SALES' ? 'продажи' : 'легализация'} ${a.percent}% = ${a.amount} zł`,
          );
          commissionNote = `, премии: ${parts.join(', ')}`;
          if (isFullUpfront && accruals.length === 2) {
            commissionNote += ' (полная оплата сразу)';
          }
        } else if (sequence >= 3) {
          commissionNote = ` (без премий — платёж #${sequence})`;
        }

        await tx.leadEvent.create({
          data: {
            leadId:   data.leadId,
            authorId: user.id,
            kind:     'PAYMENT_ADDED',
            message:  `+${data.amount} zł (${methodLabel(data.method)}, платёж #${sequence}${commissionNote})`,
            payload:  {
              paymentId:   payment.id,
              amount:      data.amount,
              method:      data.method,
              sequence,
              commissions: accruals.map((a) => ({
                role: a.role, percent: a.percent, amount: a.amount,
              })),
              isFullUpfront,
            },
          },
        });

        return { id: payment.id };
      });

      revalidatePath(`/clients/${data.leadId}`);
      revalidatePath('/payments');
      revalidatePath('/finance/commissions');
      revalidatePath('/finance/payroll');
      return result;
    } catch (e) {
      lastErr = e;
      const code = (e as { code?: string }).code;
      if (code === 'P2002') continue;
      throw e;
    }
  }

  throw new Error(`Не удалось создать платёж после ${MAX_RETRIES} попыток: ${(lastErr as Error)?.message ?? 'unknown'}`);
}

export async function deletePayment(paymentId: string) {
  const user = await requireUser();
  assert(canDeletePayment(user));

  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    select: { leadId: true, amount: true, method: true },
  });
  if (!payment) throw new Error('Платёж не найден');

  await db.$transaction([
    db.payment.delete({ where: { id: paymentId } }),
    db.leadEvent.create({
      data: {
        leadId:   payment.leadId,
        authorId: user.id,
        kind:     'PAYMENT_REMOVED',
        message:  `Удалён платёж: ${payment.amount} zł`,
        payload:  { amount: payment.amount, method: payment.method },
      },
    }),
  ]);

  await audit({
    userId:     user.id,
    action:     'payment.delete',
    entityType: 'Payment',
    entityId:   paymentId,
    before:     { amount: Number(payment.amount), method: payment.method },
  });

  revalidatePath(`/clients/${payment.leadId}`);
  revalidatePath('/payments');
  revalidatePath('/finance/commissions');
  revalidatePath('/finance/payroll');
  return { ok: true };
}

// ====================== ДОКУМЕНТЫ (галочки) ======================

export async function toggleDocument(documentId: string, isPresent: boolean) {
  const user = await requireUser();

  const doc = await db.leadDocument.findUnique({
    where: { id: documentId },
    select: {
      id: true, name: true, leadId: true,
      lead: { select: { salesManagerId: true, legalManagerId: true } },
    },
  });
  if (!doc) throw new Error('Документ не найден');
  assert(canEditLead(user, doc.lead));

  await db.$transaction([
    db.leadDocument.update({
      where: { id: documentId },
      data:  { isPresent },
    }),
    db.leadEvent.create({
      data: {
        leadId:   doc.leadId,
        authorId: user.id,
        kind:     'DOCUMENT_TOGGLED',
        message:  `${doc.name}: ${isPresent ? 'есть' : 'нет'}`,
        payload:  { documentId, isPresent },
      },
    }),
  ]);

  revalidatePath(`/clients/${doc.leadId}`);
  return { ok: true };
}

// ====================== ОТПЕЧАТКИ И ДОП. ВЫЗВАНИЯ ======================

export async function setFingerprintDate(
  leadId:   string,
  date:     string | null,
  location: string | null,
) {
  const user = await requireUser();

  const lead = await db.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true, salesManagerId: true, legalManagerId: true,
      client: { select: { fullName: true, phone: true } },
    },
  });
  if (!lead) throw new Error('Лид не найден');
  assert(canEditLead(user, lead));

  // Anna 01.05.2026: «Пишу 12 — оно ставит 14». Раньше тут был
  // `new Date(date)`. Строка из <input type="datetime-local"> приходит
  // без таймзоны ("2026-05-12T12:00"), и `new Date` на сервере с TZ=UTC
  // парсил её как UTC → в БД писалось 12:00 UTC = 14:00 Warsaw летом.
  // parseWarsawLocalToUtc явно интерпретирует ввод как локальное время
  // в Europe/Warsaw — DST учитывается через Intl.
  const dt = date ? parseWarsawLocalToUtc(date) : null;

  // Удаляем старое событие отпечатков если было
  const existingEvent = await db.calendarEvent.findFirst({
    where: { leadId, kind: 'FINGERPRINT' },
    select: { id: true, googleId: true, ownerId: true },
  });

  if (existingEvent?.googleId && existingEvent.ownerId) {
    // Google delete — best-effort. Импорт + сама функция не должны валить
    // основное действие (запись в БД). Импорт оборачиваем тоже — если
    // модуль @/lib/google не загрузится (например crypto-key битый),
    // мы должны увидеть запись в логах а не алерт у пользователя.
    try {
      const { deleteGoogleEvent } = await import('@/lib/google');
      deleteGoogleEvent(existingEvent.ownerId, existingEvent.googleId).catch((e) => {
        logger.error('[setFingerprintDate] failed to delete google event:', e);
      });
    } catch (e) {
      logger.error('[setFingerprintDate] failed to import google module:', e);
    }
  }

  await db.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id: leadId },
      data: {
        fingerprintDate:    dt,
        fingerprintLocation: location,
      },
    });

    await tx.calendarEvent.deleteMany({
      where: { leadId, kind: 'FINGERPRINT' },
    });

    if (dt) {
      await tx.calendarEvent.create({
        data: {
          leadId,
          ownerId:   lead.legalManagerId,
          kind:      'FINGERPRINT',
          title:     `Отпечатки: ${lead.client.fullName}`,
          location:  location || undefined,
          startsAt:  dt,
          endsAt:    new Date(dt.getTime() + 30 * 60 * 1000),
        },
      });
    }

    await tx.leadEvent.create({
      data: {
        leadId,
        authorId: user.id,
        kind:     'FINGERPRINT_SET',
        message:  dt ? `Отпечатки: ${dt.toLocaleString('ru-RU', { timeZone: 'Europe/Warsaw' })}` : 'Дата отпечатков снята',
        payload:  { date: dt?.toISOString() ?? null, location },
      },
    });
  });

  // Google Calendar sync — best-effort. Если упадёт (network error,
  // expired refresh token, отозванный доступ, dns timeout) — логируем и
  // идём дальше. Запись в БД уже прошла, для пользователя главное это.
  // Раньше тут createGoogleEvent был вне try/catch — fetch внутри него
  // мог бросить network error, и весь setFingerprintDate падал → Anna
  // видела «Не удалось сохранить» хотя в БД уже всё есть.
  if (dt && lead.legalManagerId) {
    try {
      const { createGoogleEvent } = await import('@/lib/google');
      const googleId = await createGoogleEvent(lead.legalManagerId, {
        summary:     `Отпечатки: ${lead.client.fullName}`,
        description: `Клиент: ${lead.client.fullName}\nТелефон: ${lead.client.phone}`,
        location:    location || undefined,
        start: { dateTime: dt.toISOString(), timeZone: 'Europe/Warsaw' },
        end:   { dateTime: new Date(dt.getTime() + 30 * 60 * 1000).toISOString(), timeZone: 'Europe/Warsaw' },
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'popup', minutes: 60 },
            { method: 'popup', minutes: 24 * 60 },
          ],
        },
      });

      if (googleId) {
        await db.calendarEvent.updateMany({
          where: { leadId, kind: 'FINGERPRINT' },
          data:  { googleId },
        });
      }
    } catch (e) {
      logger.error('[setFingerprintDate] failed to sync Google Calendar:', e);
    }
  }

  revalidatePath(`/clients/${leadId}`);
  revalidatePath('/calendar');
  return { ok: true };
}

/**
 * Дополнительное вызвание (kind=EXTRA_CALL).
 * Их может быть НЕСКОЛЬКО на лид, и они не хранятся на самом лиде
 * (в отличие от fingerprintDate). Просто события в calendarEvents.
 *
 * Семантика двух дат:
 *   - notifiedAt — когда УВ прислал уведомление (для истории)
 *   - dueDate    — дедлайн донести запрошенные документы (это и попадает
 *                  в Google Calendar как основная дата напоминания)
 */
export async function addExtraCall(input: {
  leadId:      string;
  notifiedAt:  string;        // дата получения уведомления
  dueDate:     string;        // дедлайн донести документы
  title?:      string | null; // что именно запрошено («запрос документов: ...»)
}) {
  const user = await requireUser();

  const lead = await db.lead.findUnique({
    where: { id: input.leadId },
    select: {
      id: true, salesManagerId: true, legalManagerId: true,
      client: { select: { fullName: true, phone: true } },
    },
  });
  if (!lead) throw new Error('Лид не найден');
  assert(canEditLead(user, lead));

  const notifiedDt = new Date(input.notifiedAt);
  const dueDt      = new Date(input.dueDate);
  if (isNaN(notifiedDt.getTime())) throw new Error('Некорректная дата вызвания');
  if (isNaN(dueDt.getTime()))      throw new Error('Некорректный срок');
  if (dueDt < notifiedDt) throw new Error('Срок не может быть раньше даты вызвания');

  const requestText = input.title?.trim() || `Запрос документов`;
  const fullTitle = `Доп. вызвание: ${lead.client.fullName} — ${requestText}`;

  // Дата для отображения "от 14.04.2026 по 21.04.2026"
  const fmt = (d: Date) => d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Warsaw' });
  const periodLabel = `от ${fmt(notifiedDt)} по ${fmt(dueDt)}`;

  const description = [
    `Клиент: ${lead.client.fullName}`,
    `Телефон: ${lead.client.phone}`,
    `Период: ${periodLabel}`,
    `Запрос: ${requestText}`,
  ].join('\n');

  const event = await db.$transaction(async (tx) => {
    const created = await tx.calendarEvent.create({
      data: {
        leadId:      lead.id,
        ownerId:     lead.legalManagerId,
        kind:        'EXTRA_CALL',
        title:       fullTitle,
        description,
        startsAt:    dueDt,                                // дедлайн = точка в календаре
        endsAt:      new Date(dueDt.getTime() + 30 * 60 * 1000),
      },
    });

    await tx.leadEvent.create({
      data: {
        leadId:   lead.id,
        authorId: user.id,
        kind:     'EXTRA_CALL_SET',
        message:  `Доп. вызвание ${periodLabel}: ${requestText}`,
        payload:  {
          eventId:    created.id,
          notifiedAt: notifiedDt.toISOString(),
          dueDate:    dueDt.toISOString(),
          request:    requestText,
        },
      },
    });

    return created;
  });

  // Google Calendar sync — best-effort, как и в setFingerprintDate.
  // Ошибка не должна валить основное действие (запись в БД уже прошла).
  if (lead.legalManagerId) {
    try {
      const { createGoogleEvent } = await import('@/lib/google');
      const googleId = await createGoogleEvent(lead.legalManagerId, {
        summary:     fullTitle,
        description,
        start: { dateTime: dueDt.toISOString(), timeZone: 'Europe/Warsaw' },
        end:   { dateTime: new Date(dueDt.getTime() + 30 * 60 * 1000).toISOString(), timeZone: 'Europe/Warsaw' },
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'popup', minutes: 60 },
            { method: 'popup', minutes: 24 * 60 },
          ],
        },
      });

      if (googleId) {
        await db.calendarEvent.update({
          where: { id: event.id },
          data:  { googleId },
        });
      }
    } catch (e) {
      logger.error('[addExtraCall] failed to sync Google Calendar:', e);
    }
  }

  revalidatePath(`/clients/${lead.id}`);
  revalidatePath('/calendar');
  return { id: event.id };
}

/**
 * Удалить событие календаря.
 *
 * Права:
 *   - Если событие привязано к лиду — нужно право на редактирование этого лида
 *     (canEditLead: ADMIN или ответственный менеджер).
 *   - Если без связи с лидом (напр. внутренняя встреча) — только владелец
 *     события или админ. Без этой проверки любой залогиненный юзер мог бы удалить
 *     чужую встречу.
 */
export async function deleteCalendarEvent(eventId: string) {
  const user = await requireUser();

  const ev = await db.calendarEvent.findUnique({
    where: { id: eventId },
    select: {
      id: true, leadId: true, googleId: true, ownerId: true, kind: true,
      lead: { select: { salesManagerId: true, legalManagerId: true } },
    },
  });
  if (!ev) throw new Error('Событие не найдено');

  if (ev.lead) {
    assert(canEditLead(user, ev.lead));
  } else {
    // Встреча без привязки к лиду: удалить может владелец или админ.
    assert(user.role === 'ADMIN' || ev.ownerId === user.id);
  }

  // Асинхронно удалить из Google. Импорт тоже под try/catch — если
  // модуль @/lib/google не загрузится (битый crypto key и т.п.) —
  // не валим основное действие.
  if (ev.googleId && ev.ownerId) {
    try {
      const { deleteGoogleEvent } = await import('@/lib/google');
      deleteGoogleEvent(ev.ownerId, ev.googleId).catch((e) => {
        logger.error('[deleteCalendarEvent] failed to delete google event:', e);
      });
    } catch (e) {
      logger.error('[deleteCalendarEvent] failed to import google module:', e);
    }
  }

  await db.calendarEvent.delete({ where: { id: eventId } });

  // Если это были отпечатки — обнуляем на лиде
  if (ev.kind === 'FINGERPRINT' && ev.leadId) {
    await db.lead.update({
      where: { id: ev.leadId },
      data:  { fingerprintDate: null, fingerprintLocation: null },
    });
  }

  if (ev.leadId) revalidatePath(`/clients/${ev.leadId}`);
  revalidatePath('/calendar');
  return { ok: true };
}

// ====================== ЗАМЕТКИ ======================

const addNoteSchema = z.object({
  leadId: z.string(),
  body:   z.string().min(1, 'Заметка не может быть пустой'),
});

export async function addNote(input: z.infer<typeof addNoteSchema>) {
  const user = await requireUser();
  const data = addNoteSchema.parse(input);

  const lead = await db.lead.findUnique({
    where: { id: data.leadId },
    select: { id: true, salesManagerId: true, legalManagerId: true },
  });
  if (!lead) throw new Error('Лид не найден');
  assert(canEditLead(user, lead));

  // Парсинг @упоминаний
  const mentionRegex = /@([a-zA-Z0-9._-]+)/g;
  const matches = [...data.body.matchAll(mentionRegex)]
    .map((m) => m[1].toLowerCase())
    .filter((m) => m.length >= 2);
  const uniqueMatches = [...new Set(matches)];

  // Резолвим в юзеров: либо по email login-части, либо по имени (contains).
  // Прежняя версия использовала `name: { in: matches }` — это НИКОГДА не
  // срабатывало ("Yuliia Hura" ≠ "yuliia"). Исправлено на contains+insensitive.
  const orConditions = uniqueMatches.flatMap((m) => {
    const conds: Array<Record<string, unknown>> = [
      { email: { startsWith: `${m}@`, mode: 'insensitive' as const } },
    ];
    if (m.length >= 3) {
      conds.push({ name: { contains: m, mode: 'insensitive' as const } });
    }
    return conds;
  });

  const mentionedUsers = orConditions.length
    ? await db.user.findMany({
        where: { OR: orConditions, isActive: true },
        select: { id: true },
      })
    : [];

  const mentionIds = [...new Set(mentionedUsers.map((u) => u.id))];

  await db.$transaction([
    db.note.create({
      data: {
        leadId:   data.leadId,
        authorId: user.id,
        body:     data.body,
        mentions: mentionIds,
      },
    }),
    db.leadEvent.create({
      data: {
        leadId:   data.leadId,
        authorId: user.id,
        kind:     'NOTE_ADDED',
        message:  'Добавлена заметка',
      },
    }),
  ]);

  for (const mentionedId of mentionIds.filter((id) => id !== user.id)) {
    await notify({
      userId: mentionedId,
      kind:   'MENTION_IN_NOTE',
      title:  `${user.name} упомянул вас в заметке`,
      body:   data.body.slice(0, 120),
      link:   `/clients/${data.leadId}`,
    });
  }

  revalidatePath(`/clients/${data.leadId}`);
  return { ok: true };
}

// ====================== АРХИВ ======================

export async function archiveLead(leadId: string) {
  const user = await requireAdmin();

  await db.$transaction([
    db.lead.update({
      where: { id: leadId },
      data:  { isArchived: true, closedAt: new Date() },
    }),
    db.leadEvent.create({
      data: {
        leadId,
        authorId: user.id,
        kind:     'ARCHIVED',
        message:  'Лид архивирован',
      },
    }),
  ]);

  await audit({
    userId:     user.id,
    action:     'lead.archive',
    entityType: 'Lead',
    entityId:   leadId,
  });

  revalidatePath('/funnel');
  revalidatePath('/clients');
  return { ok: true };
}

export async function restoreLead(leadId: string) {
  const user = await requireAdmin();

  await db.$transaction([
    db.lead.update({
      where: { id: leadId },
      data:  { isArchived: false, closedAt: null },
    }),
    db.leadEvent.create({
      data: { leadId, authorId: user.id, kind: 'RESTORED', message: 'Лид восстановлен' },
    }),
  ]);

  revalidatePath('/funnel');
  return { ok: true };
}

// ====================== ВСПОМОГАТЕЛЬНЫЕ ======================

function methodLabel(m: 'CARD' | 'CASH' | 'TRANSFER' | 'OTHER'): string {
  return { CARD: 'карта', CASH: 'наличные', TRANSFER: 'перевод', OTHER: 'другое' }[m];
}

/**
 * Парсит datetime-local строку "YYYY-MM-DDTHH:MM" как локальное время
 * Europe/Warsaw и возвращает соответствующий UTC момент.
 *
 * Без этого `new Date('2026-05-12T12:00')` на сервере с TZ=UTC
 * интерпретирует вход как UTC → в БД пишется 12:00 UTC = 14:00 Warsaw
 * летом (CEST). Anna 01.05.2026: «Пишу 12 — оно ставит 14».
 *
 * DST учитывается автоматически через Intl: летом offset +2 (CEST),
 * зимой +1 (CET). Без сторонних библиотек.
 */
function parseWarsawLocalToUtc(localStr: string): Date {
  const [datePart, timePart] = localStr.split('T');
  const [yyyy, mm, dd] = datePart.split('-').map(Number);
  const [hh, mi] = (timePart || '00:00').split(':').map(Number);

  // Шаг 1: создаём UTC-момент с этими компонентами (просто арифметика).
  const utcMs = Date.UTC(yyyy, mm - 1, dd, hh, mi);

  // Шаг 2: узнаём как этот UTC-момент выглядит в Europe/Warsaw — компоненты.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const wMs = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));

  // Шаг 3: offset = насколько Warsaw впереди UTC. Вычитаем чтобы получить настоящий UTC.
  // Пример: localStr="2026-05-12T12:00", летом +2h →
  //   utcMs = 12:00 UTC, в Warsaw это 14:00 → wMs = 14:00 UTC
  //   offset = 2h, return = 12:00 - 2h = 10:00 UTC = 12:00 Warsaw ✓
  const offset = wMs - utcMs;
  return new Date(utcMs - offset);
}
