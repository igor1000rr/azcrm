// NextAuth v5 — credentials провайдер для AZ Group CRM
//
// 06.05.2026 — добавлено логирование попыток входа в AuditLog. До этого
// был только in-memory rate-limit по email (10/15мин). Теперь каждая
// успешная/неуспешная попытка пишется в AuditLog с IP/UA — Anna может
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { db } from './db';
import { checkRateLimit, resetRateLimit } from './rate-limit';
import { verifyTotp, findBackupCodeMatch, isLikelyTotpCode } from './two-factor';
import { audit } from './audit';
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

const LOGIN_MAX        = 10;
const LOGIN_WINDOW_MS  = 15 * 60 * 1000;

// Логируем неудачную попытку входа. userId=null потому что юзер не
// авторизовался. email и reason идут в after-payload. audit() сам
// вытащит IP и user-agent из next/headers.
async function logFailedLogin(email: string, reason: string) {
  await audit({
    userId:     null,
    action:     'auth.failed_login',
    entityType: 'User',
    entityId:   undefined,
    after:      { email, reason },
  });
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 30 }, // 30 дней
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      credentials: {
        email:    { label: 'Email',  type: 'email' },
        password: { label: 'Пароль', type: 'password' },
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
          await logFailedLogin(email, 'rate_limit');
          return null;
        }

        const user = await db.user.findUnique({ where: { email } });
        if (!user) {
          await logFailedLogin(email, 'unknown_email');
          return null;
        }
        if (!user.isActive) {
          await logFailedLogin(email, 'inactive');
          return null;
        }

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) {
          await logFailedLogin(email, 'bad_password');
          return null;
        }

        // ============ 2FA проверка ============
        if (user.twoFactorEnabled && user.totpSecret) {
          if (!totp) {
            await logFailedLogin(email, '2fa_required');
            return null;
          }

          let twoFaOk = false;
          if (isLikelyTotpCode(totp)) {
            twoFaOk = verifyTotp(user.totpSecret, totp);
          } else {
            const codes = (user.twoFactorBackupCodes ?? []) as string[];
            const matchIdx = await findBackupCodeMatch(codes, totp);
            if (matchIdx >= 0) {
              twoFaOk = true;
              const remaining = codes.filter((_, i) => i !== matchIdx);
              await db.user.update({
                where: { id: user.id },
                data:  { twoFactorBackupCodes: remaining },
              });
            }
          }

          if (!twoFaOk) {
            await logFailedLogin(email, 'bad_2fa');
            return null;
          }
        }

        resetRateLimit(rlKey);

        await db.user.update({
          where: { id: user.id },
          data:  { lastSeenAt: new Date(), status: 'ONLINE' },
        });

        // Логируем успешный вход — это нужно для compliance и расследования
        // инцидентов. При входе с нового необычного IP Anna увидит в журнале.
        await audit({
          userId:     user.id,
          action:     'auth.success',
          entityType: 'User',
          entityId:   user.id,
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
 * по БД на каждом запросе.
 */
export async function requireUser() {
  const user = await currentUser();
  if (!user) {
    const e = new Error('Не авторизован');
    (e as Error & { statusCode?: number }).statusCode = 401;
    throw e;
  }

  const fresh = await db.user.findUnique({
    where:  { id: user.id },
    select: { isActive: true, mustChangePassword: true },
  });

  if (!fresh) {
    const e = new Error('Учётная запись не найдена');
    (e as Error & { statusCode?: number }).statusCode = 401;
    throw e;
  }

  if (!fresh.isActive) {
    const e = new Error('Учётная запись отключена');
    (e as Error & { statusCode?: number }).statusCode = 401;
    throw e;
  }

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
