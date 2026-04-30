// POST /api/push/unsubscribe
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { parseBody } from '@/lib/api-validation';

const UnsubscribeSchema = z.object({
  endpoint: z.string().url().min(20).max(2048),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = await parseBody(req, UnsubscribeSchema);
    if (!parsed.ok) return parsed.response;

    await db.pushSubscription.deleteMany({
      where: { endpoint: parsed.data.endpoint, userId: user.id },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = (e as Error & { statusCode?: number }).statusCode ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
