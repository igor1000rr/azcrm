// Integration: clients/[id]/attorney-actions — setAttorney
import { describe, it, expect, vi, beforeEach } from 'vitest';

type AnyFn = ReturnType<typeof vi.fn>;

const mockDb = {
  lead:      { findUnique: vi.fn() as AnyFn, update: vi.fn() as AnyFn },
  leadEvent: { create: vi.fn() as AnyFn },
  $transaction: vi.fn(async (arg: unknown) => Array.isArray(arg) ? Promise.all(arg) : arg) as AnyFn,
};
const mockCanEditLead = vi.fn(() => true);

vi.mock('@/lib/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({ id: 'u-1', email: 'u@a', name: 'U', role: 'SALES' })),
  requireAdmin: vi.fn(async () => ({ id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN' })),
}));
vi.mock('@/lib/permissions', () => ({
  canEditLead: mockCanEditLead,
  assert: vi.fn((cond: boolean) => { if (!cond) throw new Error('Forbidden'); }),
}));

const { setAttorney } = await import('@/app/(app)/clients/[id]/attorney-actions');

beforeEach(() => {
  Object.values(mockDb).forEach((entity) => {
    if (typeof entity === 'function') (entity as AnyFn).mockReset();
    else Object.values(entity).forEach((fn) => (fn as AnyFn).mockReset());
  });
  mockDb.$transaction.mockImplementation(async (arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg) : arg,
  );
  mockCanEditLead.mockReset();
  mockCanEditLead.mockReturnValue(true);
});

describe('setAttorney', () => {
  it('лид не найден → throw', async () => {
    mockDb.lead.findUnique.mockResolvedValue(null);
    await expect(setAttorney('l-1', 'Анна')).rejects.toThrow('Лид не найден');
  });
  it('нет прав на лид → throw из assert', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'l-1', salesManagerId: 'other', legalManagerId: 'other', attorney: null,
    });
    mockCanEditLead.mockReturnValue(false);
    await expect(setAttorney('l-1', 'Анна')).rejects.toThrow('Forbidden');
    expect(mockDb.lead.update).not.toHaveBeenCalled();
  });
  it('attorney тот же что был → noop (return ok), ничего не пишет', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'l-1', salesManagerId: 'u-1', legalManagerId: null, attorney: 'Анна',
    });
    const r = await setAttorney('l-1', 'Анна');
    expect(r).toEqual({ ok: true });
    expect(mockDb.lead.update).not.toHaveBeenCalled();
    expect(mockDb.leadEvent.create).not.toHaveBeenCalled();
  });
  it('attorney с пробелами вокруг → trim, и если равен — noop', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'l-1', salesManagerId: 'u-1', legalManagerId: null, attorney: 'Анна',
    });
    await setAttorney('l-1', '   Анна   ');
    expect(mockDb.lead.update).not.toHaveBeenCalled();
  });
  it('назначение → lead.update + leadEvent CUSTOM с "Назначен Pelnomocnik"', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'l-1', salesManagerId: 'u-1', legalManagerId: null, attorney: null,
    });
    await setAttorney('l-1', 'Анна К');
    expect(mockDb.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'l-1' }, data: { attorney: 'Анна К' } }),
    );
    const eventCall = mockDb.leadEvent.create.mock.calls[0][0];
    expect(eventCall.data.kind).toBe('CUSTOM');
    expect(eventCall.data.message).toMatch(/Назначен Pelnomocnik/);
    expect(eventCall.data.payload).toEqual({ from: null, to: 'Анна К' });
  });
  it('снятие (null/пустая строка) → leadEvent с "Pelnomocnik снят"', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'l-1', salesManagerId: 'u-1', legalManagerId: null, attorney: 'Олег',
    });
    await setAttorney('l-1', '');
    const eventCall = mockDb.leadEvent.create.mock.calls[0][0];
    expect(eventCall.data.message).toBe('Pelnomocnik снят');
    expect(eventCall.data.payload).toEqual({ from: 'Олег', to: null });
  });
  it('null на null → noop', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'l-1', salesManagerId: 'u-1', legalManagerId: null, attorney: null,
    });
    await setAttorney('l-1', null);
    expect(mockDb.lead.update).not.toHaveBeenCalled();
  });
});
