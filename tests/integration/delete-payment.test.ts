// Интеграционные тесты deletePayment.
import { describe, it, expect, vi, beforeEach } from 'vitest';

type AnyFn = ReturnType<typeof vi.fn>;

const mockDb = {
  payment:   { findUnique: vi.fn() as AnyFn, delete: vi.fn() as AnyFn },
  leadEvent: { create:     vi.fn() as AnyFn },
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: typeof mockDb) => Promise<unknown>)(mockDb);
    if (Array.isArray(arg)) return Promise.all(arg);
    throw new Error('unexpected $transaction arg');
  }) as AnyFn,
};

const mockAudit = vi.fn();
const mockCanDeletePayment = vi.fn(() => true);

vi.mock('@/lib/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({ id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN' })),
  requireAdmin: vi.fn(async () => ({ id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN' })),
}));
vi.mock('@/lib/permissions', () => ({
  canDeletePayment:      mockCanDeletePayment,
  canEditLead:           vi.fn(() => true),
  canTransferLead:       vi.fn(() => true),
  canAssignLegalManager: vi.fn(() => true),
  assert: vi.fn((cond: boolean) => {
    if (!cond) {
      const e = new Error('Доступ запрещён');
      (e as Error & { statusCode?: number }).statusCode = 403;
      throw e;
    }
  }),
}));
vi.mock('@/lib/audit',  () => ({ audit:  mockAudit }));
vi.mock('@/lib/notify', () => ({ notify: vi.fn() }));

const { deletePayment } = await import('@/app/(app)/actions');

beforeEach(() => {
  mockDb.payment.findUnique.mockReset();
  mockDb.payment.delete.mockReset();
  mockDb.leadEvent.create.mockReset();
  mockDb.$transaction.mockReset();
  mockDb.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: typeof mockDb) => Promise<unknown>)(mockDb);
    if (Array.isArray(arg)) return Promise.all(arg);
  });
  mockAudit.mockReset();
  mockCanDeletePayment.mockReset();
  mockCanDeletePayment.mockReturnValue(true);
});

describe('deletePayment', () => {
  it('успех: платёж удалён, leadEvent создан, audit вызван', async () => {
    mockDb.payment.findUnique.mockResolvedValue({
      leadId: 'lead-1', amount: 1000, method: 'CASH',
    });

    const result = await deletePayment('pay-1');

    expect(result).toEqual({ ok: true });
    expect(mockDb.payment.delete).toHaveBeenCalledWith({ where: { id: 'pay-1' } });
    expect(mockDb.leadEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'PAYMENT_REMOVED', leadId: 'lead-1' }),
      }),
    );
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'payment.delete', entityId: 'pay-1' }),
    );
  });

  it('платёж не найден → throw', async () => {
    mockDb.payment.findUnique.mockResolvedValue(null);

    await expect(deletePayment('no-such')).rejects.toThrow('Платёж не найден');
    expect(mockDb.payment.delete).not.toHaveBeenCalled();
  });

  it('canDeletePayment=false → throw, ничего не удалено', async () => {
    mockCanDeletePayment.mockReturnValue(false);

    await expect(deletePayment('pay-1')).rejects.toThrow();
    expect(mockDb.payment.delete).not.toHaveBeenCalled();
    expect(mockDb.payment.findUnique).not.toHaveBeenCalled(); // assert до findUnique
  });

  it('audit вызывается с before-snapshot (amount + method)', async () => {
    mockDb.payment.findUnique.mockResolvedValue({
      leadId: 'lead-1', amount: 250.50, method: 'TRANSFER',
    });
    await deletePayment('pay-1');

    const auditCall = mockAudit.mock.calls[0][0];
    expect(auditCall.before).toMatchObject({ amount: 250.50, method: 'TRANSFER' });
  });
});
