// Integration: API routes — google/auth (CSRF state cookie) + google/callback (OAuth)
import { describe, it, expect, vi, beforeEach } from 'vitest';

type AnyFn = ReturnType<typeof vi.fn>;

vi.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200, data, json: async () => data,
    }),
    redirect: (url: URL | string) => ({
      status: 302, url: url.toString(),
      headers: new Map([['location', url.toString()]]),
    }),
  },
}));

// next/headers — cookies() store через closure (избегаем `this` parameter внутри vi.fn).
// cookieSet принимает 3-й аргумент options — реальный код вызывает cookies.set(name, value, opts).
const _cookieMap = new Map<string, string>();
const cookieSet    = vi.fn((name: string, value: string, _opts?: unknown) => { _cookieMap.set(name, value); void _opts; });
const cookieDelete = vi.fn((name: string) => { _cookieMap.delete(name); });
const cookieStore = {
  get: (name: string) => {
    const value = _cookieMap.get(name);
    return value !== undefined ? { name, value } : undefined;
  },
  set:    cookieSet,
  delete: cookieDelete,
};
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => cookieStore),
}));

type CallbackRes = { status: number; url: string };
type AuthRes     = { status: number; url?: string; data?: { error: string } };

const mockDb = {
  user: { update: vi.fn() as AnyFn },
};
const mockRequireUser           = vi.fn(async () => ({ id: 'u-1', email: 'u@example.com', name: 'Ivan', role: 'SALES' }));
// auth() добавлен в /api/google/callback для проверки совпадения session.user.id со state.
const mockAuth                  = vi.fn(async () => ({ user: { id: 'u-1', email: 'u@example.com', name: 'Ivan', role: 'SALES' as const } }));
const mockBuildAuthUrl          = vi.fn(() => 'https://accounts.google.com/o/oauth2/auth?state=...');
const mockIsGoogleConfigured    = vi.fn(() => true);
const mockExchangeCodeForTokens = vi.fn();
// Crypto-моки. encrypt: (plaintext) => `enc:${plaintext}` — чтобы тесты могли
// различать шифрованное от plaintext, но при этом ассерты оставались читаемыми.
const mockEncrypt = vi.fn((s: string) => `enc:${s}`);
const mockEncryptNullable = vi.fn((s: string | null | undefined) =>
  s == null ? undefined : `enc:${s}`,
);

vi.mock('@/lib/db',     () => ({ db: mockDb }));
vi.mock('@/lib/auth',   () => ({
  auth:         mockAuth,
  requireUser:  mockRequireUser,
  requireAdmin: vi.fn(),
}));
vi.mock('@/lib/google', () => ({
  buildAuthUrl:           mockBuildAuthUrl,
  isGoogleConfigured:     mockIsGoogleConfigured,
  exchangeCodeForTokens:  mockExchangeCodeForTokens,
}));
vi.mock('@/lib/crypto', () => ({
  encrypt:          mockEncrypt,
  encryptNullable:  mockEncryptNullable,
  decrypt:          (s: string) => s,
  decryptNullable:  (s: string | null | undefined) => s ?? null,
}));

function makeReq(url: string) {
  const u = new URL(url);
  return {
    nextUrl: u,
    url:     u.toString(),
    headers: new Headers(),
  } as unknown as Request;
}

beforeEach(() => {
  _cookieMap.clear();
  cookieSet.mockClear();
  cookieDelete.mockClear();
  mockDb.user.update.mockReset();
  mockRequireUser.mockReset();
  mockRequireUser.mockImplementation(async () => ({ id: 'u-1', email: 'u@example.com', name: 'Ivan', role: 'SALES' }));
  mockAuth.mockReset();
  mockAuth.mockImplementation(async () => ({ user: { id: 'u-1', email: 'u@example.com', name: 'Ivan', role: 'SALES' as const } }));
  mockBuildAuthUrl.mockReset();
  mockBuildAuthUrl.mockReturnValue('https://accounts.google.com/o/oauth2/auth?state=...');
  mockIsGoogleConfigured.mockReset();
  mockIsGoogleConfigured.mockReturnValue(true);
  mockExchangeCodeForTokens.mockReset();
  mockEncrypt.mockClear();
  mockEncryptNullable.mockClear();
});

describe('GET /api/google/auth', () => {
  it('Google не настроен → 500 с понятным message', async () => {
    mockIsGoogleConfigured.mockReturnValue(false);
    const { GET } = await import('@/app/api/google/auth/route');
    const res = (await GET()) as AuthRes;
    expect(res.status).toBe(500);
    expect(res.data?.error).toMatch(/GOOGLE_CLIENT_ID/);
  });
  it('успех → выставляет cookie state и редирект', async () => {
    const { GET } = await import('@/app/api/google/auth/route');
    const res = (await GET()) as AuthRes;
    expect(res.status).toBe(302);
    expect(cookieSet).toHaveBeenCalledWith(
      'google_oauth_state',
      expect.stringMatching(/^u-1:[a-f0-9]+$/),
      expect.objectContaining({
        httpOnly: true, sameSite: 'lax', maxAge: 600, path: '/',
      }),
    );
  });
  it('cookie maxAge=600 (10 мин) и path=/', async () => {
    const { GET } = await import('@/app/api/google/auth/route');
    await GET();
    const setCall = cookieSet.mock.calls[0]!;
    expect(setCall[2]).toMatchObject({ maxAge: 600, path: '/' });
  });
  it('buildAuthUrl вызывается с тем же state что в cookie', async () => {
    const { GET } = await import('@/app/api/google/auth/route');
    await GET();
    const cookieState = cookieSet.mock.calls[0]![1];
    expect(mockBuildAuthUrl).toHaveBeenCalledWith(cookieState);
  });
});

describe('GET /api/google/callback', () => {
  it('Google ответил error= → redirect ?google=error', async () => {
    const { GET } = await import('@/app/api/google/callback/route');
    const res = (await GET(makeReq('http://localhost/api/google/callback?error=access_denied') as never)) as CallbackRes;
    expect(res.status).toBe(302);
    expect(res.url).toContain('google=error');
  });
  it('нет code → redirect ?google=missing', async () => {
    const { GET } = await import('@/app/api/google/callback/route');
    const res = (await GET(makeReq('http://localhost/api/google/callback?state=u-1:abc') as never)) as CallbackRes;
    expect(res.url).toContain('google=missing');
  });
  it('нет state → redirect ?google=missing', async () => {
    const { GET } = await import('@/app/api/google/callback/route');
    const res = (await GET(makeReq('http://localhost/api/google/callback?code=AUTH_CODE') as never)) as CallbackRes;
    expect(res.url).toContain('google=missing');
  });
  it('CSRF: state в запросе НЕ совпадает с cookie → redirect ?google=csrf', async () => {
    _cookieMap.set('google_oauth_state', 'u-1:nonce-A');
    const { GET } = await import('@/app/api/google/callback/route');
    const res = (await GET(makeReq('http://localhost/api/google/callback?code=X&state=u-evil:nonce-B') as never)) as CallbackRes;
    expect(res.url).toContain('google=csrf');
    expect(mockExchangeCodeForTokens).not.toHaveBeenCalled();
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });
  it('CSRF: cookie отсутствует → redirect ?google=csrf', async () => {
    const { GET } = await import('@/app/api/google/callback/route');
    const res = (await GET(makeReq('http://localhost/api/google/callback?code=X&state=u-1:abc') as never)) as CallbackRes;
    expect(res.url).toContain('google=csrf');
  });
  it('успех: токены приходят → user.update с ЗАШИФРОВАННЫМИ токенами и redirect ?google=connected', async () => {
    _cookieMap.set('google_oauth_state', 'u-1:nonce-1');
    mockExchangeCodeForTokens.mockResolvedValue({
      access_token:  'AT-abc',
      refresh_token: 'RT-xyz',
      expires_in:    3600,
    });
    const { GET } = await import('@/app/api/google/callback/route');
    const res = (await GET(makeReq('http://localhost/api/google/callback?code=AUTH&state=u-1:nonce-1') as never)) as CallbackRes;
    expect(res.url).toContain('google=connected');
    // Токены сохраняются в БД ЗАШИФРОВАННЫМИ — мок encrypt оборачивает их в 'enc:'
    expect(mockEncrypt).toHaveBeenCalledWith('AT-abc');
    expect(mockEncryptNullable).toHaveBeenCalledWith('RT-xyz');
    expect(mockDb.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u-1' },
        data: expect.objectContaining({
          googleAccessToken:  'enc:AT-abc',
          googleRefreshToken: 'enc:RT-xyz',
          googleCalendarId:   'primary',
          googleAccessTokenExpiresAt: expect.any(Date),
        }),
      }),
    );
    expect(cookieDelete).toHaveBeenCalledWith('google_oauth_state');
  });
  it('успех без refresh_token → encryptNullable(undefined) = undefined, не перезатирается', async () => {
    _cookieMap.set('google_oauth_state', 'u-1:nonce-1');
    mockExchangeCodeForTokens.mockResolvedValue({
      access_token: 'AT-only', expires_in: 3600,
    });
    const { GET } = await import('@/app/api/google/callback/route');
    await GET(makeReq('http://localhost/api/google/callback?code=X&state=u-1:nonce-1') as never);
    const updateCall = mockDb.user.update.mock.calls[0]![0];
    expect(updateCall.data.googleRefreshToken).toBeUndefined();
    expect(updateCall.data.googleAccessToken).toBe('enc:AT-only');
  });
  it('exchangeCodeForTokens бросил исключение → redirect ?google=failed', async () => {
    _cookieMap.set('google_oauth_state', 'u-1:nonce-1');
    mockExchangeCodeForTokens.mockRejectedValue(new Error('Network'));
    const { GET } = await import('@/app/api/google/callback/route');
    const res = (await GET(makeReq('http://localhost/api/google/callback?code=X&state=u-1:nonce-1') as never)) as CallbackRes;
    expect(res.url).toContain('google=failed');
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });
  it('userId в user.update — берётся из state ДО двоеточия', async () => {
    _cookieMap.set('google_oauth_state', 'u-real-id:long-random-nonce-with-dashes');
    mockAuth.mockImplementation(async () => ({ user: { id: 'u-real-id', email: 'r@example.com', name: 'R', role: 'SALES' as const } }));
    mockExchangeCodeForTokens.mockResolvedValue({
      access_token: 'AT', refresh_token: 'RT', expires_in: 3600,
    });
    const { GET } = await import('@/app/api/google/callback/route');
    await GET(makeReq('http://localhost/api/google/callback?code=X&state=u-real-id:long-random-nonce-with-dashes') as never);
    expect(mockDb.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u-real-id' } }),
    );
  });

  it('session-check: state.userId НЕ совпадает с session.user.id → redirect ?google=session', async () => {
    // Защита от подсунутой через XSS state-cookie: атакующий мог инициировать
    // OAuth-flow от своего юзера (state=u-attacker:nonce), и при возврате
    // в callback на сессию жертвы — без этой проверки токены атакующего
    // привязались бы к юзеру жертвы.
    _cookieMap.set('google_oauth_state', 'u-attacker:nonce');
    mockAuth.mockImplementation(async () => ({ user: { id: 'u-victim', email: 'v@example.com', name: 'V', role: 'SALES' as const } }));
    const { GET } = await import('@/app/api/google/callback/route');
    const res = (await GET(makeReq('http://localhost/api/google/callback?code=X&state=u-attacker:nonce') as never)) as CallbackRes;
    expect(res.url).toContain('google=session');
    expect(mockExchangeCodeForTokens).not.toHaveBeenCalled();
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });
});
