'use server';

// Управление пользователями (только ADMIN)
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { audit } from '@/lib/audit';

const userSchema = z.object({
  id:       z.string().optional(),
  email:    z.string().email('Некорректный email'),
  name:     z.string().min(2, 'Минимум 2 символа').max(100),
  role:     z.enum(['ADMIN', 'SALES', 'LEGAL']),
  phone:    z.string().optional().nullable(),
  password: z.string().optional(),
  isActive: z.boolean().default(true),
  // Персональный % комиссии. null = использовать дефолт услуги.
  commissionPercent: z.coerce.number().min(0).max(100).optional().nullable(),
});

export async function upsertUser(input: z.infer<typeof userSchema>) {
  const admin = await requireAdmin();
  const data = userSchema.parse(input);

  if (data.id) {
    // Обновление существующего
    const updateData: Record<string, unknown> = {
      email:    data.email.toLowerCase().trim(),
      name:     data.name,
      role:     data.role,
      phone:    data.phone || null,
      isActive: data.isActive,
      commissionPercent: data.commissionPercent ?? null,
    };
    if (data.password && data.password.length >= 6) {
      updateData.passwordHash = await bcrypt.hash(data.password, 10);
      // 06.05.2026 — пункт #32 аудита: при изменении пароля
      // админом выставляем mustChangePassword=true. Сотрудник при
      // следующем входе будет обязан сменить.
      updateData.mustChangePassword = true;
    }
    await db.user.update({ where: { id: data.id }, data: updateData as never });

    await audit({
      userId:     admin.id,
      action:     'user.update',
      entityType: 'User',
      entityId:   data.id,
      after:      { email: data.email, role: data.role, isActive: data.isActive, commissionPercent: data.commissionPercent },
    });
  } else {
    // Создание
    if (!data.password || data.password.length < 6) {
      throw new Error('Пароль должен быть минимум 6 символов');
    }
    const created = await db.user.create({
      data: {
        email:        data.email.toLowerCase().trim(),
        name:         data.name,
        role:         data.role,
        phone:        data.phone || null,
        isActive:     data.isActive,
        passwordHash: await bcrypt.hash(data.password, 10),
        // При создании нового юзера всегда требуем смену пароля при
        // первом входе (пункт #91 аудита).
        mustChangePassword: true,
        commissionPercent: data.commissionPercent ?? null,
      },
    });
    await audit({
      userId:     admin.id,
      action:     'user.create',
      entityType: 'User',
      entityId:   created.id,
      after:      { email: data.email, role: data.role, commissionPercent: data.commissionPercent },
    });
  }

  revalidatePath('/settings/team');
  return { ok: true };
}

export async function toggleUserActive(id: string, isActive: boolean) {
  const admin = await requireAdmin();

  // Защита: нельзя деактивировать единственного админа
  if (!isActive) {
    const user = await db.user.findUnique({ where: { id }, select: { role: true } });
    if (user?.role === 'ADMIN') {
      const adminCount = await db.user.count({ where: { role: 'ADMIN', isActive: true } });
      if (adminCount <= 1) throw new Error('Нельзя деактивировать единственного администратора');
    }
  }

  await db.user.update({ where: { id }, data: { isActive } });

  await audit({
    userId:     admin.id,
    action:     isActive ? 'user.activate' : 'user.deactivate',
    entityType: 'User',
    entityId:   id,
  });

  revalidatePath('/settings/team');
  return { ok: true };
}

export async function resetUserPassword(id: string, newPassword: string) {
  const admin = await requireAdmin();
  if (newPassword.length < 6) throw new Error('Пароль должен быть минимум 6 символов');

  // 06.05.2026 — пункт #32 аудита: mustChangePassword=true при ресете.
  // Раньше флаг не выставлялся — сотрудник получал сброшенный пароль
  // от admin'а и мог им пользоваться хоть вечно — плохо с точки зрения
  // безопасности (админ знает пароль сотрудника).
  await db.user.update({
    where: { id },
    data:  {
      passwordHash: await bcrypt.hash(newPassword, 10),
      mustChangePassword: true,
    },
  });

  await audit({
    userId:     admin.id,
    action:     'user.reset_password',
    entityType: 'User',
    entityId:   id,
  });

  return { ok: true };
}

/**
 * Обновить только commissionPercent — отдельный action для inline-редактирования
 * прямо в списке команды без открытия модалки.
 */
export async function setUserCommissionPercent(id: string, percent: number | null) {
  const admin = await requireAdmin();
  if (percent !== null && (percent < 0 || percent > 100)) {
    throw new Error('% должен быть от 0 до 100');
  }

  await db.user.update({
    where: { id },
    data:  { commissionPercent: percent },
  });

  await audit({
    userId:     admin.id,
    action:     'user.set_commission',
    entityType: 'User',
    entityId:   id,
    after:      { commissionPercent: percent },
  });

  revalidatePath('/settings/team');
  revalidatePath('/finance/commissions');
  revalidatePath('/finance/payroll');
  return { ok: true };
}
