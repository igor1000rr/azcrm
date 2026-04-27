// POST /api/notifications/read-all
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';

export async function POST() {
  try {
    const user = await requireUser();
    await db.notification.updateMany({
      where: { userId: user.id, isRead: false },
      data:  { isRead: true },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = (e as Error & { statusCode?: number }).statusCode ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
