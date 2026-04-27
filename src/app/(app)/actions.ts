'use server';

// Server Actions — все мутации над лидами
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireUser, requireAdmin } from '@/lib/auth';
import {
  canEditLead, canTransferLead, canAssignLegalManager,
  canArchiveLead, canDeletePayment, canDeleteLead,
  assert,
} from '@/lib/permissions';
import { normalizePhone } from '@/lib/utils';
import { notify } from '@/lib/notify';
import { audit } from '@/lib/audit';

// ====================== СОЗДАНИЕ ЛИДА ======================

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
  cityId:        z.string().optional(),
  source:        z.string().optional(),
  whatsappAccountId: z.string().optional(),
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

  // Шаг 2: получить первый этап воронки если не указан
  let stageId = data.stageId;
  if (!stageId) {
    const firstStage = await db.stage.findFirst({
      where: { funnelId: data.funnelId },
      orderBy: { position: 'asc' },
    });
    if (!firstStage) throw new Error('У воронки нет этапов');
    stageId = firstStage.id;
  }

  // Шаг 3: создаём лида + чек-лист документов из шаблона воронки
  const docTemplates = await db.documentTemplate.findMany({
    where: { funnelId: data.funnelId },
    orderBy: { position: 'asc' },
  });

  const lead = await db.lead.create({
    data: {
      clientId,
      funnelId:       data.funnelId,
      stageId,
      cityId:         data.cityId || null,
      source:         data.source || null,
      whatsappAccountId: data.whatsappAccountId || null,
      salesManagerId: data.salesManagerId || (user.role === 'SALES' ? user.id : null),
      legalManagerId: data.legalManagerId || null,
      totalAmount:    data.totalAmount,
      summary:        data.summary || null,
      firstContactAt: new Date(),
      documents: {
        create: docTemplates.map((t: { name: string; position: number }) => ({
          name:       t.name,
          position:   t.position,
          isPresent:  false,
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

  revalidatePath('/funnel');
  revalidatePath('/clients');

  await audit({
    userId:     user.id,
    action:     'lead.create',
    entityType: 'Lead',
    entityId:   lead.id,
    after:      { clientId, funnelId: data.funnelId, totalAmount: data.totalAmount },
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
  revalidatePath(`/clients/${lead.id}`); // на случай если карточка открыта
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

// ====================== ОПЛАТЫ ======================

const addPaymentSchema = z.object({
  leadId: z.string(),
  amount: z.coerce.number().positive('Сумма должна быть положительной'),
  method: z.enum(['CARD', 'CASH', 'TRANSFER', 'OTHER']).default('CASH'),
  paidAt: z.string().optional(),
  notes:  z.string().optional(),
});

export async function addPayment(input: z.infer<typeof addPaymentSchema>) {
  const user = await requireUser();
  const data = addPaymentSchema.parse(input);

  const lead = await db.lead.findUnique({
    where: { id: data.leadId },
    select: { id: true, salesManagerId: true, legalManagerId: true },
  });
  if (!lead) throw new Error('Лид не найден');
  assert(canEditLead(user, lead));

  const payment = await db.payment.create({
    data: {
      leadId:      data.leadId,
      amount:      data.amount,
      method:      data.method,
      paidAt:      data.paidAt ? new Date(data.paidAt) : new Date(),
      notes:       data.notes || null,
      createdById: user.id,
    },
  });

  await db.leadEvent.create({
    data: {
      leadId:   data.leadId,
      authorId: user.id,
      kind:     'PAYMENT_ADDED',
      message:  `+${data.amount} zł (${methodLabel(data.method)})`,
      payload:  { paymentId: payment.id, amount: data.amount, method: data.method },
    },
  });

  revalidatePath(`/clients/${data.leadId}`);
  revalidatePath('/payments');
  return { id: payment.id };
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

// ====================== ОТПЕЧАТКИ ======================

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

  const dt = date ? new Date(date) : null;

  // Удаляем старое событие отпечатков если было
  const existingEvent = await db.calendarEvent.findFirst({
    where: { leadId, kind: 'FINGERPRINT' },
    select: { id: true, googleId: true, ownerId: true },
  });

  if (existingEvent?.googleId && existingEvent.ownerId) {
    // Async-удаление в Google (не блокируем основной поток)
    const { deleteGoogleEvent } = await import('@/lib/google');
    deleteGoogleEvent(existingEvent.ownerId, existingEvent.googleId).catch((e) => {
      console.error('failed to delete google event:', e);
    });
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
        message:  dt ? `Отпечатки: ${dt.toLocaleString('ru-RU')}` : 'Дата отпечатков снята',
        payload:  { date: dt?.toISOString() ?? null, location },
      },
    });
  });

  // После транзакции — создаём в Google Calendar (если есть менеджер с подключённым календарём)
  if (dt && lead.legalManagerId) {
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
  }

  revalidatePath(`/clients/${leadId}`);
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

  // Парсинг @упоминаний — ищем @email или @login
  const mentionRegex = /@([a-zA-Z0-9._-]+)/g;
  const matches = [...data.body.matchAll(mentionRegex)].map((m) => m[1].toLowerCase());

  const mentionedUsers = matches.length
    ? await db.user.findMany({
        where: {
          OR: [
            { email: { in: matches.map((m) => `${m}@azgroup.pl`) } },
            { name:  { in: matches, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      })
    : [];

  const mentionIds = mentionedUsers.map((u) => u.id);

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

  // Уведомления упомянутым (push + БД)
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
