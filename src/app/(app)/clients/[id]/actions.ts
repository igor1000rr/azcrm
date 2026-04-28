'use server';

// Редактирование клиента + удаление файлов + поля лида (работодатель, город работы, услуги)
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { canEditLead, assert } from '@/lib/permissions';
import { normalizePhone } from '@/lib/utils';
import { audit } from '@/lib/audit';

const clientSchema = z.object({
  id:          z.string(),
  fullName:    z.string().min(2).max(200),
  phone:       z.string().min(5),
  altPhone:    z.string().nullable().optional(),
  altPhone2:   z.string().nullable().optional(),
  altPhone3:   z.string().nullable().optional(),
  email:       z.string().email().nullable().optional().or(z.literal('')),
  birthDate:   z.string().nullable().optional(),
  nationality: z.string().nullable().optional(),
  addressPL:   z.string().nullable().optional(),
  addressHome: z.string().nullable().optional(),
  cityId:      z.string().nullable().optional(),
});

export async function updateClient(input: z.infer<typeof clientSchema>) {
  const user = await requireUser();
  const data = clientSchema.parse(input);

  const client = await db.client.findUnique({
    where: { id: data.id },
    include: {
      leads: {
        select: { salesManagerId: true, legalManagerId: true },
        take: 1,
      },
    },
  });
  if (!client) throw new Error('Клиент не найден');
  if (
    user.role !== 'ADMIN'
    && !client.leads.some((l) => canEditLead(user, l))
  ) {
    throw new Error('Недостаточно прав');
  }

  const before = {
    fullName: client.fullName, phone: client.phone, email: client.email,
  };

  const newPhone = normalizePhone(data.phone);
  if (newPhone !== client.phone) {
    const dup = await db.client.findUnique({ where: { phone: newPhone } });
    if (dup && dup.id !== client.id) {
      throw new Error('Этот телефон уже привязан к другому клиенту');
    }
  }

  await db.client.update({
    where: { id: data.id },
    data: {
      fullName:    data.fullName,
      phone:       newPhone,
      altPhone:    data.altPhone || null,
      altPhone2:   data.altPhone2 || null,
      altPhone3:   data.altPhone3 || null,
      email:       data.email || null,
      birthDate:   data.birthDate ? new Date(data.birthDate) : null,
      nationality: data.nationality || null,
      addressPL:   data.addressPL || null,
      addressHome: data.addressHome || null,
      cityId:      data.cityId || null,
    },
  });

  await audit({
    userId:     user.id,
    action:     'client.update',
    entityType: 'Client',
    entityId:   data.id,
    before,
    after:      { fullName: data.fullName, phone: newPhone, email: data.email },
  });

  const leads = await db.lead.findMany({
    where: { clientId: data.id },
    select: { id: true },
  });
  for (const l of leads) revalidatePath(`/clients/${l.id}`);
  revalidatePath('/clients');

  return { ok: true };
}

export async function removeClientFile(fileId: string) {
  const user = await requireUser();

  const file = await db.clientFile.findUnique({
    where: { id: fileId },
    include: {
      client: {
        include: { leads: { select: { salesManagerId: true, legalManagerId: true } } },
      },
    },
  });
  if (!file) throw new Error('Файл не найден');

  const hasAccess = user.role === 'ADMIN'
    || file.client.leads.some((l) => canEditLead(user, l));
  if (!hasAccess) throw new Error('Недостаточно прав');

  const m = file.fileUrl.match(/^\/api\/files\/uploads\/(.+)$/);
  if (m) {
    const { removeFile } = await import('@/lib/storage');
    await removeFile('uploads', m[1]);
  }

  await db.clientFile.delete({ where: { id: fileId } });

  const leads = await db.lead.findMany({
    where: { clientId: file.clientId },
    select: { id: true },
  });
  for (const l of leads) revalidatePath(`/clients/${l.id}`);

  return { ok: true };
}

// ====================== РАБОТОДАТЕЛЬ (для karta praca) ======================

const employerSchema = z.object({
  leadId: z.string(),
  name:   z.string().nullable().optional(),
  phone:  z.string().nullable().optional(),
});

export async function setEmployer(input: z.infer<typeof employerSchema>) {
  const user = await requireUser();
  const data = employerSchema.parse(input);

  const lead = await db.lead.findUnique({
    where: { id: data.leadId },
    select: { id: true, salesManagerId: true, legalManagerId: true, employerName: true, employerPhone: true },
  });
  if (!lead) throw new Error('Лид не найден');
  assert(canEditLead(user, lead));

  await db.lead.update({
    where: { id: data.leadId },
    data: {
      employerName:  data.name?.trim() || null,
      employerPhone: data.phone ? normalizePhone(data.phone) : null,
    },
  });

  await audit({
    userId:     user.id,
    action:     'lead.set_employer',
    entityType: 'Lead',
    entityId:   data.leadId,
    before:     { employerName: lead.employerName, employerPhone: lead.employerPhone },
    after:      { employerName: data.name, employerPhone: data.phone },
  });

  revalidatePath(`/clients/${data.leadId}`);
  return { ok: true };
}

// ====================== ГОРОД РАБОТЫ ======================

export async function setWorkCity(leadId: string, cityId: string | null) {
  const user = await requireUser();

  const lead = await db.lead.findUnique({
    where: { id: leadId },
    select: { id: true, salesManagerId: true, legalManagerId: true, workCityId: true },
  });
  if (!lead) throw new Error('Лид не найден');
  assert(canEditLead(user, lead));

  await db.lead.update({
    where: { id: leadId },
    data:  { workCityId: cityId },
  });

  await audit({
    userId:     user.id,
    action:     'lead.set_work_city',
    entityType: 'Lead',
    entityId:   leadId,
    before:     { workCityId: lead.workCityId },
    after:      { workCityId: cityId },
  });

  revalidatePath(`/clients/${leadId}`);
  return { ok: true };
}

// ====================== УСЛУГИ НА ЛИДЕ ======================

const leadServicesSchema = z.object({
  leadId: z.string(),
  items:  z.array(z.object({
    serviceId: z.string().min(1),
    amount:    z.coerce.number().min(0),
    qty:       z.coerce.number().int().min(1).default(1),
    notes:     z.string().nullable().optional(),
  })),
});

/**
 * Полный перезапись списка услуг лида. Обновляет также totalAmount и primary serviceId.
 */
export async function setLeadServices(input: z.infer<typeof leadServicesSchema>) {
  const user = await requireUser();
  const data = leadServicesSchema.parse(input);

  const lead = await db.lead.findUnique({
    where: { id: data.leadId },
    select: {
      id: true, salesManagerId: true, legalManagerId: true,
      totalAmount: true, serviceId: true,
    },
  });
  if (!lead) throw new Error('Лид не найден');
  assert(canEditLead(user, lead));

  const total = data.items.reduce((s, i) => s + i.amount * i.qty, 0);
  const primaryServiceId = data.items[0]?.serviceId ?? null;

  await db.$transaction(async (tx) => {
    await tx.leadService.deleteMany({ where: { leadId: data.leadId } });
    if (data.items.length > 0) {
      await tx.leadService.createMany({
        data: data.items.map((it, i) => ({
          leadId:    data.leadId,
          serviceId: it.serviceId,
          amount:    it.amount,
          qty:       it.qty,
          notes:     it.notes ?? null,
          position:  i,
        })),
      });
    }
    await tx.lead.update({
      where: { id: data.leadId },
      data: {
        totalAmount: total,
        serviceId:   primaryServiceId,
      },
    });
  });

  await audit({
    userId:     user.id,
    action:     'lead.set_services',
    entityType: 'Lead',
    entityId:   data.leadId,
    before:     { totalAmount: Number(lead.totalAmount), serviceId: lead.serviceId },
    after:      { totalAmount: total, serviceId: primaryServiceId, count: data.items.length },
  });

  revalidatePath(`/clients/${data.leadId}`);
  return { ok: true, total };
}
