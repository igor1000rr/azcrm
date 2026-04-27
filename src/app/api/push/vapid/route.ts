// GET /api/push/vapid — public key для подписки
import { NextResponse } from 'next/server';
import { getVapidPublicKey } from '@/lib/push';

export async function GET() {
  const key = getVapidPublicKey();
  if (!key) return NextResponse.json({ error: 'push not configured' }, { status: 503 });
  return NextResponse.json({ key });
}
