// Integration: GET + POST /api/messenger/webhook
// Покрывает FB Verify Flow (GET с hub.challenge echo) и Event Flow (POST
// с проверкой подписи X-Hub-Signature-256 от App Secret).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'crypto';

const mocks = vi.hoisted(() => ({
  db: {
    metaAccount: {
      findUnique: vi.fn(),
    },
  },
  meta: {
    verifyMetaSignature: vi.fn(),
    handleMetaWebhook:   vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({ db: mocks.db }));

vi.mock('@/lib/meta', async () => {
  const actual = await vi.importActual<typeof import('@/lib/meta')>('@/lib/meta');
  return {
    ...actual,
    verifyMetaSignature: mocks.meta.verifyMetaSignature,
    handleMetaWebhook:   mocks.meta.handleMetaWebhook,
  };
});

const { GET, POST } = await import('@/app/api/messenger/webhook/route');

const ACCOUNT = {
  id: 'm1', pageId: 'page-1', appSecret: 'secret-x',
  verifyToken: 'my-verify-token', isActive: true,
};

function getReq(params: Record<string, string>): NextRequest {
  const qs = new URLSearchParams(params).toString();
  return new NextRequest(`https://crm.test/api/messenger/webhook?${qs}`, { method: 'GET' });
}

function postReq(opts: { account?: string; body?: string; signature?: string | null }): NextRequest {
  const url = `https://crm.test/api/messenger/webhook${opts.account !== undefined ? `?account=${opts.account}` : ''}`;
  const headers: Record<string, string> = {};
  if (opts.signature !== null && opts.signature !== undefined) {
    headers['x-hub-signature-256'] = opts.signature;
  }
  return new NextRequest(url, {
    method:  'POST',
    headers,
    body:    opts.body ?? '{"object":"page","entry":[]}',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.meta.verifyMetaSignature.mockReturnValue(true);
  mocks.meta.handleMetaWebhook.mockResolvedValue({ processed: 0, skipped: 0 });
});

// ============ GET — Verify flow ============

describe('GET /api/messenger/webhook (FB verify)', () => {
  it('правильный verify_token + hub.challenge -> 200 echo plain text', async () => {
    mocks.db.metaAccount.findUnique.mockResolvedValue(ACCOUNT);

    const r = await GET(getReq({
      account:            'm1',
      'hub.mode':         'subscribe',
      'hub.verify_token': 'my-verify-token',
      'hub.challenge':    'random-challenge-123',
    }));

    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toContain('text/plain');
    expect(await r.text()).toBe('random-challenge-123');
  });

  it('неправильный verify_token -> 403', async () => {
    mocks.db.metaAccount.findUnique.mockResolvedValue(ACCOUNT);

    const r = await GET(getReq({
      account:            'm1',
      'hub.mode':         'subscribe',
      'hub.verify_token': 'WRONG-token',
      'hub.challenge':    'x',
    }));

    expect(r.status).toBe(403);
  });

  it('hub.mode != subscribe -> 403', async () => {
    mocks.db.metaAccount.findUnique.mockResolvedValue(ACCOUNT);

    const r = await GET(getReq({
      account:            'm1',
      'hub.mode':         'unsubscribe',
      'hub.verify_token': 'my-verify-token',
      'hub.challenge':    'x',
    }));

    expect(r.status).toBe(403);
  });

  it('без challenge -> 403', async () => {
    mocks.db.metaAccount.findUnique.mockResolvedValue(ACCOUNT);

    const r = await GET(getReq({
      account:            'm1',
      'hub.mode':         'subscribe',
      'hub.verify_token': 'my-verify-token',
    }));

    expect(r.status).toBe(403);
  });

  it('без account -> 400', async () => {
    const r = await GET(getReq({
      'hub.mode':         'subscribe',
      'hub.verify_token': 't',
      'hub.challenge':    'c',
    }));
    expect(r.status).toBe(400);
    expect(mocks.db.metaAccount.findUnique).not.toHaveBeenCalled();
  });

  it('account не существует -> 404', async () => {
    mocks.db.metaAccount.findUnique.mockResolvedValue(null);

    const r = await GET(getReq({
      account:            'unknown',
      'hub.mode':         'subscribe',
      'hub.verify_token': 't',
      'hub.challenge':    'c',
    }));
    expect(r.status).toBe(404);
  });
});

// ============ POST — Event flow ============

describe('POST /api/messenger/webhook (events)', () => {
  it('без account -> 400', async () => {
    const r = await POST(postReq({}));
    expect(r.status).toBe(400);
    expect(mocks.db.metaAccount.findUnique).not.toHaveBeenCalled();
  });

  it('account не найден -> 404, signature НЕ проверяется', async () => {
    mocks.db.metaAccount.findUnique.mockResolvedValue(null);
    const r = await POST(postReq({ account: 'missing' }));
    expect(r.status).toBe(404);
    expect(mocks.meta.verifyMetaSignature).not.toHaveBeenCalled();
  });

  it('account неактивен -> 404', async () => {
    mocks.db.metaAccount.findUnique.mockResolvedValue({ ...ACCOUNT, isActive: false });
    const r = await POST(postReq({ account: 'm1' }));
    expect(r.status).toBe(404);
  });

  it('плохая подпись -> 401, handleMetaWebhook НЕ вызван', async () => {
    mocks.db.metaAccount.findUnique.mockResolvedValue(ACCOUNT);
    mocks.meta.verifyMetaSignature.mockReturnValue(false);

    const r = await POST(postReq({ account: 'm1', signature: 'sha256=forged' }));
    expect(r.status).toBe(401);
    expect(mocks.meta.handleMetaWebhook).not.toHaveBeenCalled();
  });

  it('подпись проверяется с App Secret из БД на сыром body', async () => {
    mocks.db.metaAccount.findUnique.mockResolvedValue(ACCOUNT);
    const body = '{"object":"page","entry":[{"id":"p"}]}';

    await POST(postReq({ account: 'm1', body, signature: 'sha256=test' }));

    expect(mocks.meta.verifyMetaSignature).toHaveBeenCalledWith(
      'secret-x',          // appSecret из БД (не из ENV или хардкода!)
      body,                // raw body
      'sha256=test',
    );
  });

  it('плохой JSON (после успешной подписи) -> 400', async () => {
    mocks.db.metaAccount.findUnique.mockResolvedValue(ACCOUNT);

    const r = await POST(postReq({ account: 'm1', body: 'не json', signature: 'sha256=x' }));
    expect(r.status).toBe(400);
    expect(mocks.meta.handleMetaWebhook).not.toHaveBeenCalled();
  });

  it('успех -> 200 + результат handleMetaWebhook', async () => {
    mocks.db.metaAccount.findUnique.mockResolvedValue(ACCOUNT);
    mocks.meta.handleMetaWebhook.mockResolvedValue({ processed: 3, skipped: 1 });

    const payload = { object: 'page', entry: [{ id: 'page-1', messaging: [] }] };
    const r = await POST(postReq({
      account: 'm1', body: JSON.stringify(payload), signature: 'sha256=x',
    }));

    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.processed).toBe(3);
    expect(json.skipped).toBe(1);
    expect(mocks.meta.handleMetaWebhook).toHaveBeenCalledWith(payload);
  });

  it('handleMetaWebhook кинул -> 200 graceful (чтобы FB не ретраил)', async () => {
    mocks.db.metaAccount.findUnique.mockResolvedValue(ACCOUNT);
    mocks.meta.handleMetaWebhook.mockRejectedValue(new Error('DB exploded'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const r = await POST(postReq({ account: 'm1', signature: 'sha256=x' }));

    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.logged).toBe(true);

    errSpy.mockRestore();
  });

  it('конец-в-конец: реальная HMAC от App Secret проходит', async () => {
    const realModule = await vi.importActual<typeof import('@/lib/meta')>('@/lib/meta');
    mocks.meta.verifyMetaSignature.mockImplementation(realModule.verifyMetaSignature);
    mocks.db.metaAccount.findUnique.mockResolvedValue(ACCOUNT);

    const body = '{"object":"page","entry":[]}';
    const realSig = 'sha256=' + crypto.createHmac('sha256', ACCOUNT.appSecret).update(body).digest('hex');

    const r = await POST(postReq({ account: 'm1', body, signature: realSig }));
    expect(r.status).toBe(200);
  });

  it('конец-в-конец: подделанная подпись (чужой App Secret) -> 401', async () => {
    const realModule = await vi.importActual<typeof import('@/lib/meta')>('@/lib/meta');
    mocks.meta.verifyMetaSignature.mockImplementation(realModule.verifyMetaSignature);
    mocks.db.metaAccount.findUnique.mockResolvedValue(ACCOUNT);

    const body = '{"object":"page","entry":[]}';
    const fakeSig = 'sha256=' + crypto.createHmac('sha256', 'wrong-secret').update(body).digest('hex');

    const r = await POST(postReq({ account: 'm1', body, signature: fakeSig }));
    expect(r.status).toBe(401);
    expect(mocks.meta.handleMetaWebhook).not.toHaveBeenCalled();
  });
});
