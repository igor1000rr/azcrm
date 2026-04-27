// GET /api/notifications/list — последние уведомления юзера
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';

export async function GET() {
  try {
    const user = await requireUser();
    const items = await db.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    const unreadCount = await db.notification.count({
      where: { userId: user.id, isRead: false },
    });
    return NextResponse.json({
      items: items.map((i) => ({
        id: i.id, kind: i.kind, title: i.title,
        body: i.body, link: i.link, isRead: i.isRead,
        createdAt: i.createdAt.toISOString(),
      })),
      unreadCount,
    });
  } catch (e) {
    const status = (e as Error & { statusCode?: number }).statusCode ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
