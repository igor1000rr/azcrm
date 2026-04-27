// GET /api/google/auth — редирект на Google OAuth consent
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { buildAuthUrl, isGoogleConfigured } from '@/lib/google';
import crypto from 'node:crypto';
import { cookies } from 'next/headers';

export async function GET() {
  try {
    const user = await requireUser();

    if (!isGoogleConfigured()) {
      return NextResponse.json(
        { error: 'Google OAuth не настроен (GOOGLE_CLIENT_ID/SECRET в .env)' },
        { status: 500 },
      );
    }

    // Генерим state для CSRF — кладём userId + случайный токен
    const nonce = crypto.randomBytes(16).toString('hex');
    const state = `${user.id}:${nonce}`;

    // Сохраняем state в cookie для проверки в callback
    const cookieStore = await cookies();
    cookieStore.set('google_oauth_state', state, {
      httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600,
    });

    return NextResponse.redirect(buildAuthUrl(state));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
