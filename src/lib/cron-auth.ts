// Защита cron-эндпоинтов. CRON_SECRET ОБЯЗАТЕЛЕН — без него
// любой может спамить sync-calls, sync-calendar и reminders.
// Раньше: if (CRON_SECRET) { check } — пустой секрет открывал endpoint.

import crypto from 'node:crypto';
import { NextResponse } from 'next/server';

const CRON_SECRET = process.env.CRON_SECRET ?? '';

/**
 * Проверяет Bearer-заголовок. Возвращает null если ОК, или 401-response.
 * Использовать в начале POST-handler'а:
 *   const fail = checkCronAuth(req); if (fail) return fail;
 */
export function checkCronAuth(req: Request): NextResponse | null {
  if (!CRON_SECRET) {
    console.error('[cron] CRON_SECRET не задан — endpoint закрыт');
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }

  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const token    = authHeader.slice(7);
  const expected = CRON_SECRET;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}
