// NextAuth v5 — credentials провайдер для AZ Group CRM
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { db } from './db';
import { checkRateLimit, resetRateLimit } from './rate-limit';
import type { UserRole } from '@prisma/client';

declare module 'next-auth' {
  interface Session {
    user: {
      id:    string;
      email: string;
      name:  string;
      role:  UserRole;
    };
  }
  interface User {
    role?: UserRole;
  }
}

// Лимит попыток логина: 10 за 15 минут на email. Достаточно для опечаток
// и одновременно отбивает brute-force. После успешного входа счётчик сбрасывается.
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
      },
      async authorize(credentials) {
        const email    = String(credentials?.email ?? '').toLowerCase().trim();
        const password = String(credentials?.password ?? '');
        if (!email || !password) return null;

        // Rate-limit по email — отбивает brute-force
        const rlKey = `login:${email}`;
        if (!checkRateLimit(rlKey, LOGIN_MAX, LOGIN_WINDOW_MS)) {
          // Нарочно не различаем "много попыток" от "неверный пароль" в ответе
          // чтобы атакующий не мог понять что email существует и просто залочен.
          console.warn(`[auth] rate-limit hit for ${email}`);
          return null;
        }

        const user = await db.user.findUnique({ where: { email } });
        if (!user) return null;
        // Деактивированных не пускаем
        if (!user.isActive) return null;

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;

        // Сбрасываем счётчик попыток при успешном входе
        resetRateLimit(rlKey);

        // Обновляем "последний вход"
        await db.user.update({
          where: { id: user.id },
          data:  { lastSeenAt: new Date(), status: 'ONLINE' },
        });

        return {
          id:    user.id,
          email: user.email,
          name:  user.name,
          role:  user.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        (token as Record<string, unknown>).uid  = user.id;
        (token as Record<string, unknown>).role = (user as { role?: UserRole }).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        const t = token as { uid?: string; role?: UserRole };
        session.user.id   = t.uid ?? '';
        session.user.role = (t.role ?? 'SALES') as UserRole;
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

/** Хелпер: получить юзера ИЛИ выкинуть 401 (для server actions) */
export async function requireUser() {
  const user = await currentUser();
  if (!user) {
    const e = new Error('Не авторизован');
    (e as Error & { statusCode?: number }).statusCode = 401;
    throw e;
  }
  return user;
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
