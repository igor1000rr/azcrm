'use server';

// Управление услугами (прайс-лист) — только ADMIN
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { audit } from '@/lib/audit';

const serviceSchema = z.object({
  id:                     z.string().optional(),
  name:                   z.string().min(2, 'Укажите название услуги'),
  description:            z.string().optional(),
  basePrice:              z.coerce.number().min(0).default(0),
  salesCommissionPercent: z.coerce.number().min(0).max(100).default(5),
  legalCommissionPercent: z.coerce.number().min(0).max(100).default(5),
  funnelId:               z.string().optional(),
  position:               z.coerce.number().int().default(0),
  isActive:               z.boolean().default(true),
});

export async function upsertService(input: z.infer<typeof serviceSchema>) {
  const user = await requireAdmin();
  const data = serviceSchema.parse(input);

  const payload = {
    name: data.name,
    description: data.description || null,
    basePrice: data.basePrice,
    salesCommissionPercent: data.salesCommissionPercent,
    legalCommissionPercent: data.legalCommissionPercent,
    funnelId: data.funnelId || null,
    position: data.position,
    isActive: data.isActive,
  };

  if (data.id) {
    const before = await db.service.findUnique({ where: { id: data.id } });
    const svc = await db.service.update({ where: { id: data.id }, data: payload });
    await audit({
      userId: user.id, action: 'service.update', entityType: 'Service', entityId: svc.id,
      before: before ?? undefined, after: payload,
    });
    revalidatePath('/finance/services');
    return { id: svc.id };
  } else {
    const svc = await db.service.create({ data: payload });
    await audit({
      userId: user.id, action: 'service.create', entityType: 'Service', entityId: svc.id, after: payload,
    });
    revalidatePath('/finance/services');
    return { id: svc.id };
  }
}

export async function deleteService(id: string) {
  const user = await requireAdmin();
  // Проверим что нет лидов с этой услугой
  const leadsCount = await db.lead.count({ where: { serviceId: id } });
  if (leadsCount > 0) {
    // Лучше деактивировать, чем удалять (есть зависимые лиды)
    await db.service.update({ where: { id }, data: { isActive: false } });
    await audit({ userId: user.id, action: 'service.deactivate', entityType: 'Service', entityId: id });
    revalidatePath('/finance/services');
    return { ok: true, deactivated: true, leadsCount };
  }
  await db.service.delete({ where: { id } });
  await audit({ userId: user.id, action: 'service.delete', entityType: 'Service', entityId: id });
  revalidatePath('/finance/services');
  return { ok: true };
}

// Глобальная настройка: с какого по счёту платежа начислять комиссии
export async function setCommissionStartPayment(value: number) {
  const user = await requireAdmin();
  if (value !== 1 && value !== 2) {
    throw new Error('Допустимые значения: 1 или 2');
  }
  await db.setting.upsert({
    where: { key: 'commission.startFromPaymentNumber' },
    update: { value: value as never },
    create: { key: 'commission.startFromPaymentNumber', value: value as never },
  });
  await audit({
    userId: user.id, action: 'setting.update', entityType: 'Setting',
    entityId: 'commission.startFromPaymentNumber', after: { value },
  });
  revalidatePath('/finance/services');
  return { ok: true };
}
