// GET /api/google/callback?code=...&state=...
//
// БЕЗОПАСНОСТЬ:
//   1. state проверяется по cookie (CSRF protection).
//   2. userId из state СВЕРЯЕТСЯ с текущей сессией — иначе атакующий мог бы
//      инициировать OAuth-flow от своего юзера и подсунуть state-cookie
//      в браузер жертвы (через XSS на любом другом субдомене), и при
//      возврате callback'а привязать СВОЙ Google-аккаунт к чужому CRM-юзеру
//      (после чего читать чужой Google Calendar, и т.д.).
//      Защита: сессия должна совпадать с userId зашитым в state.
//   3. access_token и refresh_token шифруются перед сохранением в БД
//      (AES-256-GCM с ENCRYPTION_KEY из .env). При утечке БД токены
//      без ключа бесполезны.
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { exchangeCodeForTokens } from '@/lib/google';
import { auth } from '@/lib/auth';
import { encrypt, encryptNullable } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { cookies } from 'next/headers';

export async function GET(req: NextRequest) {
  const code  = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const err   = req.nextUrl.searchParams.get('error');

  if (err) {
    return NextResponse.redirect(new URL('/settings/profile?google=error', req.url));
  }
  if (!code || !state) {
    return NextResponse.redirect(new URL('/settings/profile?google=missing', req.url));
  }

  // Проверка state из cookie
  const cookieStore = await cookies();
  const expectedState = cookieStore.get('google_oauth_state')?.value;
  if (!expectedState || expectedState !== state) {
    return NextResponse.redirect(new URL('/settings/profile?google=csrf', req.url));
  }
  cookieStore.delete('google_oauth_state');

  const userId = state.split(':')[0];
  if (!userId) {
    return NextResponse.redirect(new URL('/settings/profile?google=csrf', req.url));
  }

  // Доп. проверка: сессия должна принадлежать тому же юзеру что в state.
  // Если кто-то подсунул чужую state-cookie через XSS на смежном домене,
  // и жертва зашла в callback с code= — мы привяжем токены к атакующему,
  // а не к жертве. Эта проверка это блокирует.
  const session = await auth();
  if (!session?.user || session.user.id !== userId) {
    return NextResponse.redirect(new URL('/settings/profile?google=session', req.url));
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    await db.user.update({
      where: { id: userId },
      data: {
        // Шифруем перед сохранением. encryptNullable вернёт undefined если
        // refresh_token не пришёл (Google не выдаёт его при повторных connect'ах
        // если access_type=offline + prompt=consent не указали) — это валидно
        // для prisma и не перезатрёт существующее поле.
        googleAccessToken:          encrypt(tokens.access_token),
        googleAccessTokenExpiresAt: expiresAt,
        googleRefreshToken:         encryptNullable(tokens.refresh_token),
        googleCalendarId:           'primary',
        googleConnectedAt:          new Date(),
      },
    });

    return NextResponse.redirect(new URL('/settings/profile?google=connected', req.url));
  } catch (e) {
    logger.error('OAuth callback error:', e);
    return NextResponse.redirect(new URL('/settings/profile?google=failed', req.url));
  }
}
