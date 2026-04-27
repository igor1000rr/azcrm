'use server';

// Расходы — только ADMIN. Можно прикреплять скан документа.
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { audit } from '@/lib/audit';

const schema = z.object({
  id:          z.string().optional(),
  cityId:      z.string().optional(),
  category:    z.string().min(1, 'Категория обязательна'),
  amount:      z.coerce.number().positive('Сумма должна быть положительной'),
  spentAt:     z.string().min(1, 'Дата обязательна'),
  description: z.string().optional(),
  fileUrl:     z.string().optional(),
  fileName:    z.string().optional(),
  fileSize:    z.coerce.number().optional(),
});

export async function upsertExpense(input: z.infer<typeof schema>) {
  const user = await requireAdmin();
  const data = schema.parse(input);

  const payload = {
    cityId: data.cityId || null,
    category: data.category.trim(),
    amount: data.amount,
    spentAt: new Date(data.spentAt),
    description: data.description?.trim() || null,
    fileUrl: data.fileUrl || null,
    fileName: data.fileName || null,
    fileSize: data.fileSize || null,
    createdById: user.id,
  };

  if (data.id) {
    await db.expense.update({ where: { id: data.id }, data: payload });
    await audit({ userId: user.id, action: 'expense.update', entityType: 'Expense', entityId: data.id, after: payload });
  } else {
    const e = await db.expense.create({ data: payload });
    await audit({ userId: user.id, action: 'expense.create', entityType: 'Expense', entityId: e.id, after: payload });
  }

  revalidatePath('/finance/expenses');
  return { ok: true };
}

export async function deleteExpense(id: string) {
  const user = await requireAdmin();
  await db.expense.delete({ where: { id } });
  await audit({ userId: user.id, action: 'expense.delete', entityType: 'Expense', entityId: id });
  revalidatePath('/finance/expenses');
  return { ok: true };
}
