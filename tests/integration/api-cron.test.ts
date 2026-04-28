// Integration: cron routes — reminders, sync-calendar, sync-calls.
// Все 3 эндпоинта используют checkCronAuth из @/lib/cron-auth (уже unit-покрыт).
import { describe, it, expect, vi, beforeEach } from 'vitest';

type AnyFn = ReturnType<typeof vi.fn>;

interface MockResponse { status: number; data: unknown; json: () => Promise<unknown>; }
function mockJson(data: unknown, init?: { status?: number }): MockResponse {
  return { status: init?.status ?? 200, data, json: async () => data };
}

vi.mock('next/server', () => ({
  NextResponse: { json: mockJson },
}));

const mockDb = {
  calendarEvent:    {
    findMany: vi.fn() as AnyFn, update: vi.fn() as AnyFn, create: vi.fn() as AnyFn, delete: vi.fn() as AnyFn,
  },
  user:             { findMany: vi.fn() as AnyFn },
  call:             { findUnique: vi.fn() as AnyFn, create: vi.fn() as AnyFn },
  client:           { findUnique: vi.fn() as AnyFn },
  leadEvent:        { create: vi.fn() as AnyFn },
};
const mockCheckCronAuth     = vi.fn();
const mockWorkerSendMessage = vi.fn() as AnyFn;
const mockListGoogleEvents  = vi.fn() as AnyFn;
const mockNotify            = vi.fn();

// Telephony provider — фабрика возвращает объект.
// vi.fn() без типизации, вызовы mockResolvedValue/mockReturnValue работают через AnyFn.
const mockTelephonyProvider = {
  isConfigured:    vi.fn() as AnyFn,
  fetchCalls:      vi.fn() as AnyFn,
  downloadRecord:  vi.fn() as AnyFn,
};
const mockGetTelephonyProvider = vi.fn(() => mockTelephonyProvider);

vi.mock('@/lib/db',           () => ({ db: mockDb }));
vi.mock('@/lib/cron-auth',    () => ({ checkCronAuth: mockCheckCronAuth }));
vi.mock('@/lib/whatsapp',     () => ({ workerSendMessage: mockWorkerSendMessage }));
vi.mock('@/lib/google',       () => ({ listGoogleEvents: mockListGoogleEvents }));
vi.mock('@/lib/telephony',    () => ({ getTelephonyProvider: mockGetTelephonyProvider }));
vi.mock('@/lib/notify',       () => ({ notify: mockNotify }));
vi.mock('@/lib/storage',      () => ({
  saveBuffer:           vi.fn(async () => ({ url: '/x', size: 100 })),
  sanitizeDownloadName: (s: string) => s.replace(/[^\w.-]/g, '_'),
}));
vi.mock('@/lib/utils', async () => await vi.importActual('@/lib/utils'));

function makeReq(headers: Record<string, string> = {}) {
  return {
    nextUrl: new URL('http://localhost/api/cron/x'),
    headers: new Headers(headers),
  } as unknown as Request;
}

// Хелпер для type-safe приведения возврата route handlers к нашему MockResponse.
// Реальный возврат — Promise<NextResponse<unknown>>; mock в next/server даёт MockResponse.
// TS не видит этой связи, поэтому через unknown.
function asMockRes(v: unknown): MockResponse {
  return v as MockResponse;
}

beforeEach(() => {
  Object.values(mockDb).forEach((entity) => Object.values(entity).forEach((fn) => (fn as AnyFn).mockReset()));
  mockCheckCronAuth.mockReset();
  mockWorkerSendMessage.mockReset();
  mockWorkerSendMessage.mockResolvedValue({ ok: true });
  mockListGoogleEvents.mockReset();
  mockListGoogleEvents.mockResolvedValue([]);
  mockNotify.mockReset();
  mockTelephonyProvider.isConfigured.mockReset();
  mockTelephonyProvider.isConfigured.mockReturnValue(true);
  mockTelephonyProvider.fetchCalls.mockReset();
  mockTelephonyProvider.fetchCalls.mockResolvedValue([]);
  mockTelephonyProvider.downloadRecord.mockReset();
  mockTelephonyProvider.downloadRecord.mockResolvedValue(null);
});

describe('POST /api/cron/reminders', () => {
  it('checkCronAuth вернул 401 → выходим без работы', async () => {
    mockCheckCronAuth.mockReturnValue({ status: 401, json: async () => ({ error: 'unauthorized' }) });
    const { POST } = await import('@/app/api/cron/reminders/route');
    const res = asMockRes(await POST(makeReq() as never));
    expect(res.status).toBe(401);
    expect(mockDb.calendarEvent.findMany).not.toHaveBeenCalled();
  });
  it('авторизация OK + нет событий → sent7d=0, sent1d=0', async () => {
    mockCheckCronAuth.mockReturnValue(null);
    mockDb.calendarEvent.findMany.mockResolvedValue([]);
    const { POST } = await import('@/app/api/cron/reminders/route');
    const res = asMockRes(await POST(makeReq() as never));
    expect(res.status).toBe(200);
    expect(mockWorkerSendMessage).not.toHaveBeenCalled();
  });
  it('событие без isConnected whatsappAccount → скипается', async () => {
    mockCheckCronAuth.mockReturnValue(null);
    const inSevenDays = new Date(Date.now() + 7 * 86400_000);
    mockDb.calendarEvent.findMany.mockResolvedValueOnce([
      {
        id: 'ev-1', startsAt: inSevenDays, location: 'Офис',
        lead: {
          client: { fullName: 'Иван', phone: '+48999' },
          whatsappAccount: { id: 'wa-1', isConnected: false },
        },
      },
    ]).mockResolvedValueOnce([]);
    const { POST } = await import('@/app/api/cron/reminders/route');
    await POST(makeReq() as never);
    expect(mockWorkerSendMessage).not.toHaveBeenCalled();
  });
  it('событие с подключённым аккаунтом → send + reminderSent7d=true', async () => {
    mockCheckCronAuth.mockReturnValue(null);
    const inSevenDays = new Date(Date.now() + 7 * 86400_000);
    mockDb.calendarEvent.findMany.mockResolvedValueOnce([
      {
        id: 'ev-1', startsAt: inSevenDays, location: 'Офис',
        lead: {
          client: { fullName: 'Иван', phone: '+48999' },
          whatsappAccount: { id: 'wa-1', isConnected: true },
        },
      },
    ]).mockResolvedValueOnce([]);
    const { POST } = await import('@/app/api/cron/reminders/route');
    await POST(makeReq() as never);
    expect(mockWorkerSendMessage).toHaveBeenCalledWith('wa-1', '+48999', expect.any(String));
    expect(mockDb.calendarEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ev-1' }, data: { reminderSent7d: true } }),
    );
  });
});

describe('POST /api/cron/sync-calendar', () => {
  it('checkCronAuth вернул 401 → выходим', async () => {
    mockCheckCronAuth.mockReturnValue({ status: 401, json: async () => ({}) });
    const { POST } = await import('@/app/api/cron/sync-calendar/route');
    const res = asMockRes(await POST(makeReq() as never));
    expect(res.status).toBe(401);
    expect(mockListGoogleEvents).not.toHaveBeenCalled();
  });
  it('нет юзеров с Google → listGoogleEvents не вызывается', async () => {
    mockCheckCronAuth.mockReturnValue(null);
    mockDb.user.findMany.mockResolvedValue([]);
    const { POST } = await import('@/app/api/cron/sync-calendar/route');
    const res = asMockRes(await POST(makeReq() as never));
    expect(res.status).toBe(200);
    expect((res.data as { added: number }).added).toBe(0);
    expect(mockListGoogleEvents).not.toHaveBeenCalled();
  });
  it('юзер есть, Google вернул 1 новое событие → calendarEvent.create', async () => {
    mockCheckCronAuth.mockReturnValue(null);
    mockDb.user.findMany.mockResolvedValue([{ id: 'u-1', name: 'Anna' }]);
    mockListGoogleEvents.mockResolvedValue([
      {
        id: 'gid-1', summary: 'Встреча', location: 'Office', status: 'confirmed',
        start: { dateTime: '2026-05-01T10:00:00Z' },
        end:   { dateTime: '2026-05-01T11:00:00Z' },
      },
    ]);
    mockDb.calendarEvent.findMany.mockResolvedValue([]);
    const { POST } = await import('@/app/api/cron/sync-calendar/route');
    const res = asMockRes(await POST(makeReq() as never));
    expect(res.status).toBe(200);
    expect((res.data as { added: number }).added).toBe(1);
    expect(mockDb.calendarEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerId: 'u-1', kind: 'CUSTOM', googleId: 'gid-1', title: 'Встреча',
        }),
      }),
    );
  });
  it('cancelled событие из Google → пропускается', async () => {
    mockCheckCronAuth.mockReturnValue(null);
    mockDb.user.findMany.mockResolvedValue([{ id: 'u-1', name: 'A' }]);
    mockListGoogleEvents.mockResolvedValue([
      { id: 'gid-x', status: 'cancelled', start: { dateTime: '2026-05-01T10:00:00Z' }, end: { dateTime: '2026-05-01T11:00:00Z' } },
    ]);
    mockDb.calendarEvent.findMany.mockResolvedValue([]);
    const { POST } = await import('@/app/api/cron/sync-calendar/route');
    const res = asMockRes(await POST(makeReq() as never));
    expect((res.data as { added: number }).added).toBe(0);
    expect(mockDb.calendarEvent.create).not.toHaveBeenCalled();
  });
  it('FINGERPRINT в CRM НЕ перезаписывается из Google', async () => {
    mockCheckCronAuth.mockReturnValue(null);
    mockDb.user.findMany.mockResolvedValue([{ id: 'u-1', name: 'A' }]);
    mockListGoogleEvents.mockResolvedValue([
      {
        id: 'gid-fp', summary: 'Отпечатки', status: 'confirmed',
        start: { dateTime: '2026-05-01T10:00:00Z' },
        end:   { dateTime: '2026-05-01T11:00:00Z' },
      },
    ]);
    mockDb.calendarEvent.findMany.mockResolvedValue([
      { id: 'ce-1', googleId: 'gid-fp', kind: 'FINGERPRINT' },
    ]);
    const { POST } = await import('@/app/api/cron/sync-calendar/route');
    await POST(makeReq() as never);
    expect(mockDb.calendarEvent.update).not.toHaveBeenCalled();
    expect(mockDb.calendarEvent.delete).not.toHaveBeenCalled();
  });
});

describe('POST /api/cron/sync-calls', () => {
  it('checkCronAuth 401 → выход', async () => {
    mockCheckCronAuth.mockReturnValue({ status: 401, json: async () => ({}) });
    const { POST } = await import('@/app/api/cron/sync-calls/route');
    const res = asMockRes(await POST(makeReq() as never));
    expect(res.status).toBe(401);
    expect(mockTelephonyProvider.fetchCalls).not.toHaveBeenCalled();
  });
  it('провайдер не настроен → ok=false', async () => {
    mockCheckCronAuth.mockReturnValue(null);
    mockTelephonyProvider.isConfigured.mockReturnValue(false);
    const { POST } = await import('@/app/api/cron/sync-calls/route');
    const res = asMockRes(await POST(makeReq() as never));
    expect((res.data as { ok: boolean }).ok).toBe(false);
    expect(mockTelephonyProvider.fetchCalls).not.toHaveBeenCalled();
  });
  it('нет звонков → imported=0', async () => {
    mockCheckCronAuth.mockReturnValue(null);
    mockTelephonyProvider.fetchCalls.mockResolvedValue([]);
    const { POST } = await import('@/app/api/cron/sync-calls/route');
    const res = asMockRes(await POST(makeReq() as never));
    expect((res.data as { imported: number }).imported).toBe(0);
  });
  it('новый звонок + клиент найден → call.create + leadEvent CALL_LOGGED', async () => {
    mockCheckCronAuth.mockReturnValue(null);
    mockTelephonyProvider.fetchCalls.mockResolvedValue([
      {
        externalId: 'ext-1', direction: 'IN',
        fromNumber: '+48555', toNumber: '+48999',
        startedAt: new Date(), endedAt: new Date(), durationSec: 60,
      },
    ]);
    mockDb.call.findUnique.mockResolvedValue(null);
    mockDb.client.findUnique.mockResolvedValue({
      id: 'cl-1', ownerId: 'u-1', fullName: 'Иван',
      leads: [{ id: 'l-1', salesManagerId: 'u-1' }],
    });
    const { POST } = await import('@/app/api/cron/sync-calls/route');
    const res = asMockRes(await POST(makeReq() as never));
    expect((res.data as { imported: number; attached: number }).imported).toBe(1);
    expect((res.data as { attached: number }).attached).toBe(1);
    expect(mockDb.call.create).toHaveBeenCalled();
    expect(mockDb.leadEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ leadId: 'l-1', kind: 'CALL_LOGGED' }) }),
    );
  });
  it('дубликат по externalId → skipped', async () => {
    mockCheckCronAuth.mockReturnValue(null);
    mockTelephonyProvider.fetchCalls.mockResolvedValue([
      { externalId: 'ext-dup', direction: 'OUT', fromNumber: '+48999', toNumber: '+48111',
        startedAt: new Date(), endedAt: new Date(), durationSec: 30 },
    ]);
    mockDb.call.findUnique.mockResolvedValue({ id: 'existing' });
    const { POST } = await import('@/app/api/cron/sync-calls/route');
    const res = asMockRes(await POST(makeReq() as never));
    expect((res.data as { skipped: number }).skipped).toBe(1);
    expect(mockDb.call.create).not.toHaveBeenCalled();
  });
  it('MISSED звонок + клиент с ownerId → notify', async () => {
    mockCheckCronAuth.mockReturnValue(null);
    mockTelephonyProvider.fetchCalls.mockResolvedValue([
      { externalId: 'ext-m', direction: 'MISSED', fromNumber: '+48555', toNumber: '+48999',
        startedAt: new Date(), endedAt: new Date(), durationSec: 0 },
    ]);
    mockDb.call.findUnique.mockResolvedValue(null);
    mockDb.client.findUnique.mockResolvedValue({
      id: 'cl-1', ownerId: 'u-bob', fullName: 'Пётр',
      leads: [],
    });
    const { POST } = await import('@/app/api/cron/sync-calls/route');
    await POST(makeReq() as never);
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-bob', title: expect.stringContaining('Пропущенный') }),
    );
  });
});
