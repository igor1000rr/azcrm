// Integration: POST /api/viber/webhook
// Критично для безопасности — проверяет что route действительно валидирует
// подпись и резолвит account по query param. Без этих тестов можно
// случайно закомментировать verifyViberSignature и никто не заметит.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'crypto';

const mocks = vi.hoisted(() => ({
  db: {
    viberAccount: {
      findUnique: vi.fn(),
    },
  },
  viber: {
    verifyViberSignature: vi.fn(),
    handleViberEvent:     vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({ db: mocks.db }));

// КРИТИЧНО: мокаем @/lib/viber целиком — verifyViberSignature ДОЛЖЕН быть
// вызван из роута. Если его кто-то закомментирует, мок не сработает и
// тест "плохая подпись -> 401" упадёт.
vi.mock('@/lib/viber', async () => {
  const actual = await vi.importActual<typeof import('@/lib/viber')>('@/lib/viber');
  return {
    ...actual,
    verifyViberSignature: mocks.viber.verifyViberSignature,
    handleViberEvent:     mocks.viber.handleViberEvent,
  };
});

const { POST, GET } = await import('@/app/api/viber/webhook/route');

const ACTIVE_ACCOUNT = {
  id: 'v1', authToken: 'tok-secret', paName: 'AZ',
  isActive: true, isConnected: true,
};

function makeRequest(opts: {
  account?: string;
  body?: string;
  signature?: string;
}): NextRequest {
  const url = `https://crm.test/api/viber/webhook${opts.account !== undefined ? `?account=${opts.account}` : ''}`;
  return new NextRequest(url, {
    method:  'POST',
    headers: opts.signature !== undefined ? { 'x-viber-content-signature': opts.signature } : {},
    body:    opts.body ?? '{"event":"message"}',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.viber.verifyViberSignature.mockReturnValue(true);
  mocks.viber.handleViberEvent.mockResolvedValue({ ok: true });
});

describe('POST /api/viber/webhook', () => {
  it('без ?account -> 400', async () => {
    const r = await POST(makeRequest({ body: '{}', signature: 'x' }));
    expect(r.status).toBe(400);
    expect(mocks.db.viberAccount.findUnique).not.toHaveBeenCalled();
  });

  it('account не найден -> 404, signature не проверяется', async () => {
    mocks.db.viberAccount.findUnique.mockResolvedValue(null);
    const r = await POST(makeRequest({ account: 'missing', body: '{}', signature: 'x' }));
    expect(r.status).toBe(404);
    expect(mocks.viber.verifyViberSignature).not.toHaveBeenCalled();
  });

  it('account неактивен -> 404', async () => {
    mocks.db.viberAccount.findUnique.mockResolvedValue({ ...ACTIVE_ACCOUNT, isActive: false });
    const r = await POST(makeRequest({ account: 'v1', body: '{}', signature: 'x' }));
    expect(r.status).toBe(404);
  });

  it('плохая подпись -> 401, handleViberEvent НЕ вызван', async () => {
    mocks.db.viberAccount.findUnique.mockResolvedValue(ACTIVE_ACCOUNT);
    mocks.viber.verifyViberSignature.mockReturnValue(false);

    const r = await POST(makeRequest({ account: 'v1', body: '{}', signature: 'forged' }));
    expect(r.status).toBe(401);
    expect(mocks.viber.handleViberEvent).not.toHaveBeenCalled();
  });

  it('подпись проверяется на сыром body (с authToken аккаунта)', async () => {
    mocks.db.viberAccount.findUnique.mockResolvedValue(ACTIVE_ACCOUNT);
    const body = '{"event":"message","sender":{"id":"u"}}';

    await POST(makeRequest({ account: 'v1', body, signature: 'sig-x' }));

    expect(mocks.viber.verifyViberSignature).toHaveBeenCalledWith(
      'tok-secret',  // authToken из БД
      body,          // именно сырое тело, не парсенный JSON
      'sig-x',
    );
  });

  it('плохой JSON (после успешной подписи) -> 400', async () => {
    mocks.db.viberAccount.findUnique.mockResolvedValue(ACTIVE_ACCOUNT);
    const r = await POST(makeRequest({ account: 'v1', body: 'не json', signature: 's' }));
    expect(r.status).toBe(400);
    expect(mocks.viber.handleViberEvent).not.toHaveBeenCalled();
  });

  it('успех -> 200, handleViberEvent вызван с парсеным event', async () => {
    mocks.db.viberAccount.findUnique.mockResolvedValue(ACTIVE_ACCOUNT);
    mocks.viber.handleViberEvent.mockResolvedValue({ ok: true, threadId: 't1' });

    const event = { event: 'message', sender: { id: 'u1' }, message: { type: 'text', text: 'hi' } };
    const r = await POST(makeRequest({ account: 'v1', body: JSON.stringify(event), signature: 's' }));

    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.status).toBe(0);
    expect(json.threadId).toBe('t1');
    expect(mocks.viber.handleViberEvent).toHaveBeenCalledWith(ACTIVE_ACCOUNT, event);
  });

  it('handleViberEvent кинул -> 200 graceful (чтобы Viber не ретраил)', async () => {
    mocks.db.viberAccount.findUnique.mockResolvedValue(ACTIVE_ACCOUNT);
    mocks.viber.handleViberEvent.mockRejectedValue(new Error('БД упала'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const r = await POST(makeRequest({ account: 'v1', body: '{"event":"message"}', signature: 's' }));

    // Viber требует 200 за 8 сек — иначе ретраит. Мы логируем и отвечаем ok.
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.status_message).toBe('logged');

    errSpy.mockRestore();
  });

  it('конец-в-конец: реальная HMAC подпись проходит', async () => {
    // Снимаем мок чтобы проверить реальную verifyViberSignature
    const realModule = await vi.importActual<typeof import('@/lib/viber')>('@/lib/viber');
    mocks.viber.verifyViberSignature.mockImplementation(realModule.verifyViberSignature);
    mocks.db.viberAccount.findUnique.mockResolvedValue(ACTIVE_ACCOUNT);

    const body = '{"event":"message","sender":{"id":"u"}}';
    const realSig = crypto.createHmac('sha256', ACTIVE_ACCOUNT.authToken).update(body).digest('hex');

    const r = await POST(makeRequest({ account: 'v1', body, signature: realSig }));
    expect(r.status).toBe(200);
  });

  it('конец-в-конец: подделанная подпись (правильный body, чужой токен) -> 401', async () => {
    const realModule = await vi.importActual<typeof import('@/lib/viber')>('@/lib/viber');
    mocks.viber.verifyViberSignature.mockImplementation(realModule.verifyViberSignature);
    mocks.db.viberAccount.findUnique.mockResolvedValue(ACTIVE_ACCOUNT);

    const body = '{"event":"message"}';
    const wrongSig = crypto.createHmac('sha256', 'wrong-token').update(body).digest('hex');

    const r = await POST(makeRequest({ account: 'v1', body, signature: wrongSig }));
    expect(r.status).toBe(401);
    expect(mocks.viber.handleViberEvent).not.toHaveBeenCalled();
  });
});

describe('GET /api/viber/webhook', () => {
  it('возвращает 405 (Viber не дёргает GET)', async () => {
    const r = await GET();
    expect(r.status).toBe(405);
  });
});
