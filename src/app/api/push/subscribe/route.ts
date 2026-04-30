// POST /api/push/subscribe
// Сохраняет PushSubscription в БД для текущего юзера
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { parseBody } from '@/lib/api-validation';

const SubscribeSchema = z.object({
  // PushSubscription endpoint от браузера — длинный URL FCM/APNs/Mozilla
  endpoint: z.string().url().min(20).max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth:   z.string().min(1).max(256),
  }),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = await parseBody(req, SubscribeSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

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
