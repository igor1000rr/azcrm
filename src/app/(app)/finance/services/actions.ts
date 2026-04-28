'use server';

// Управление услугами (прайс-лист) — только ADMIN
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { parseNumericOr, parsePercent } from '@/lib/finance/parse-numeric';

// Кастомный preprocessor — принимает строки/числа и нормализует.
// Поддерживает запятую как десятичный разделитель ('5,5' → 5.5).
const numericFromInput = z.preprocess(
  (v) => parseNumericOr(v, 0),
  z.number().min(0),
);

const percentFromInput = z.preprocess(
  (v) => parsePercent(v) ?? 0,
  z.number().min(0).max(100),
);

const serviceSchema = z.object({
  id:                     z.string().optional(),
  name:                   z.string().min(2, 'Укажите название услуги'),
  description:            z.string().optional(),
  basePrice:              numericFromInput.default(0),
  salesCommissionPercent: percentFromInput.default(5),
  legalCommissionPercent: percentFromInput.default(5),
  funnelId:               z.string().optional(),
  position:               z.coerce.number().int().default(0),
  isActive:               z.boolean().default(true),
});

// Тип того что разрешено передавать в форму. Числовые поля принимают
// либо number (когда вызывают программно), либо string (как в форме —
// текстовый input с inputMode=decimal, поддерживает запятую '5,5').
// Сам Zod через preprocess нормализует в number перед валидацией.
export interface UpsertServiceInput {
  id?: string;
  name: string;
  description?: string;
  basePrice?: string | number;
  salesCommissionPercent?: string | number;
  legalCommissionPercent?: string | number;
  funnelId?: string;
  position?: number;
  isActive?: boolean;
}

export async function upsertService(input: UpsertServiceInput) {
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
