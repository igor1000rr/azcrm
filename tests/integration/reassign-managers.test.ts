// Интеграционные тесты reassignSalesManager / reassignLegalManager.
import { describe, it, expect, vi, beforeEach } from 'vitest';

type AnyFn = ReturnType<typeof vi.fn>;

const mockDb = {
  lead:      { findUnique: vi.fn() as AnyFn, update: vi.fn() as AnyFn },
  leadEvent: { create:     vi.fn() as AnyFn },
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: typeof mockDb) => Promise<unknown>)(mockDb);
    if (Array.isArray(arg)) return Promise.all(arg);
  }) as AnyFn,
};

const mockCanTransferLead       = vi.fn(() => true);
const mockCanAssignLegalManager = vi.fn(() => true);
const mockNotify = vi.fn();
const mockAudit  = vi.fn();

vi.mock('@/lib/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth', () => ({
  requireUser:  vi.fn(async () => ({ id: 'u-admin', email: 'a@a', name: 'Admin', role: 'ADMIN' })),
  requireAdmin: vi.fn(async () => ({ id: 'u-admin', email: 'a@a', name: 'Admin', role: 'ADMIN' })),
}));
vi.mock('@/lib/permissions', () => ({
  canEditLead:           vi.fn(() => true),
  canTransferLead:       mockCanTransferLead,
  canAssignLegalManager: mockCanAssignLegalManager,
  canDeletePayment:      vi.fn(() => true),
  assert: vi.fn((cond: boolean) => {
    if (!cond) throw new Error('Forbidden');
  }),
}));
vi.mock('@/lib/audit',  () => ({ audit:  mockAudit  }));
vi.mock('@/lib/notify', () => ({ notify: mockNotify }));

const { reassignSalesManager, reassignLegalManager } = await import('@/app/(app)/actions');

beforeEach(() => {
  mockDb.lead.findUnique.mockReset();
  mockDb.lead.update.mockReset();
  mockDb.leadEvent.create.mockReset();
  mockDb.$transaction.mockReset();
  mockDb.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: typeof mockDb) => Promise<unknown>)(mockDb);
    if (Array.isArray(arg)) return Promise.all(arg);
  });
  mockCanTransferLead.mockReset();
  mockCanTransferLead.mockReturnValue(true);
  mockCanAssignLegalManager.mockReset();
  mockCanAssignLegalManager.mockReturnValue(true);
  mockNotify.mockReset();
  mockAudit.mockReset();
});

describe('reassignSalesManager', () => {
  it('лид не найден → throw', async () => {
    mockDb.lead.findUnique.mockResolvedValue(null);
    await expect(reassignSalesManager('no-such', 'u-new')).rejects.toThrow('Лид не найден');
  });

  it('canTransferLead=false → throw, не переводит', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'l-1', salesManagerId: 'u-old', legalManagerId: null,
    });
    mockCanTransferLead.mockReturnValue(false);
    await expect(reassignSalesManager('l-1', 'u-new')).rejects.toThrow();
    expect(mockDb.lead.update).not.toHaveBeenCalled();
  });

  it('успех: lead.update + leadEvent + audit', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'l-1', salesManagerId: 'u-old', legalManagerId: null,
    });
    const r = await reassignSalesManager('l-1', 'u-new');
    expect(r).toEqual({ ok: true });
    expect(mockDb.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { salesManagerId: 'u-new' } }),
    );
    expect(mockDb.leadEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'MANAGER_CHANGED' }),
      }),
    );
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'lead.reassign_sales' }),
    );
  });

  it('notify вызывается если новый менеджер не текущий юзер', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'l-1', salesManagerId: 'u-old', legalManagerId: null,
    });
    await reassignSalesManager('l-1', 'u-new');
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-new', kind: 'LEAD_TRANSFERRED' }),
    );
  });

  it('notify НЕ вызывается если юзер переводит на себя', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'l-1', salesManagerId: 'u-old', legalManagerId: null,
    });
    await reassignSalesManager('l-1', 'u-admin'); // current user.id
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('снятие менеджера (null) — ок, без notify', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'l-1', salesManagerId: 'u-old', legalManagerId: null,
    });
    await reassignSalesManager('l-1', null);
    expect(mockDb.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { salesManagerId: null } }),
    );
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe('reassignLegalManager', () => {
  it('canAssignLegalManager=false → throw', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'l-1', salesManagerId: 'u-1', legalManagerId: null,
    });
    mockCanAssignLegalManager.mockReturnValue(false);
    await expect(reassignLegalManager('l-1', 'u-legal')).rejects.toThrow();
    expect(mockDb.lead.update).not.toHaveBeenCalled();
  });

  it('успех: назначение + notify + audit', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'l-1', salesManagerId: 'u-1', legalManagerId: null,
    });
    await reassignLegalManager('l-1', 'u-legal');
    expect(mockDb.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { legalManagerId: 'u-legal' } }),
    );
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-legal' }),
    );
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'lead.reassign_legal' }),
    );
  });
});
