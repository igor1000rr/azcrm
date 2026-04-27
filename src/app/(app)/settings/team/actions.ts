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
    };
    if (data.password && data.password.length >= 6) {
      updateData.passwordHash = await bcrypt.hash(data.password, 10);
    }
    await db.user.update({ where: { id: data.id }, data: updateData as never });

    await audit({
      userId:     admin.id,
      action:     'user.update',
      entityType: 'User',
      entityId:   data.id,
      after:      { email: data.email, role: data.role, isActive: data.isActive },
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
      },
    });
    await audit({
      userId:     admin.id,
      action:     'user.create',
      entityType: 'User',
      entityId:   created.id,
      after:      { email: data.email, role: data.role },
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

  await db.user.update({
    where: { id },
    data:  { passwordHash: await bcrypt.hash(newPassword, 10) },
  });

  await audit({
    userId:     admin.id,
    action:     'user.reset_password',
    entityType: 'User',
    entityId:   id,
  });

  return { ok: true };
}
