'use server';

// Server actions для управления 2FA в профиле пользователя.
// Workflow включения:
//   1. start2faSetup() → генерит новый secret, возвращает QR + текст-секрет.
//      Сохраняет secret в БД но twoFactorEnabled остаётся false.
//   2. confirm2faSetup(code) → проверяет первый TOTP-код (что юзер успешно
//      настроил приложение). Включает twoFactorEnabled=true, генерит и
//      возвращает 10 backup-кодов (показать ОДИН раз).
//   3. disable2fa(password) → требует пароль, очищает все 2FA поля.
//   4. regenerateBackupCodes(password) → требует пароль, генерит новый
//      набор backup-кодов (предыдущие становятся недействительны).

import { revalidatePath } from 'next/cache';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { audit } from '@/lib/audit';
import {
  generateTotpSecret, getTotpUri, generateQrDataUrl,
  verifyTotp, generateBackupCodes, hashBackupCodes,
} from '@/lib/two-factor';

export interface SetupStartResult {
  qrDataUrl: string;
  secret:    string;  // показываем юзеру в текстовом виде на случай если QR не сканируется
}

/**
 * Начать процесс настройки 2FA.
 * Генерит новый secret, сохраняет в БД (но 2FA пока выключена), возвращает
 * QR + текстовый секрет для отображения. До confirm2faSetup() это не
 * влияет на логин юзера.
 */
export async function start2faSetup(): Promise<SetupStartResult> {
  const user = await requireUser();

  const secret = generateTotpSecret();
  await db.user.update({
    where: { id: user.id },
    data:  {
      totpSecret:           secret,
      // Очищаем старые backup-коды если были — пока сетап не подтверждён,
      // они в любом случае не работают (twoFactorEnabled=false).
      twoFactorBackupCodes: [],
      twoFactorEnabled:     false,
    },
  });

  const uri = getTotpUri(secret, user.email);
  const qrDataUrl = await generateQrDataUrl(uri);

  return { qrDataUrl, secret };
}

export interface ConfirmResult {
  ok:           boolean;
  // Plain-text backup коды — показываются ОДИН раз сразу после confirm.
  // Юзер должен их сохранить (распечатать / вписать в менеджер паролей).
  backupCodes?: string[];
  error?:       string;
}

/**
 * Подтвердить настройку 2FA — проверить первый код, включить 2FA,
 * сгенерить и вернуть 10 backup-кодов.
 */
export async function confirm2faSetup(code: string): Promise<ConfirmResult> {
  const user = await requireUser();

  const fullUser = await db.user.findUnique({
    where: { id: user.id },
    select: { id: true, totpSecret: true, twoFactorEnabled: true },
  });
  if (!fullUser?.totpSecret) {
    return { ok: false, error: 'Сначала запустите настройку (кнопка «Включить»).' };
  }
  if (fullUser.twoFactorEnabled) {
    return { ok: false, error: '2FA уже включена.' };
  }

  const valid = verifyTotp(fullUser.totpSecret, code);
  if (!valid) {
    return { ok: false, error: 'Неверный код. Проверьте время на телефоне и попробуйте снова.' };
  }

  // Генерим backup-коды и сохраняем хеши
  const backupCodes = generateBackupCodes(10);
  const hashed = await hashBackupCodes(backupCodes);

  await db.user.update({
    where: { id: user.id },
    data:  {
      twoFactorEnabled:     true,
      twoFactorBackupCodes: hashed,
    },
  });

  await audit({
    userId:     user.id,
    action:     '2fa.enable',
    entityType: 'User',
    entityId:   user.id,
  });

  revalidatePath('/settings/profile');
  return { ok: true, backupCodes };
}

/**
 * Отключить 2FA — требует ввод пароля для подтверждения личности.
 */
export async function disable2fa(password: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();

  const fullUser = await db.user.findUnique({
    where: { id: user.id },
    select: { id: true, passwordHash: true },
  });
  if (!fullUser) return { ok: false, error: 'Пользователь не найден' };

  const ok = await bcrypt.compare(password, fullUser.passwordHash);
  if (!ok) return { ok: false, error: 'Неверный пароль' };

  await db.user.update({
    where: { id: user.id },
    data:  {
      twoFactorEnabled:     false,
      totpSecret:           null,
      twoFactorBackupCodes: [],
    },
  });

  await audit({
    userId:     user.id,
    action:     '2fa.disable',
    entityType: 'User',
    entityId:   user.id,
  });

  revalidatePath('/settings/profile');
  return { ok: true };
}

export interface RegenerateResult {
  ok:           boolean;
  backupCodes?: string[];
  error?:       string;
}

/**
 * Перегенерировать backup-коды (старые становятся недействительными).
 * Требует пароль для защиты — иначе кто угодно с открытой сессией смог бы
 * себе сгенерить новые коды и обходить блокировку при потере телефона.
 */
export async function regenerateBackupCodes(password: string): Promise<RegenerateResult> {
  const user = await requireUser();

  const fullUser = await db.user.findUnique({
    where: { id: user.id },
    select: { id: true, passwordHash: true, twoFactorEnabled: true },
  });
  if (!fullUser) return { ok: false, error: 'Пользователь не найден' };
  if (!fullUser.twoFactorEnabled) {
    return { ok: false, error: 'Сначала включите 2FA.' };
  }

  const ok = await bcrypt.compare(password, fullUser.passwordHash);
  if (!ok) return { ok: false, error: 'Неверный пароль' };

  const backupCodes = generateBackupCodes(10);
  const hashed = await hashBackupCodes(backupCodes);

  await db.user.update({
    where: { id: user.id },
    data:  { twoFactorBackupCodes: hashed },
  });

  await audit({
    userId:     user.id,
    action:     '2fa.regenerate_backup_codes',
    entityType: 'User',
    entityId:   user.id,
  });

  revalidatePath('/settings/profile');
  return { ok: true, backupCodes };
}
