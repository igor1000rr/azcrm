// Integration: API routes — notifications + push + chat-templates + blueprints.
// Общий мок NextResponse — объект с status + json().
// Не используем реальный next/server runtime — он тяжёлый и не нужен для unit-проверки.
import { describe, it, expect, vi, beforeEach } from 'vitest';

type AnyFn = ReturnType<typeof vi.fn>;

interface MockResponse { status: number; data: unknown; json: () => Promise<unknown>; }
function mockJson(data: unknown, init?: { status?: number }): MockResponse {
  return { status: init?.status ?? 200, data, json: async () => data };
}

vi.mock('next/server', () => ({
  NextResponse: {
    json: mockJson,
    redirect: (url: URL | string) => ({
      status: 302, url: url.toString(),
      headers: new Map([['location', url.toString()]]),
    }),
  },
}));

const mockDb = {
  notification: { findMany: vi.fn() as AnyFn, count: vi.fn() as AnyFn, updateMany: vi.fn() as AnyFn },
  pushSubscription:    { upsert: vi.fn() as AnyFn, deleteMany: vi.fn() as AnyFn },
  chatTemplate:        { findMany: vi.fn() as AnyFn, findUnique: vi.fn() as AnyFn },
  chatThread:          { findFirst: vi.fn() as AnyFn },
  documentBlueprint:   { findMany: vi.fn() as AnyFn },
};
const mockRequireUser = vi.fn(async () => ({ id: 'u-1', email: 'u@a', name: 'Ivan', role: 'SALES' }));
const mockGetVapidPublicKey = vi.fn(() => 'BPUBLICKEY123');

vi.mock('@/lib/db',   () => ({ db: mockDb }));
vi.mock('@/lib/auth', () => ({
  requireUser: mockRequireUser,
  requireAdmin: vi.fn(async () => ({ id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN' })),
}));
vi.mock('@/lib/push', () => ({ getVapidPublicKey: mockGetVapidPublicKey }));
vi.mock('@/lib/permissions', () => ({
  whatsappAccountFilter: vi.fn(() => ({})),
}));
vi.mock('@/lib/utils', async () => ({
  ...(await vi.importActual<object>('@/lib/utils')),
}));

beforeEach(() => {
  Object.values(mockDb).forEach((entity) => Object.values(entity).forEach((fn) => (fn as AnyFn).mockReset()));
  mockRequireUser.mockReset();
  mockRequireUser.mockImplementation(async () => ({ id: 'u-1', email: 'u@a', name: 'Ivan', role: 'SALES' }));
  mockGetVapidPublicKey.mockReset();
  mockGetVapidPublicKey.mockReturnValue('BPUBLICKEY123');
});

function makeReq(opts: {
  url?: string;
  body?: unknown;
  headers?: Record<string, string>;
} = {}) {
  return {
    nextUrl: new URL(opts.url ?? 'http://localhost/api/x'),
    headers: new Headers(opts.headers ?? {}),
    json:    async () => opts.body ?? {},
  } as unknown as Request;
}

describe('GET /api/notifications/list', () => {
  it('возвращает items + unreadCount', async () => {
    mockDb.notification.findMany.mockResolvedValue([
      { id: 'n-1', kind: 'NEW_MESSAGE', title: 'X', body: null, link: null, isRead: false, createdAt: new Date('2026-04-01') },
      { id: 'n-2', kind: 'TASK_ASSIGNED', title: 'Y', body: 'Z', link: '/tasks', isRead: true, createdAt: new Date('2026-03-30') },
    ]);
    mockDb.notification.count.mockResolvedValue(1);

    const { GET } = await import('@/app/api/notifications/list/route');
    const res = await GET() as MockResponse;
    expect(res.status).toBe(200);
    const data = await res.json() as { items: unknown[]; unreadCount: number };
    expect(data.items).toHaveLength(2);
    expect(data.unreadCount).toBe(1);
    // фильтр по userId
    expect(mockDb.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u-1' }, take: 30 }),
    );
  });
  it('неавторизованный → ошибка', async () => {
    mockRequireUser.mockImplementation(async () => {
      const e = new Error('Unauthorized') as Error & { statusCode?: number };
      e.statusCode = 401; throw e;
    });
    const { GET } = await import('@/app/api/notifications/list/route');
    const res = await GET() as MockResponse;
    expect(res.status).toBe(401);
  });
});

describe('POST /api/notifications/read-all', () => {
  it('updateMany isRead=true для userId', async () => {
    const { POST } = await import('@/app/api/notifications/read-all/route');
    const res = await POST() as MockResponse;
    expect(res.status).toBe(200);
    expect(mockDb.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u-1', isRead: false },
      data:  { isRead: true },
    });
  });
});

describe('GET /api/push/vapid', () => {
  it('ключ есть → 200', async () => {
    const { GET } = await import('@/app/api/push/vapid/route');
    const res = await GET() as MockResponse;
    expect(res.status).toBe(200);
    expect((res.data as { key: string }).key).toBe('BPUBLICKEY123');
  });
  it('push не настроен → 503', async () => {
    mockGetVapidPublicKey.mockReturnValue(null as never);
    const { GET } = await import('@/app/api/push/vapid/route');
    const res = await GET() as MockResponse;
    expect(res.status).toBe(503);
  });
});

describe('POST /api/push/subscribe', () => {
  it('валидная подписка → upsert', async () => {
    const { POST } = await import('@/app/api/push/subscribe/route');
    const req = makeReq({
      body: { endpoint: 'https://fcm.example/abc', keys: { p256dh: 'PK', auth: 'AK' } },
      headers: { 'user-agent': 'Mozilla/Test' },
    });
    const res = await POST(req as never) as MockResponse;
    expect(res.status).toBe(200);
    expect(mockDb.pushSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { endpoint: 'https://fcm.example/abc' },
        create: expect.objectContaining({
          userId: 'u-1', endpoint: 'https://fcm.example/abc', p256dh: 'PK', authKey: 'AK',
          userAgent: 'Mozilla/Test',
        }),
      }),
    );
  });
  it('нет endpoint → 400', async () => {
    const { POST } = await import('@/app/api/push/subscribe/route');
    const req = makeReq({ body: { keys: { p256dh: 'X', auth: 'Y' } } });
    const res = await POST(req as never) as MockResponse;
    expect(res.status).toBe(400);
    expect(mockDb.pushSubscription.upsert).not.toHaveBeenCalled();
  });
  it('нет keys.p256dh → 400', async () => {
    const { POST } = await import('@/app/api/push/subscribe/route');
    const req = makeReq({ body: { endpoint: 'X', keys: { auth: 'Y' } } });
    const res = await POST(req as never) as MockResponse;
    expect(res.status).toBe(400);
  });
});

describe('POST /api/push/unsubscribe', () => {
  it('deleteMany по endpoint+userId', async () => {
    const { POST } = await import('@/app/api/push/unsubscribe/route');
    const req = makeReq({ body: { endpoint: 'https://fcm.example/abc' } });
    const res = await POST(req as never) as MockResponse;
    expect(res.status).toBe(200);
    expect(mockDb.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { endpoint: 'https://fcm.example/abc', userId: 'u-1' },
    });
  });
  it('нет endpoint → 400', async () => {
    const { POST } = await import('@/app/api/push/unsubscribe/route');
    const req = makeReq({ body: {} });
    const res = await POST(req as never) as MockResponse;
    expect(res.status).toBe(400);
  });
});

describe('GET /api/chat-templates', () => {
  it('возвращает только isActive=true', async () => {
    mockDb.chatTemplate.findMany.mockResolvedValue([
      { id: 't-1', name: 'X', body: 'Y', category: 'A' },
    ]);
    const { GET } = await import('@/app/api/chat-templates/route');
    const res = await GET() as MockResponse;
    expect(res.status).toBe(200);
    expect(mockDb.chatTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
  });
});

describe('POST /api/chat-templates/render', () => {
  it('templateId отсутствует → 400', async () => {
    const { POST } = await import('@/app/api/chat-templates/render/route');
    const res = await POST(makeReq({ body: { threadId: 'th-1' } }) as never) as MockResponse;
    expect(res.status).toBe(400);
  });
  it('шаблон не найден → 404', async () => {
    mockDb.chatTemplate.findUnique.mockResolvedValue(null);
    const { POST } = await import('@/app/api/chat-templates/render/route');
    const res = await POST(
      makeReq({ body: { templateId: 't-x', threadId: 'th-1' } }) as never,
    ) as MockResponse;
    expect(res.status).toBe(404);
  });
  it('тред не найден/нет доступа → 404', async () => {
    mockDb.chatTemplate.findUnique.mockResolvedValue({ body: 'Hi {client.fullName}' });
    mockDb.chatThread.findFirst.mockResolvedValue(null);
    const { POST } = await import('@/app/api/chat-templates/render/route');
    const res = await POST(
      makeReq({ body: { templateId: 't-1', threadId: 'th-x' } }) as never,
    ) as MockResponse;
    expect(res.status).toBe(404);
  });
  it('подстановка {client.fullName} + {user.name}', async () => {
    mockDb.chatTemplate.findUnique.mockResolvedValue({
      body: 'Здравствуйте {client.fullName}! С вами {user.name}.',
    });
    mockDb.chatThread.findFirst.mockResolvedValue({
      id: 'th-1', externalUserName: null, externalPhoneNumber: '+48999',
      client: { fullName: 'Пётр', phone: '+48999', email: 'p@x.y' },
      lead:   null,
    });
    const { POST } = await import('@/app/api/chat-templates/render/route');
    const res = await POST(
      makeReq({ body: { templateId: 't-1', threadId: 'th-1' } }) as never,
    ) as MockResponse;
    expect(res.status).toBe(200);
    const data = await res.json() as { body: string };
    expect(data.body).toBe('Здравствуйте Пётр! С вами Ivan.');
  });
  it('неизвестный плейсхолдер — остаётся как есть', async () => {
    mockDb.chatTemplate.findUnique.mockResolvedValue({ body: 'Hi {something.weird}' });
    mockDb.chatThread.findFirst.mockResolvedValue({
      id: 'th-1', externalUserName: null, externalPhoneNumber: null,
      client: { fullName: 'X', phone: '+48', email: '' }, lead: null,
    });
    const { POST } = await import('@/app/api/chat-templates/render/route');
    const res = await POST(
      makeReq({ body: { templateId: 't-1', threadId: 'th-1' } }) as never,
    ) as MockResponse;
    const data = await res.json() as { body: string };
    expect(data.body).toBe('Hi {something.weird}'); // плейсхолдер не разрешён — остался
  });
  it('расчёт lead.debt = totalAmount - sum(payments)', async () => {
    mockDb.chatTemplate.findUnique.mockResolvedValue({ body: 'Долг: {lead.debt}' });
    mockDb.chatThread.findFirst.mockResolvedValue({
      id: 'th-1', externalUserName: null, externalPhoneNumber: null,
      client: { fullName: 'X', phone: '+48', email: '' },
      lead: {
        totalAmount: 1000,
        payments: [{ amount: 300 }, { amount: 200 }],
      },
    });
    const { POST } = await import('@/app/api/chat-templates/render/route');
    const res = await POST(
      makeReq({ body: { templateId: 't-1', threadId: 'th-1' } }) as never,
    ) as MockResponse;
    const data = await res.json() as { body: string };
    // formatMoney(500) — проверяем что вывелась цифра 500 (без точного формата)
    expect(data.body).toMatch(/500/);
  });
});

describe('GET /api/blueprints', () => {
  it('возвращает список активных шаблонов', async () => {
    mockDb.documentBlueprint.findMany.mockResolvedValue([
      { id: 'b-1', name: 'Договор', description: '...', format: 'docx', placeholders: [] },
    ]);
    const { GET } = await import('@/app/api/blueprints/route');
    const res = await GET() as MockResponse;
    expect(res.status).toBe(200);
    expect(mockDb.documentBlueprint.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true }, orderBy: { name: 'asc' } }),
    );
  });
  it('неавторизованный → ошибка с её status', async () => {
    mockRequireUser.mockImplementation(async () => {
      const e = new Error('Unauthorized') as Error & { statusCode?: number };
      e.statusCode = 401; throw e;
    });
    const { GET } = await import('@/app/api/blueprints/route');
    const res = await GET() as MockResponse;
    expect(res.status).toBe(401);
  });
});
