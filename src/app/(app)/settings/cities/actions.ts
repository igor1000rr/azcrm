'use server';

// Server Actions для управления городами (CRUD)
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

const citySchema = z.object({
  name: z.string().trim().min(1, 'Введите название').max(80),
});

export async function createCity(input: z.infer<typeof citySchema>) {
  await requireAdmin();
  const data = citySchema.parse(input);

  // Проверка уникальности (схема и так требует, но даём понятную ошибку)
  const exists = await db.city.findUnique({ where: { name: data.name } });
  if (exists) throw new Error(`Город «${data.name}» уже есть`);

  // Берём максимальный position и кладём в конец
  const maxPos = await db.city.aggregate({ _max: { position: true } });
  const position = (maxPos._max.position ?? 0) + 1;

  await db.city.create({ data: { name: data.name, position } });
  revalidatePath('/settings/cities');
  return { ok: true };
}

export async function renameCity(id: string, input: z.infer<typeof citySchema>) {
  await requireAdmin();
  const data = citySchema.parse(input);

  // Проверка что новое имя не занято другим городом
  const conflict = await db.city.findUnique({ where: { name: data.name } });
  if (conflict && conflict.id !== id) {
    throw new Error(`Город «${data.name}» уже существует`);
  }

  await db.city.update({ where: { id }, data: { name: data.name } });
  revalidatePath('/settings/cities');
  return { ok: true };
}

export async function toggleCity(id: string, isActive: boolean) {
  await requireAdmin();
  await db.city.update({ where: { id }, data: { isActive } });
  revalidatePath('/settings/cities');
  return { ok: true };
}

export async function deleteCity(id: string) {
  await requireAdmin();

  // Не удаляем если есть привязанные клиенты/лиды/расходы — иначе FK violation.
  // Вместо удаления предлагаем деактивировать.
  const [clientsCount, leadsCount, workLeadsCount, expensesCount] = await Promise.all([
    db.client.count({ where: { cityId: id } }),
    db.lead.count({ where: { cityId: id } }),
    db.lead.count({ where: { workCityId: id } }),
    db.expense.count({ where: { cityId: id } }),
  ]);

  const total = clientsCount + leadsCount + workLeadsCount + expensesCount;
  if (total > 0) {
    throw new Error(
      `Нельзя удалить — город используется в записях (клиентов: ${clientsCount}, лидов: ${leadsCount + workLeadsCount}, расходов: ${expensesCount}). Деактивируйте его вместо удаления.`,
    );
  }

  await db.city.delete({ where: { id } });
  revalidatePath('/settings/cities');
  return { ok: true };
}

export async function setDefaultCity(id: string) {
  await requireAdmin();
  // Только один город может быть по умолчанию
  await db.$transaction([
    db.city.updateMany({ data: { isDefault: false } }),
    db.city.update({ where: { id }, data: { isDefault: true } }),
  ]);
  revalidatePath('/settings/cities');
  return { ok: true };
}
