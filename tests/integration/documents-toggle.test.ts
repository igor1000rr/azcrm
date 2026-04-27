// Интеграционные тесты toggleDocument.
import { describe, it, expect, vi, beforeEach } from 'vitest';

type AnyFn = ReturnType<typeof vi.fn>;

const mockDb = {
  leadDocument: { findUnique: vi.fn() as AnyFn, update: vi.fn() as AnyFn },
  leadEvent:    { create:     vi.fn() as AnyFn },
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: typeof mockDb) => Promise<unknown>)(mockDb);
    if (Array.isArray(arg)) return Promise.all(arg);
  }) as AnyFn,
};

const mockCanEditLead = vi.fn(() => true);

vi.mock('@/lib/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth', () => ({
  requireUser:  vi.fn(async () => ({ id: 'u-1', email: 'u@a', name: 'U', role: 'SALES' })),
  requireAdmin: vi.fn(async () => ({ id: 'u-1', email: 'u@a', name: 'U', role: 'ADMIN' })),
}));
vi.mock('@/lib/permissions', () => ({
  canEditLead:           mockCanEditLead,
  canTransferLead:       vi.fn(() => true),
  canAssignLegalManager: vi.fn(() => true),
  canDeletePayment:      vi.fn(() => true),
  assert: vi.fn((cond: boolean) => {
    if (!cond) throw new Error('Forbidden');
  }),
}));
vi.mock('@/lib/audit',  () => ({ audit:  vi.fn() }));
vi.mock('@/lib/notify', () => ({ notify: vi.fn() }));

const { toggleDocument } = await import('@/app/(app)/actions');

beforeEach(() => {
  mockDb.leadDocument.findUnique.mockReset();
  mockDb.leadDocument.update.mockReset();
  mockDb.leadEvent.create.mockReset();
  mockDb.$transaction.mockReset();
  mockDb.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: typeof mockDb) => Promise<unknown>)(mockDb);
    if (Array.isArray(arg)) return Promise.all(arg);
  });
  mockCanEditLead.mockReset();
  mockCanEditLead.mockReturnValue(true);
});

describe('toggleDocument', () => {
  it('документ не найден → throw', async () => {
    mockDb.leadDocument.findUnique.mockResolvedValue(null);
    await expect(toggleDocument('no-such', true)).rejects.toThrow('Документ не найден');
  });

  it('canEditLead=false → throw, документ не обновляется', async () => {
    mockDb.leadDocument.findUnique.mockResolvedValue({
      id: 'd-1', name: 'Паспорт', leadId: 'l-1',
      lead: { salesManagerId: 'u-other', legalManagerId: null },
    });
    mockCanEditLead.mockReturnValue(false);
    await expect(toggleDocument('d-1', true)).rejects.toThrow();
    expect(mockDb.leadDocument.update).not.toHaveBeenCalled();
  });

  it('успех (true): галочка проставлена, leadEvent с сообщением "есть"', async () => {
    mockDb.leadDocument.findUnique.mockResolvedValue({
      id: 'd-1', name: 'Паспорт', leadId: 'l-1',
      lead: { salesManagerId: 'u-1', legalManagerId: null },
    });

    const r = await toggleDocument('d-1', true);
    expect(r).toEqual({ ok: true });
    expect(mockDb.leadDocument.update).toHaveBeenCalledWith({
      where: { id: 'd-1' }, data: { isPresent: true },
    });
    expect(mockDb.leadEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leadId: 'l-1', kind: 'DOCUMENT_TOGGLED',
          message: 'Паспорт: есть',
        }),
      }),
    );
  });

  it('успех (false): галочка снята, message "нет"', async () => {
    mockDb.leadDocument.findUnique.mockResolvedValue({
      id: 'd-2', name: 'Отпечатки', leadId: 'l-1',
      lead: { salesManagerId: 'u-1', legalManagerId: null },
    });

    await toggleDocument('d-2', false);
    expect(mockDb.leadEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          message: 'Отпечатки: нет',
        }),
      }),
    );
  });

  it('payload содержит documentId и isPresent', async () => {
    mockDb.leadDocument.findUnique.mockResolvedValue({
      id: 'd-3', name: 'X', leadId: 'l-1',
      lead: { salesManagerId: 'u-1', legalManagerId: null },
    });

    await toggleDocument('d-3', true);
    const eventCall = mockDb.leadEvent.create.mock.calls[0][0];
    expect(eventCall.data.payload).toEqual({ documentId: 'd-3', isPresent: true });
  });
});
