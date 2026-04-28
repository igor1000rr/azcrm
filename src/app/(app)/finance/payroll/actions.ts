'use server';

// Конфиг ЗП менеджера: ставка/час, ZUS, PIT
// Старые поля fixedSalary/taxAmount остаются в БД для совместимости
// со старыми данными, но в новом UI не используются.
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { audit } from '@/lib/audit';

const schema = z.object({
  userId:     z.string(),
  hourlyRate: z.coerce.number().min(0).default(0),
  zus:        z.coerce.number().min(0).default(0),
  pit:        z.coerce.number().min(0).default(0),
  notes:      z.string().optional(),
});

export async function upsertPayrollConfig(input: z.infer<typeof schema>) {
  const user = await requireAdmin();
  const data = schema.parse(input);

  const existing = await db.payrollConfig.findUnique({ where: { userId: data.userId } });
  await db.payrollConfig.upsert({
    where: { userId: data.userId },
    update: {
      hourlyRate: data.hourlyRate,
      zus:        data.zus,
      pit:        data.pit,
      notes:      data.notes || null,
    },
    create: {
      userId:     data.userId,
      hourlyRate: data.hourlyRate,
      zus:        data.zus,
      pit:        data.pit,
      notes:      data.notes || null,
    },
  });

  await audit({
    userId: user.id, action: 'payroll.upsert', entityType: 'PayrollConfig',
    entityId: data.userId, before: existing ?? undefined, after: data,
  });

  revalidatePath('/finance/payroll');
  return { ok: true };
}
