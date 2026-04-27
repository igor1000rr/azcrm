'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { audit } from '@/lib/audit';

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
