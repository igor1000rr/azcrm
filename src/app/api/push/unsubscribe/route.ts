// POST /api/push/unsubscribe
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json() as { endpoint: string };
    if (!body.endpoint) return NextResponse.json({ error: 'endpoint required' }, { status: 400 });

    await db.pushSubscription.deleteMany({
      where: { endpoint: body.endpoint, userId: user.id },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = (e as Error & { statusCode?: number }).statusCode ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
