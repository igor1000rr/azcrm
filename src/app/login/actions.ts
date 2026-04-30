'use server';

// Server actions для логин-страницы.
// Главное: precheckLogin — проверяет email+password БЕЗ создания сессии
// и говорит фронту нужна ли 2FA. Это позволяет показать поле для TOTP-кода
// до фактического signIn.
//
// Почему не делаем это внутри NextAuth authorize: NextAuth не имеет
// механизма «нужна 2FA, попробуй ещё раз» — authorize либо возвращает
// юзера, либо null (= неверный пароль). Поэтому добавляем отдельный шаг.

import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { checkRateLimit } from '@/lib/rate-limit';

const LOGIN_MAX       = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export interface PrecheckResult {
  ok:        boolean;
  // Нужно ли запросить TOTP-код перед окончательным signIn
  need2FA:   boolean;
  // Локализованная ошибка для показа пользователю
  errorText: string | null;
}

/**
 * Проверить email+password (БЕЗ создания сессии) и сообщить нужна ли 2FA.
 * НЕ повышает счётчик rate-limit (он сработает в authorize при signIn).
 *
 * Возвращает:
 *   { ok: false, need2FA: false, errorText: 'Неверный email или пароль' }
 *   { ok: true,  need2FA: false }  — можно сразу signIn без TOTP
 *   { ok: true,  need2FA: true  }  — показать поле TOTP, потом signIn
 */
export async function precheckLogin(input: {
  email:    string;
  password: string;
}): Promise<PrecheckResult> {
  const email    = String(input.email ?? '').toLowerCase().trim();
  const password = String(input.password ?? '');

  if (!email || !password) {
    return { ok: false, need2FA: false, errorText: 'Введите email и пароль' };
  }

  // Rate-limit считаем общий с обычным логином — чтобы precheck не позволял
  // подбирать пароль обходом счётчика.
  const rlKey = `login:${email}`;
  if (!checkRateLimit(rlKey, LOGIN_MAX, LOGIN_WINDOW_MS)) {
    return {
      ok: false, need2FA: false,
      errorText: 'Слишком много попыток. Подождите 15 минут.',
    };
  }

  const user = await db.user.findUnique({
    where: { email },
    select: {
      id: true, passwordHash: true, isActive: true,
      twoFactorEnabled: true, totpSecret: true,
    },
  });

  // Чтобы не давать утечь — отвечаем тем же текстом для несуществующего
  // юзера и неверного пароля. Время ответа выровняется bcrypt.compare.
  const dummyHash = '$2a$10$dummmydummmydummmydummmydummmydummmydummmydummmydummmye';
  const ok = await bcrypt.compare(password, user?.passwordHash ?? dummyHash);

  if (!user || !user.isActive || !ok) {
    return { ok: false, need2FA: false, errorText: 'Неверный email или пароль' };
  }

  return {
    ok:        true,
    need2FA:   Boolean(user.twoFactorEnabled && user.totpSecret),
    errorText: null,
  };
}
