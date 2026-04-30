'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { audit } from '@/lib/audit';
import {
  resolveCommissionPercent, calcCommissionAmount,
} from '@/lib/finance/commission-calc';

export async function markCommissionPaidOut(id: string, paidOut: boolean, notes?: string) {
  const user = await requireAdmin();
  await db.commission.update({
    where: { id },
    data: {
      paidOut,
      paidOutAt: paidOut ? new Date() : null,
      paidOutNotes: notes || null,
    },
  });
  await audit({
    userId: user.id, action: 'commission.markPaid', entityType: 'Commission', entityId: id,
    after: { paidOut, notes },
  });
  revalidatePath('/finance/commissions');
  revalidatePath('/finance/payroll');
  return { ok: true };
}

export async function bulkMarkPaidOut(ids: string[]) {
  const user = await requireAdmin();
  await db.commission.updateMany({
    where: { id: { in: ids } },
    data: { paidOut: true, paidOutAt: new Date() },
  });
  await audit({
    userId: user.id, action: 'commission.bulkMarkPaid', entityType: 'Commission',
    after: { ids, count: ids.length },
  });
  revalidatePath('/finance/commissions');
  revalidatePath('/finance/payroll');
  return { ok: true, count: ids.length };
}

/**
 * Пересчитать невыплаченные премии менеджера по актуальному %.
 *
 * Зачем: премии создаются в момент платежа и фиксируют тогдашний % (User.commissionPercent
 * → Service.*CommissionPercent → 5%). Если админ выставил/изменил % менеджеру ПОСЛЕ того
 * как платежи уже прошли, старые Commission записи остались со старым процентом.
 *
 * Что делает:
 *   - Берёт все Commission где userId = указанный, paidOut = false
 *   - Для каждой берёт актуальный User.commissionPercent + Service.*CommissionPercent
 *     по той же роли (SALES → service.salesCommissionPercent, LEGAL → service.legalCommissionPercent)
 *   - Применяет ту же формулу resolveCommissionPercent
 *   - Обновляет percent + amount если новое значение отличается от старого
 *
 * НЕ трогает выплаченные премии — они уже история.
 * Возвращает сколько записей обновилось и общую дельту в zł.
 */
export async function recalcCommissionsForUser(userId: string) {
  const admin = await requireAdmin();

  // Берём актуальный % менеджера
  const targetUser = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, commissionPercent: true },
  });
  if (!targetUser) throw new Error('Пользователь не найден');

  // Все невыплаченные премии этого менеджера, с услугой по лиду для fallback %
  const commissions = await db.commission.findMany({
    where: { userId, paidOut: false },
    include: {
      payment: {
        select: {
          amount: true,
          lead: {
            select: {
              service: {
                select: {
                  salesCommissionPercent: true,
                  legalCommissionPercent: true,
                },
              },
            },
          },
        },
      },
    },
  });

  let updated = 0;
  let deltaTotal = 0;

  const userPct = targetUser.commissionPercent != null
    ? Number(targetUser.commissionPercent)
    : null;

  for (const c of commissions) {
    const servicePct = c.role === 'SALES'
      ? (c.payment.lead.service?.salesCommissionPercent != null
          ? Number(c.payment.lead.service.salesCommissionPercent) : null)
      : (c.payment.lead.service?.legalCommissionPercent != null
          ? Number(c.payment.lead.service.legalCommissionPercent) : null);

    const newPercent = resolveCommissionPercent({ userPct, servicePct });
    const basePayment = Number(c.basePayment);
    const newAmount = calcCommissionAmount(basePayment, newPercent);

    const oldPercent = Number(c.percent);
    const oldAmount  = Number(c.amount);

    if (Math.abs(newPercent - oldPercent) < 0.001 && Math.abs(newAmount - oldAmount) < 0.01) {
      continue; // ничего не поменялось
    }

    await db.commission.update({
      where: { id: c.id },
      data:  { percent: newPercent, amount: newAmount },
    });
    updated += 1;
    deltaTotal += (newAmount - oldAmount);
  }

  await audit({
    userId:     admin.id,
    action:     'commission.recalc',
    entityType: 'User',
    entityId:   userId,
    after:      { recalculated: updated, delta: deltaTotal, totalChecked: commissions.length },
  });

  revalidatePath('/finance/commissions');
  revalidatePath('/finance/payroll');

  return {
    ok:           true,
    userName:     targetUser.name,
    totalChecked: commissions.length,
    updated,
    delta:        Math.round(deltaTotal * 100) / 100,
  };
}
