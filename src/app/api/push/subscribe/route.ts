// POST /api/push/subscribe
// Сохраняет PushSubscription в БД для текущего юзера
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json() as {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    };

    if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
      return NextResponse.json({ error: 'invalid subscription' }, { status: 400 });
    }

    await db.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      update: {
        userId:     user.id,
        p256dh:     body.keys.p256dh,
        authKey:    body.keys.auth,
        userAgent:  req.headers.get('user-agent') ?? null,
        lastUsedAt: new Date(),
      },
      create: {
        userId:     user.id,
        endpoint:   body.endpoint,
        p256dh:     body.keys.p256dh,
        authKey:    body.keys.auth,
        userAgent:  req.headers.get('user-agent') ?? null,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = (e as Error & { statusCode?: number }).statusCode ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
