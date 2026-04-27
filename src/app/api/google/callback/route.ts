// GET /api/google/callback?code=...&state=...
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { exchangeCodeForTokens } from '@/lib/google';
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

  try {
    const tokens = await exchangeCodeForTokens(code);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    await db.user.update({
      where: { id: userId },
      data: {
        googleAccessToken:          tokens.access_token,
        googleAccessTokenExpiresAt: expiresAt,
        googleRefreshToken:         tokens.refresh_token ?? undefined,
        googleCalendarId:           'primary',
        googleConnectedAt:          new Date(),
      },
    });

    return NextResponse.redirect(new URL('/settings/profile?google=connected', req.url));
  } catch (e) {
    console.error('OAuth callback error:', e);
    return NextResponse.redirect(new URL('/settings/profile?google=failed', req.url));
  }
}
