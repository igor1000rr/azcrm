// GET /api/blueprints — список активных шаблонов
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';

export async function GET() {
  try {
    await requireUser();

    const blueprints = await db.documentBlueprint.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, description: true,
        format: true, placeholders: true,
      },
    });

    return NextResponse.json({ blueprints });
  } catch (e) {
    const status = (e as Error & { statusCode?: number }).statusCode ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
