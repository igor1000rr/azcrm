// Integration: finance/expenses — upsert + delete (только ADMIN)
import { describe, it, expect, vi, beforeEach } from 'vitest';

type AnyFn = ReturnType<typeof vi.fn>;

const mockDb = {
  expense: { create: vi.fn() as AnyFn, update: vi.fn() as AnyFn, delete: vi.fn() as AnyFn },
};
const mockAudit = vi.fn();
const mockRequireAdmin = vi.fn(async () => ({ id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN' }));

vi.mock('@/lib/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth', () => ({
  requireUser:  vi.fn(async () => ({ id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN' })),
  requireAdmin: mockRequireAdmin,
}));
vi.mock('@/lib/audit', () => ({ audit: mockAudit }));

const { upsertExpense, deleteExpense } = await import('@/app/(app)/finance/expenses/actions');

beforeEach(() => {
  Object.values(mockDb.expense).forEach((fn) => (fn as AnyFn).mockReset());
  mockAudit.mockReset();
  mockRequireAdmin.mockReset();
  mockRequireAdmin.mockImplementation(async () => ({ id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN' }));
});

describe('upsertExpense', () => {
  it('zod: пустая категория → throw', async () => {
    await expect(upsertExpense({ category: '', amount: 100, spentAt: '2026-01-01' } as never))
      .rejects.toThrow();
  });
  it('zod: amount=0 → throw (positive)', async () => {
    await expect(upsertExpense({ category: 'Аренда', amount: 0, spentAt: '2026-01-01' } as never))
      .rejects.toThrow();
  });
  it('zod: пустая дата → throw', async () => {
    await expect(upsertExpense({ category: 'X', amount: 100, spentAt: '' } as never))
      .rejects.toThrow();
  });
  it('создание (без id) → expense.create + audit expense.create', async () => {
    mockDb.expense.create.mockResolvedValue({ id: 'e-1' });
    await upsertExpense({ category: 'Канцтовары', amount: 250.50, spentAt: '2026-01-15' } as never);
    expect(mockDb.expense.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({
        category: 'Канцтовары', amount: 250.50, createdById: 'u-admin',
      }) }),
    );
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'expense.create' }));
  });
  it('обновление (с id) → expense.update + audit expense.update', async () => {
    await upsertExpense({ id: 'e-9', category: 'A', amount: 50, spentAt: '2026-01-01' } as never);
    expect(mockDb.expense.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'e-9' } }),
    );
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'expense.update' }));
    expect(mockDb.expense.create).not.toHaveBeenCalled();
  });
  it('категория с пробелами trim-ится', async () => {
    mockDb.expense.create.mockResolvedValue({ id: 'e-1' });
    await upsertExpense({ category: '  Реклама  ', amount: 100, spentAt: '2026-01-01' } as never);
    const call = mockDb.expense.create.mock.calls[0][0];
    expect(call.data.category).toBe('Реклама');
  });
  it('не-админ → throw из requireAdmin', async () => {
    mockRequireAdmin.mockImplementation(async () => { throw new Error('Только администратор'); });
    await expect(upsertExpense({ category: 'X', amount: 10, spentAt: '2026-01-01' } as never))
      .rejects.toThrow('Только администратор');
    expect(mockDb.expense.create).not.toHaveBeenCalled();
  });
});

describe('deleteExpense', () => {
  it('удаляет + audit', async () => {
    await deleteExpense('e-5');
    expect(mockDb.expense.delete).toHaveBeenCalledWith({ where: { id: 'e-5' } });
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'expense.delete', entityId: 'e-5',
    }));
  });
  it('не-админ → throw, не удаляет', async () => {
    mockRequireAdmin.mockImplementation(async () => { throw new Error('Forbidden'); });
    await expect(deleteExpense('e-5')).rejects.toThrow();
    expect(mockDb.expense.delete).not.toHaveBeenCalled();
  });
});
