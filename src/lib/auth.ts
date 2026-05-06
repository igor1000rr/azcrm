// NextAuth v5 — credentials провайдер для AZ Group CRM
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { db } from './db';
import { checkRateLimit, resetRateLimit } from './rate-limit';
import { verifyTotp, findBackupCodeMatch, isLikelyTotpCode } from './two-factor';
import type { UserRole } from '@prisma/client';
import { logger } from '@/lib/logger';

declare module 'next-auth' {
  interface Session {
    user: {
      id:    string;
      email: string;
      name:  string;
      role:  UserRole;
      mustChangePassword?: boolean;
    };
  }
  interface User {
    role?: UserRole;
    mustChangePassword?: boolean;
  }
}

// Лимит попыток логина: 10 за 15 минут на email. Защищает И от brute-force
// пароля, И от перебора TOTP-кодов (всего 10^6 = миллион вариантов, при
// 10 попытках в 15 мин подбор займёт миллионы лет).
const LOGIN_MAX        = 10;
const LOGIN_WINDOW_MS  = 15 * 60 * 1000;

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 30 }, // 30 дней
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      credentials: {
        email:    { label: 'Email',  type: 'email' },
        password: { label: 'Пароль', type: 'password' },
        // 2FA: TOTP-код или backup-код (XXXX-XXXX). Передаётся только
        // на втором шаге логина после precheckLogin().
        totp:     { label: 'Код 2FA', type: 'text' },
      },
      async authorize(credentials) {
        const email    = String(credentials?.email ?? '').toLowerCase().trim();
        const password = String(credentials?.password ?? '');
        const totp     = String(credentials?.totp ?? '').trim();
        if (!email || !password) return null;

        const rlKey = `login:${email}`;
        if (!checkRateLimit(rlKey, LOGIN_MAX, LOGIN_WINDOW_MS)) {
          logger.warn(`[auth] rate-limit hit for ${email}`);
          return null;
        }

        const user = await db.user.findUnique({ where: { email } });
        if (!user) return null;
        if (!user.isActive) return null;

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;

        // ============ 2FA проверка ============
        // Если у юзера активирована 2FA, требуем валидный TOTP или backup-код.
        // Без них return null = ошибка signIn — фронт должен ДО этого сделать
        // precheckLogin() и узнать что нужен код, чтобы показать второй шаг.
        if (user.twoFactorEnabled && user.totpSecret) {
          if (!totp) {
            // Это страховка на случай если фронт не сделал precheck — без totp
            // не пускаем. На UI это покажется как «Неверные данные», поэтому
            // важно чтобы фронт правильно вызывал precheckLogin().
            return null;
          }

          let twoFaOk = false;
          if (isLikelyTotpCode(totp)) {
            // 6 цифр — стандартный TOTP
            twoFaOk = verifyTotp(user.totpSecret, totp);
          } else {
            // Иначе пробуем как backup-код (XXXX-XXXX)
            const codes = (user.twoFactorBackupCodes ?? []) as string[];
            const matchIdx = await findBackupCodeMatch(codes, totp);
            if (matchIdx >= 0) {
              twoFaOk = true;
              // Удаляем использованный backup-код — они одноразовые
              const remaining = codes.filter((_, i) => i !== matchIdx);
              await db.user.update({
                where: { id: user.id },
                data:  { twoFactorBackupCodes: remaining },
              });
            }
          }

          if (!twoFaOk) return null;
        }

        resetRateLimit(rlKey);

        await db.user.update({
          where: { id: user.id },
          data:  { lastSeenAt: new Date(), status: 'ONLINE' },
        });

        return {
          id:    user.id,
          email: user.email,
          name:  user.name,
          role:  user.role,
          mustChangePassword: user.mustChangePassword,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        const t = token as Record<string, unknown>;
        t.uid  = user.id;
        t.role = (user as { role?: UserRole }).role;
        t.mustChangePassword = (user as { mustChangePassword?: boolean }).mustChangePassword ?? false;
      }
      // При вызове update() из клиента (после смены пароля) — перечитаем флаг из БД
      if (trigger === 'update' && (token as { uid?: string }).uid) {
        const fresh = await db.user.findUnique({
          where: { id: (token as { uid: string }).uid },
          select: { mustChangePassword: true, role: true },
        });
        if (fresh) {
          (token as Record<string, unknown>).mustChangePassword = fresh.mustChangePassword;
          (token as Record<string, unknown>).role = fresh.role;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        const t = token as { uid?: string; role?: UserRole; mustChangePassword?: boolean };
        session.user.id   = t.uid ?? '';
        session.user.role = (t.role ?? 'SALES') as UserRole;
        session.user.mustChangePassword = t.mustChangePassword ?? false;
      }
      return session;
    },
  },
});

/** Хелпер: получить текущего пользователя или null */
export async function currentUser() {
  const session = await auth();
  return session?.user ?? null;
}

/**
 * Хелпер: получить юзера ИЛИ выкинуть 401 (для server actions).
 *
 * 06.05.2026 — пункт #117 аудита: добавлена проверка User.isActive
 * по БД на каждом запросе. До этого JWT кэшировался на 30 дней,
 * и при деактивации (toggleUserActive(id, false)) уволенный
 * сотрудник продолжал работать в текущей сессии до её истечения.
 *
 * Сейчас requireUser() при каждом вызове сходит в БД за isActive.
 * Это +1 SELECT на каждый action, но БД на той же VPS — overhead
 * <1ms. После деактивации сотрудник на следующем запросе получит
 * 401 «Учётная запись отключена».
 *
 * mustChangePassword тоже проверяется здесь — если флаг True и
 * текущий route не /change-password, выкидываем 403 с указанием
 * куда идти. Middleware дополнительно делает redirect.
 *
 * Для production масштабов >100 юзеров стоит добавить кэш на ~30 сек,
 * но для команды Anna на 8 человек overhead незаметный.
 */
export async function requireUser() {
  const user = await currentUser();
  if (!user) {
    const e = new Error('Не авторизован');
    (e as Error & { statusCode?: number }).statusCode = 401;
    throw e;
  }

  // Проверяем isActive в БД на каждом запросе (#117 аудита).
  // Это нужно чтобы деактивация юзера (увольнение) сразу обрывала
  // активные сессии, а не ждала истечения 30-дневного JWT.
  const fresh = await db.user.findUnique({
    where:  { id: user.id },
    select: { isActive: true, mustChangePassword: true },
  });

  if (!fresh) {
    // Юзер удалён из БД — выкидываем как 401
    const e = new Error('Учётная запись не найдена');
    (e as Error & { statusCode?: number }).statusCode = 401;
    throw e;
  }

  if (!fresh.isActive) {
    const e = new Error('Учётная запись отключена');
    (e as Error & { statusCode?: number }).statusCode = 401;
    throw e;
  }

  // Возвращаем актуальный mustChangePassword (флаг мог поменяться
  // между запросами — например, админ нажал «сбросить пароль»).
  return { ...user, mustChangePassword: fresh.mustChangePassword };
}

/** Хелпер: только админ */
export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== 'ADMIN') {
    const e = new Error('Недостаточно прав');
    (e as Error & { statusCode?: number }).statusCode = 403;
    throw e;
  }
  return user;
}
