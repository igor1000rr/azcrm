// GET /api/chat-templates — список активных шаблонов сообщений
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';

export async function GET() {
  try {
    await requireUser();
    const templates = await db.chatTemplate.findMany({
      where: { isActive: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, body: true, category: true },
    });
    return NextResponse.json({ templates });
  } catch (e) {
    const status = (e as Error & { statusCode?: number }).statusCode ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
