// Integration: setFingerprintDate — дата отпечатков + Google Calendar sync
import { describe, it, expect, vi, beforeEach } from 'vitest';

type AnyFn = ReturnType<typeof vi.fn>;

const mockDb = {
  lead:          { findUnique: vi.fn() as AnyFn, update: vi.fn() as AnyFn },
  calendarEvent: {
    findFirst:  vi.fn() as AnyFn,
    create:     vi.fn() as AnyFn,
    deleteMany: vi.fn() as AnyFn,
    updateMany: vi.fn() as AnyFn,
  },
  leadEvent: { create: vi.fn() as AnyFn },
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: typeof mockDb) => Promise<unknown>)(mockDb);
    if (Array.isArray(arg)) return Promise.all(arg);
  }) as AnyFn,
};
const mockCanEditLead = vi.fn(() => true);
const mockDeleteGoogleEvent = vi.fn(async () => undefined);
const mockCreateGoogleEvent = vi.fn(async () => 'gcal-id-123');

vi.mock('@/lib/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({ id: 'u-1', email: 'u@example.com', name: 'U', role: 'LEGAL' })),
  requireAdmin: vi.fn(async () => ({ id: 'u-admin', email: 'a@example.com', name: 'A', role: 'ADMIN' })),
}));
vi.mock('@/lib/permissions', () => ({
  canEditLead: mockCanEditLead,
  assert: vi.fn((cond: boolean) => { if (!cond) throw new Error('Forbidden'); }),
  canTransferLead:        vi.fn(() => true),
  canAssignLegalManager:  vi.fn(() => true),
  canDeletePayment:       vi.fn(() => true),
}));
vi.mock('@/lib/google', () => ({
  deleteGoogleEvent: mockDeleteGoogleEvent,
  createGoogleEvent: mockCreateGoogleEvent,
}));
vi.mock('@/lib/notify',    () => ({ notify: vi.fn(), notifyManagers: vi.fn() }));
vi.mock('@/lib/audit',     () => ({ audit: vi.fn() }));
vi.mock('@/lib/whatsapp',  () => ({ workerSend: vi.fn(), workerDisconnect: vi.fn() }));

const { setFingerprintDate } = await import('@/app/(app)/actions');

beforeEach(() => {
  Object.values(mockDb).forEach((entity) => {
    if (typeof entity === 'function') (entity as AnyFn).mockReset();
    else Object.values(entity).forEach((fn) => (fn as AnyFn).mockReset());
  });
  mockDb.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: typeof mockDb) => Promise<unknown>)(mockDb);
    if (Array.isArray(arg)) return Promise.all(arg);
  });
  mockCanEditLead.mockReset();
  mockCanEditLead.mockReturnValue(true);
  // ВАЖНО: после mockReset() реализация сбрасывается, вызов возвращает undefined.
  // setFingerprintDate вызывает deleteGoogleEvent(...).catch(...) — на undefined .catch упадёт.
  mockDeleteGoogleEvent.mockReset();
  mockDeleteGoogleEvent.mockResolvedValue(undefined);
  mockCreateGoogleEvent.mockReset();
  mockCreateGoogleEvent.mockResolvedValue('gcal-id-123');
});

describe('setFingerprintDate', () => {
  it('лид не найден → throw', async () => {
    mockDb.lead.findUnique.mockResolvedValue(null);
    await expect(setFingerprintDate('l-x', '2026-05-01', null)).rejects.toThrow('Лид не найден');
  });

  it('нет прав на лид → throw из assert, без изменений', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'l-1', salesManagerId: 'other', legalManagerId: 'other',
      client: { fullName: 'X', phone: '+48' },
    });
    mockCanEditLead.mockReturnValue(false);
    await expect(setFingerprintDate('l-1', '2026-05-01', null)).rejects.toThrow();
    expect(mockDb.lead.update).not.toHaveBeenCalled();
  });

  it('date=null → deleteMany calendarEvent, без create + leadEvent "снята"', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'l-1', salesManagerId: 'u-1', legalManagerId: 'u-2',
      client: { fullName: 'Иван', phone: '+48123' },
    });
    mockDb.calendarEvent.findFirst.mockResolvedValue(null);
    await setFingerprintDate('l-1', null, null);
    expect(mockDb.calendarEvent.deleteMany).toHaveBeenCalled();
    expect(mockDb.calendarEvent.create).not.toHaveBeenCalled();
    expect(mockCreateGoogleEvent).not.toHaveBeenCalled();
    const evCall = mockDb.leadEvent.create.mock.calls[0][0];
    expect(evCall.data.message).toMatch(/снята/);
  });

  it('date указана + legalManagerId → transaction с lead.update, calendarEvent.create, leadEvent.create + Google sync', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'l-1', salesManagerId: 'u-1', legalManagerId: 'u-legal',
      client: { fullName: 'Петр', phone: '+48999' },
    });
    mockDb.calendarEvent.findFirst.mockResolvedValue(null);
    await setFingerprintDate('l-1', '2026-05-15T10:00:00Z', 'Варшава, ul. X');

    expect(mockDb.lead.update).toHaveBeenCalled();
    expect(mockDb.calendarEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leadId:    'l-1',
          ownerId:   'u-legal',
          kind:      'FINGERPRINT',
          location:  'Варшава, ul. X',
        }),
      }),
    );
    expect(mockCreateGoogleEvent).toHaveBeenCalledWith('u-legal', expect.objectContaining({
      summary: expect.stringContaining('Отпечатки'),
    }));
    // После получения googleId → updateMany для сохранения связи
    expect(mockDb.calendarEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { leadId: 'l-1', kind: 'FINGERPRINT' },
        data:  { googleId: 'gcal-id-123' },
      }),
    );
  });

  it('date указана но legalManagerId=null → NO Google sync', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'l-1', salesManagerId: 'u-1', legalManagerId: null,
      client: { fullName: 'Петр', phone: '+48999' },
    });
    mockDb.calendarEvent.findFirst.mockResolvedValue(null);
    await setFingerprintDate('l-1', '2026-05-15T10:00:00Z', null);

    expect(mockCreateGoogleEvent).not.toHaveBeenCalled();
    // В calendarEvent ownerId будет null
    const calCall = mockDb.calendarEvent.create.mock.calls[0][0];
    expect(calCall.data.ownerId).toBeNull();
  });

  it('существует старый calendarEvent с googleId → deleteGoogleEvent вызывается', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'l-1', salesManagerId: 'u-1', legalManagerId: 'u-legal',
      client: { fullName: 'X', phone: '+48' },
    });
    mockDb.calendarEvent.findFirst.mockResolvedValue({
      id: 'ce-old', googleId: 'old-gid', ownerId: 'u-legal',
    });
    await setFingerprintDate('l-1', null, null);
    expect(mockDeleteGoogleEvent).toHaveBeenCalledWith('u-legal', 'old-gid');
  });

  it('endsAt — ровно +30 минут от startsAt', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'l-1', salesManagerId: 'u-1', legalManagerId: 'u-legal',
      client: { fullName: 'X', phone: '+48' },
    });
    mockDb.calendarEvent.findFirst.mockResolvedValue(null);
    await setFingerprintDate('l-1', '2026-05-15T10:00:00Z', null);

    const calCall = mockDb.calendarEvent.create.mock.calls[0][0];
    const start = (calCall.data.startsAt as Date).getTime();
    const end   = (calCall.data.endsAt as Date).getTime();
    expect(end - start).toBe(30 * 60 * 1000);
  });
});
