'use server';

import { revalidatePath } from 'next/cache';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { PASSWORD_MIN_LENGTH } from '@/lib/password-policy';

const schema = z.object({
  currentPassword: z.string().min(1, 'Введите текущий пароль'),
  newPassword:     z.string().min(PASSWORD_MIN_LENGTH, `Новый пароль — минимум ${PASSWORD_MIN_LENGTH} символов`),
  confirmPassword: z.string().min(1),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: 'Пароли не совпадают',
  path: ['confirmPassword'],
}).refine((d) => d.currentPassword !== d.newPassword, {
  message: 'Новый пароль должен отличаться от текущего',
  path: ['newPassword'],
});

/**
 * Смена собственного пароля. Используется и при принудительной смене
 * (mustChangePassword=true), и для добровольной смены из профиля.
 *
 * 06.05.2026 — пункт #33 аудита: минимум пароля импортируется из
 * @/lib/password-policy — единый источник истины для всех мест валидации.
 */
export async function changeMyPassword(
  input: z.infer<typeof schema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? 'Данные некорректны' };
  }
  const data = parsed.data;

  const dbUser = await db.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  });
  if (!dbUser) return { ok: false, error: 'Пользователь не найден' };

  const ok = await bcrypt.compare(data.currentPassword, dbUser.passwordHash);
  if (!ok) return { ok: false, error: 'Текущий пароль неверный' };

  const newHash = await bcrypt.hash(data.newPassword, 10);

  await db.user.update({
    where: { id: user.id },
    data:  { passwordHash: newHash, mustChangePassword: false },
  });

  await audit({
    userId:     user.id,
    action:     'user.password_changed',
    entityType: 'User',
    entityId:   user.id,
  });

  revalidatePath('/');
  return { ok: true };
}
