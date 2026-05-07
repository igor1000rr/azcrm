// GET /api/health — health check для uptime мониторинга.
//
// 07.05.2026 — добавлен для Anna чтобы она могла настроить внешний
// мониторинг (например https://uptimerobot.com/) на https://crm.azgroupcompany.net/api/health
// и получать email если сервер лёг. Без auth (uptimerobot не умеет NextAuth-сессию).
//
// Ответы:
//   200 OK + JSON { ok: true, db: 'ok', uptime } — всё работает
//   503 + JSON { ok: false, db: 'error' }       — БД недоступна
//
// Страховка от утечек:
//   - Не выкладываем ни версию Node, ни версию Next, ни имя хоста,
//     ни количество юзеров в БД — всё это сведения для атакующего.
//   - process.uptime() — в секундах, полезно для мониторинга (понять
//     когда был restart) — это ОК выдавать наружу.
//
// Проверка БД: простой SELECT 1 через $queryRaw. Не нагружает БД, но
// подтверждает что коннект жив.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const startedAt = Date.now();
  let dbStatus: 'ok' | 'error' = 'ok';
  let dbError: string | null = null;

  try {
    // SELECT 1 — минимальный запрос чтобы проверить connection pool.
    await db.$queryRaw`SELECT 1`;
  } catch (e) {
    dbStatus = 'error';
    dbError = (e as Error).message?.slice(0, 100) ?? 'unknown';
  }

  const elapsedMs = Date.now() - startedAt;
  const ok = dbStatus === 'ok';

  return NextResponse.json(
    {
      ok,
      db:        dbStatus,
      ...(dbError && { dbError }),
      uptime:    Math.round(process.uptime()),
      checkMs:   elapsedMs,
      timestamp: new Date().toISOString(),
    },
    {
      status:  ok ? 200 : 503,
      // Не кэшировать этот endpoint ни браузером, ни CDN.
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    },
  );
}

// HEAD — для uptime мониторов которые проверяют только статус (без body).
export async function HEAD() {
  try {
    await db.$queryRaw`SELECT 1`;
    return new NextResponse(null, { status: 200 });
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}
