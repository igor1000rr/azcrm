// Юнит-тесты src/lib/cron-auth.ts — защита cron-эндпоинтов.
//
// Модуль читает process.env.CRON_SECRET в момент импорта. Чтобы проверить
// оба состояния (задан/не задан) — импортируем динамически через vi.resetModules.
//
// NextResponse мокаем чтобы не тянуть next runtime.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      status:  init?.status ?? 200,
      jsonBody: body,
    })),
  },
}));

beforeEach(() => {
  vi.resetModules();
});

async function loadWith(env: { CRON_SECRET?: string }) {
  if (env.CRON_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = env.CRON_SECRET;
  const mod = await import('@/lib/cron-auth');
  return mod.checkCronAuth;
}

function makeReq(authHeader?: string): Request {
  const headers = new Headers();
  if (authHeader) headers.set('authorization', authHeader);
  return new Request('http://localhost/api/cron/x', { method: 'POST', headers });
}

describe('checkCronAuth: CRON_SECRET не задан', () => {
  it('отвечает 503 — endpoint закрыт полностью', async () => {
    const checkCronAuth = await loadWith({ CRON_SECRET: undefined });
    const res = checkCronAuth(makeReq('Bearer anything')) as { status: number };
    expect(res).not.toBeNull();
    expect(res.status).toBe(503);
  });

  it('даже с правильным видом заголовка — 503', async () => {
    const checkCronAuth = await loadWith({ CRON_SECRET: undefined });
    const res = checkCronAuth(makeReq('Bearer ')) as { status: number };
    expect(res?.status).toBe(503);
  });
});

describe('checkCronAuth: CRON_SECRET задан', () => {
  const SECRET = 'test-secret-32-bytes-aaaabbbbccccdddd';

  it('без Authorization → 401', async () => {
    const checkCronAuth = await loadWith({ CRON_SECRET: SECRET });
    const res = checkCronAuth(makeReq()) as { status: number };
    expect(res?.status).toBe(401);
  });

  it('не Bearer формат → 401', async () => {
    const checkCronAuth = await loadWith({ CRON_SECRET: SECRET });
    const res = checkCronAuth(makeReq(`Token ${SECRET}`)) as { status: number };
    expect(res?.status).toBe(401);
  });

  it('неверный токен с той же длиной → 401', async () => {
    const checkCronAuth = await loadWith({ CRON_SECRET: SECRET });
    const wrong = 'X'.repeat(SECRET.length);
    const res = checkCronAuth(makeReq(`Bearer ${wrong}`)) as { status: number };
    expect(res?.status).toBe(401);
  });

  it('токен другой длины → 401 (без падения timingSafeEqual)', async () => {
    const checkCronAuth = await loadWith({ CRON_SECRET: SECRET });
    const res = checkCronAuth(makeReq('Bearer short')) as { status: number };
    expect(res?.status).toBe(401);
  });

  it('корректный токен → null (пропускаем дальше)', async () => {
    const checkCronAuth = await loadWith({ CRON_SECRET: SECRET });
    const res = checkCronAuth(makeReq(`Bearer ${SECRET}`));
    expect(res).toBeNull();
  });

  it('пустой Bearer (только слово Bearer без токена) → 401', async () => {
    const checkCronAuth = await loadWith({ CRON_SECRET: SECRET });
    const res = checkCronAuth(makeReq('Bearer ')) as { status: number };
    expect(res?.status).toBe(401);
  });
});
