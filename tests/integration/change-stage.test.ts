// Интеграционные тесты changeLeadStage.
import { describe, it, expect, vi, beforeEach } from 'vitest';

type AnyFn = ReturnType<typeof vi.fn>;

const mockDb = {
  lead:      { findUnique: vi.fn() as AnyFn, update: vi.fn() as AnyFn },
  stage:     { findUnique: vi.fn() as AnyFn },
  leadEvent: { create:     vi.fn() as AnyFn },
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

const { changeLeadStage } = await import('@/app/(app)/actions');

beforeEach(() => {
  mockDb.lead.findUnique.mockReset();
  mockDb.lead.update.mockReset();
  mockDb.stage.findUnique.mockReset();
  mockDb.leadEvent.create.mockReset();
  mockDb.$transaction.mockReset();
  mockDb.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: typeof mockDb) => Promise<unknown>)(mockDb);
    if (Array.isArray(arg)) return Promise.all(arg);
  });
  mockCanEditLead.mockReset();
  mockCanEditLead.mockReturnValue(true);
});

describe('changeLeadStage', () => {
  it('лид не найден → throw', async () => {
    mockDb.lead.findUnique.mockResolvedValue(null);
    await expect(changeLeadStage('no-such', 's-1')).rejects.toThrow('Лид не найден');
  });

  it('этап из чужой воронки → throw', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'l-1', salesManagerId: 'u-1', legalManagerId: null,
      stageId: 's-1', funnelId: 'f-1', stage: { name: 'Old' },
    });
    mockDb.stage.findUnique.mockResolvedValue({
      id: 's-99', name: 'Other', funnelId: 'f-DIFFERENT',
    });
    await expect(changeLeadStage('l-1', 's-99'))
      .rejects.toThrow('Этап не принадлежит воронке лида');
    expect(mockDb.lead.update).not.toHaveBeenCalled();
  });

  it('этап не найден → throw', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'l-1', salesManagerId: 'u-1', legalManagerId: null,
      stageId: 's-1', funnelId: 'f-1', stage: { name: 'Old' },
    });
    mockDb.stage.findUnique.mockResolvedValue(null);
    await expect(changeLeadStage('l-1', 's-no')).rejects.toThrow();
  });

  it('тот же этап — ничего не обновляется, возвращает ok', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'l-1', salesManagerId: 'u-1', legalManagerId: null,
      stageId: 's-1', funnelId: 'f-1', stage: { name: 'Old' },
    });
    mockDb.stage.findUnique.mockResolvedValue({
      id: 's-1', name: 'Old', funnelId: 'f-1',
    });

    const r = await changeLeadStage('l-1', 's-1');
    expect(r).toEqual({ ok: true });
    expect(mockDb.lead.update).not.toHaveBeenCalled();
    expect(mockDb.leadEvent.create).not.toHaveBeenCalled();
  });

  it('успех: lead.update + leadEvent STAGE_CHANGED с переходом в message', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'l-1', salesManagerId: 'u-1', legalManagerId: null,
      stageId: 's-1', funnelId: 'f-1', stage: { name: 'Новый' },
    });
    mockDb.stage.findUnique.mockResolvedValue({
      id: 's-2', name: 'В работе', funnelId: 'f-1',
    });

    const r = await changeLeadStage('l-1', 's-2');
    expect(r).toEqual({ ok: true });
    expect(mockDb.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'l-1' }, data: { stageId: 's-2' } }),
    );
    expect(mockDb.leadEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'STAGE_CHANGED',
          message: 'Новый → В работе',
        }),
      }),
    );
  });

  it('canEditLead=false → throw, ничего не обновлено', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'l-1', salesManagerId: 'u-other', legalManagerId: null,
      stageId: 's-1', funnelId: 'f-1', stage: { name: 'X' },
    });
    mockCanEditLead.mockReturnValue(false);

    await expect(changeLeadStage('l-1', 's-2')).rejects.toThrow();
    expect(mockDb.lead.update).not.toHaveBeenCalled();
  });
});
