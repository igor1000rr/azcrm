// Unit + Integration: lib/document-reminders
// Anna идея №7 — напоминания о сроках виз/паспорта менеджеру.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------- Unit: pure helpers ----------------

import { pickThreshold, shouldSend, flagsToSet } from '@/lib/document-reminders';

describe('pickThreshold', () => {
  it('daysLeft <= 0 (истёк) → null', () => {
    expect(pickThreshold(0)).toBeNull();
    expect(pickThreshold(-5)).toBeNull();
  });
  it('1..14 → 14', () => {
    expect(pickThreshold(1)).toBe(14);
    expect(pickThreshold(7)).toBe(14);
    expect(pickThreshold(14)).toBe(14);
  });
  it('15..30 → 30', () => {
    expect(pickThreshold(15)).toBe(30);
    expect(pickThreshold(30)).toBe(30);
  });
  it('31..90 → 90', () => {
    expect(pickThreshold(31)).toBe(90);
    expect(pickThreshold(90)).toBe(90);
  });
  it('> 90 (рано) → null', () => {
    expect(pickThreshold(91)).toBeNull();
    expect(pickThreshold(365)).toBeNull();
  });
});

describe('shouldSend', () => {
  it('14: шлёт только если r14=false (вне зависимости от r30/r90)', () => {
    expect(shouldSend(14, { r90: true, r30: true, r14: false })).toBe(true);
    expect(shouldSend(14, { r90: false, r30: false, r14: true })).toBe(false);
  });
  it('30: шлёт только если r30=false', () => {
    expect(shouldSend(30, { r90: true, r30: false, r14: false })).toBe(true);
    expect(shouldSend(30, { r90: false, r30: true, r14: false })).toBe(false);
  });
  it('90: шлёт только если r90=false', () => {
    expect(shouldSend(90, { r90: false, r30: false, r14: false })).toBe(true);
    expect(shouldSend(90, { r90: true, r30: false, r14: false })).toBe(false);
  });
});

describe('flagsToSet', () => {
  it('14 → ставит все три флага (90/30/14): меньшие пороги уже бесполезны', () => {
    expect(flagsToSet(14)).toEqual({ r90: true, r30: true, r14: true });
  });
  it('30 → ставит 30 и 90, не трогает 14', () => {
    expect(flagsToSet(30)).toEqual({ r90: true, r30: true });
  });
  it('90 → только 90', () => {
    expect(flagsToSet(90)).toEqual({ r90: true });
  });
});

// ---------------- Integration: checkExpiringDocuments ----------------

type AnyFn = ReturnType<typeof vi.fn>;

const mockDb = {
  client: {
    findMany: vi.fn() as AnyFn,
    update:   vi.fn() as AnyFn,
  },
};
const mockNotify = vi.fn();

vi.mock('@/lib/db', () => ({ db: mockDb }));
vi.mock('@/lib/notify', () => ({ notify: mockNotify }));

const { checkExpiringDocuments } = await import('@/lib/document-reminders');

const NOW = new Date('2026-04-30T12:00:00.000Z');

function daysFromNow(d: number): Date {
  return new Date(NOW.getTime() + d * 86_400_000);
}

function mkClient(over: Partial<{
  id:                       string;
  fullName:                 string;
  legalStayUntil:           Date | null;
  passportExpiresAt:        Date | null;
  legalStayReminder90Sent:  boolean;
  legalStayReminder30Sent:  boolean;
  legalStayReminder14Sent:  boolean;
  passportReminder90Sent:   boolean;
  passportReminder30Sent:   boolean;
  passportReminder14Sent:   boolean;
  legalManagerId:           string | null;
  salesManagerId:           string | null;
  leadId:                   string;
}>) {
  return {
    id:                      over.id ?? 'cl-1',
    fullName:                over.fullName ?? 'Иван Петров',
    legalStayUntil:          over.legalStayUntil ?? null,
    passportExpiresAt:       over.passportExpiresAt ?? null,
    legalStayReminder90Sent: over.legalStayReminder90Sent ?? false,
    legalStayReminder30Sent: over.legalStayReminder30Sent ?? false,
    legalStayReminder14Sent: over.legalStayReminder14Sent ?? false,
    passportReminder90Sent:  over.passportReminder90Sent  ?? false,
    passportReminder30Sent:  over.passportReminder30Sent  ?? false,
    passportReminder14Sent:  over.passportReminder14Sent  ?? false,
    leads: [{
      id:             over.leadId ?? 'lead-1',
      legalManagerId: over.legalManagerId ?? 'mgr-legal',
      salesManagerId: over.salesManagerId ?? 'mgr-sales',
    }],
  };
}

describe('checkExpiringDocuments', () => {
  beforeEach(() => {
    mockDb.client.findMany.mockReset();
    mockDb.client.update.mockReset();
    mockNotify.mockReset();
    mockDb.client.update.mockResolvedValue({});
  });

  it('пусто → 0 sent', async () => {
    mockDb.client.findMany.mockResolvedValue([]);
    const r = await checkExpiringDocuments(NOW);
    expect(r.sent).toBe(0);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('legalStayUntil через 60 дней → шлёт 90-day напоминание + ставит флаг r90', async () => {
    mockDb.client.findMany.mockResolvedValue([
      mkClient({ legalStayUntil: daysFromNow(60) }),
    ]);

    const r = await checkExpiringDocuments(NOW);

    expect(r.sent).toBe(1);
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'mgr-legal',                         // legal приоритетнее sales
      kind:   'DOCUMENT_EXPIRY_REMINDER',
      title:  expect.stringContaining('60'),
      body:   expect.stringContaining('легальный побыт'),
      link:   '/clients/lead-1',
    }));
    expect(mockDb.client.update).toHaveBeenCalledWith({
      where: { id: 'cl-1' },
      data:  { legalStayReminder90Sent: true },
    });
  });

  it('legalStayUntil через 20 дней → 30-day напоминание + флаги 30 и 90', async () => {
    mockDb.client.findMany.mockResolvedValue([
      mkClient({ legalStayUntil: daysFromNow(20) }),
    ]);

    await checkExpiringDocuments(NOW);

    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringContaining('20'),
    }));
    expect(mockDb.client.update).toHaveBeenCalledWith({
      where: { id: 'cl-1' },
      data:  { legalStayReminder90Sent: true, legalStayReminder30Sent: true },
    });
  });

  it('legalStayUntil через 7 дней → 14-day + ВСЕ флаги (14/30/90)', async () => {
    mockDb.client.findMany.mockResolvedValue([
      mkClient({ legalStayUntil: daysFromNow(7) }),
    ]);

    await checkExpiringDocuments(NOW);

    expect(mockDb.client.update).toHaveBeenCalledWith({
      where: { id: 'cl-1' },
      data:  {
        legalStayReminder90Sent: true,
        legalStayReminder30Sent: true,
        legalStayReminder14Sent: true,
      },
    });
  });

  it('legalStayReminder90Sent=true + days=60 → НЕ шлёт повторно', async () => {
    mockDb.client.findMany.mockResolvedValue([
      mkClient({ legalStayUntil: daysFromNow(60), legalStayReminder90Sent: true }),
    ]);

    const r = await checkExpiringDocuments(NOW);

    expect(r.sent).toBe(0);
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockDb.client.update).not.toHaveBeenCalled();
  });

  it('флаг 90Sent=true но days=20 → шлёт 30-day (новый порог, новый флаг)', async () => {
    mockDb.client.findMany.mockResolvedValue([
      mkClient({ legalStayUntil: daysFromNow(20), legalStayReminder90Sent: true }),
    ]);

    const r = await checkExpiringDocuments(NOW);

    expect(r.sent).toBe(1);
    expect(mockNotify).toHaveBeenCalled();
    expect(mockDb.client.update).toHaveBeenCalledWith({
      where: { id: 'cl-1' },
      data:  { legalStayReminder90Sent: true, legalStayReminder30Sent: true },
    });
  });

  it('passportExpiresAt отдельно — свои флаги, текст про паспорт', async () => {
    mockDb.client.findMany.mockResolvedValue([
      mkClient({ passportExpiresAt: daysFromNow(50) }),
    ]);

    await checkExpiringDocuments(NOW);

    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining('паспорт'),
    }));
    expect(mockDb.client.update).toHaveBeenCalledWith({
      where: { id: 'cl-1' },
      data:  { passportReminder90Sent: true },
    });
  });

  it('обе даты заполнены → 2 уведомления, разные флаги', async () => {
    mockDb.client.findMany.mockResolvedValue([
      mkClient({
        legalStayUntil:    daysFromNow(80),
        passportExpiresAt: daysFromNow(20),
      }),
    ]);

    const r = await checkExpiringDocuments(NOW);

    expect(r.sent).toBe(2);
    expect(mockNotify).toHaveBeenCalledTimes(2);
    // legalStay (80 дней) → 90-day
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining('легальный побыт'),
    }));
    // passport (20 дней) → 30-day
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining('паспорт'),
    }));
  });

  it('legalStayUntil через 100 дней (вне 90) → не шлёт', async () => {
    mockDb.client.findMany.mockResolvedValue([
      mkClient({ legalStayUntil: daysFromNow(100) }),
    ]);

    const r = await checkExpiringDocuments(NOW);

    expect(r.sent).toBe(0);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('legalManagerId=null → fallback на salesManager', async () => {
    mockDb.client.findMany.mockResolvedValue([
      mkClient({
        legalStayUntil: daysFromNow(60),
        legalManagerId: null,
        salesManagerId: 'mgr-sales-2',
      }),
    ]);

    await checkExpiringDocuments(NOW);

    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'mgr-sales-2',
    }));
  });

  it('оба менеджера null → пропускает (не шлём в никуда)', async () => {
    mockDb.client.findMany.mockResolvedValue([
      mkClient({
        legalStayUntil: daysFromNow(60),
        legalManagerId: null,
        salesManagerId: null,
      }),
    ]);

    const r = await checkExpiringDocuments(NOW);

    expect(r.sent).toBe(0);
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockDb.client.update).not.toHaveBeenCalled();
  });

  it('notify бросил → errors инкрементируется, флаг НЕ ставится', async () => {
    mockDb.client.findMany.mockResolvedValue([
      mkClient({ legalStayUntil: daysFromNow(60) }),
    ]);
    mockNotify.mockRejectedValueOnce(new Error('push backend down'));

    const r = await checkExpiringDocuments(NOW);

    expect(r.sent).toBe(0);
    expect(r.errors).toBe(1);
    expect(mockDb.client.update).not.toHaveBeenCalled();
  });

  it('findMany запрос фильтрует isArchived=false и активные лиды', async () => {
    mockDb.client.findMany.mockResolvedValue([]);
    await checkExpiringDocuments(NOW);
    const where = mockDb.client.findMany.mock.calls[0][0].where;
    expect(where.isArchived).toBe(false);
    expect(where.leads).toEqual({ some: { isArchived: false } });
    expect(where.OR).toBeDefined();
  });

  it('link → /clients/{leadId} (не clientId, чтобы открывалась карточка лида)', async () => {
    mockDb.client.findMany.mockResolvedValue([
      mkClient({ legalStayUntil: daysFromNow(60), leadId: 'lead-xyz' }),
    ]);

    await checkExpiringDocuments(NOW);

    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
      link: '/clients/lead-xyz',
    }));
  });
});
