// Интеграционные тесты archiveLead / restoreLead.
import { describe, it, expect, vi, beforeEach } from 'vitest';

type AnyFn = ReturnType<typeof vi.fn>;

const mockDb = {
  lead:      { update: vi.fn() as AnyFn },
  leadEvent: { create: vi.fn() as AnyFn },
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: typeof mockDb) => Promise<unknown>)(mockDb);
    if (Array.isArray(arg)) return Promise.all(arg);
  }) as AnyFn,
};

const mockAudit = vi.fn();
const mockRequireAdmin = vi.fn(async () => ({
  id: 'u-admin', email: 'a@a', name: 'Admin', role: 'ADMIN',
}));

vi.mock('@/lib/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth', () => ({
  requireUser:  vi.fn(async () => ({ id: 'u-1', email: 'u@a', name: 'U', role: 'SALES' })),
  requireAdmin: mockRequireAdmin,
}));
vi.mock('@/lib/permissions', () => ({
  canEditLead:           vi.fn(() => true),
  canTransferLead:       vi.fn(() => true),
  canAssignLegalManager: vi.fn(() => true),
  canDeletePayment:      vi.fn(() => true),
  assert: vi.fn((cond: boolean) => {
    if (!cond) throw new Error('Forbidden');
  }),
}));
vi.mock('@/lib/audit',  () => ({ audit:  mockAudit }));
vi.mock('@/lib/notify', () => ({ notify: vi.fn()   }));

const { archiveLead, restoreLead } = await import('@/app/(app)/actions');

beforeEach(() => {
  mockDb.lead.update.mockReset();
  mockDb.leadEvent.create.mockReset();
  mockDb.$transaction.mockReset();
  mockDb.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: typeof mockDb) => Promise<unknown>)(mockDb);
    if (Array.isArray(arg)) return Promise.all(arg);
  });
  mockAudit.mockReset();
  mockRequireAdmin.mockReset();
  mockRequireAdmin.mockImplementation(async () => ({
    id: 'u-admin', email: 'a@a', name: 'Admin', role: 'ADMIN',
  }));
});

describe('archiveLead', () => {
  it('успех: lead.update + leadEvent ARCHIVED + audit', async () => {
    const r = await archiveLead('l-1');
    expect(r).toEqual({ ok: true });
    expect(mockDb.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'l-1' },
        data:  expect.objectContaining({ isArchived: true }),
      }),
    );
    expect(mockDb.leadEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'ARCHIVED', leadId: 'l-1' }),
      }),
    );
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'lead.archive', entityId: 'l-1' }),
    );
  });

  it('closedAt устанавливается в текущую дату', async () => {
    const before = Date.now();
    await archiveLead('l-1');
    const updateCall = mockDb.lead.update.mock.calls[0][0];
    expect(updateCall.data.closedAt).toBeInstanceOf(Date);
    expect(updateCall.data.closedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('не админ → throw из requireAdmin', async () => {
    mockRequireAdmin.mockImplementation(async () => {
      const e = new Error('Недостаточно прав');
      (e as Error & { statusCode?: number }).statusCode = 403;
      throw e;
    });

    await expect(archiveLead('l-1')).rejects.toThrow('Недостаточно прав');
    expect(mockDb.lead.update).not.toHaveBeenCalled();
  });
});

describe('restoreLead', () => {
  it('успех: isArchived=false, closedAt=null, leadEvent RESTORED', async () => {
    const r = await restoreLead('l-1');
    expect(r).toEqual({ ok: true });
    expect(mockDb.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'l-1' },
        data:  { isArchived: false, closedAt: null },
      }),
    );
    expect(mockDb.leadEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'RESTORED' }),
      }),
    );
  });

  it('не админ → throw', async () => {
    mockRequireAdmin.mockImplementation(async () => {
      throw new Error('Недостаточно прав');
    });
    await expect(restoreLead('l-1')).rejects.toThrow();
    expect(mockDb.lead.update).not.toHaveBeenCalled();
  });
});
