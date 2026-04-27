// Integration: finance/commissions — bulkMarkPaidOut (markCommissionPaidOut уже покрыт)
import { describe, it, expect, vi, beforeEach } from 'vitest';

type AnyFn = ReturnType<typeof vi.fn>;

const mockDb = {
  commission: { updateMany: vi.fn() as AnyFn },
};
const mockAudit = vi.fn();
const mockRequireAdmin = vi.fn(async () => ({ id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN' }));

vi.mock('@/lib/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({ id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN' })),
  requireAdmin: mockRequireAdmin,
}));
vi.mock('@/lib/audit', () => ({ audit: mockAudit }));

const { bulkMarkPaidOut } = await import('@/app/(app)/finance/commissions/actions');

beforeEach(() => {
  mockDb.commission.updateMany.mockReset();
  mockAudit.mockReset();
  mockRequireAdmin.mockReset();
  mockRequireAdmin.mockImplementation(async () => ({ id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN' }));
});

describe('bulkMarkPaidOut', () => {
  it('updateMany с in-фильтром по ids', async () => {
    const r = await bulkMarkPaidOut(['c-1', 'c-2', 'c-3']);
    expect(r).toMatchObject({ count: 3 });
    expect(mockDb.commission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['c-1', 'c-2', 'c-3'] } },
        data:  expect.objectContaining({ paidOut: true, paidOutAt: expect.any(Date) }),
      }),
    );
  });
  it('audit с count', async () => {
    await bulkMarkPaidOut(['c-1', 'c-2']);
    const auditCall = mockAudit.mock.calls[0][0];
    expect(auditCall.action).toBe('commission.bulkMarkPaid');
    expect(auditCall.after).toMatchObject({ count: 2 });
  });
  it('пустой массив → updateMany с пустым in (ничего не обновится)', async () => {
    await bulkMarkPaidOut([]);
    expect(mockDb.commission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [] } } }),
    );
  });
  it('не-админ → throw, не обновляет', async () => {
    mockRequireAdmin.mockImplementation(async () => { throw new Error('Forbidden'); });
    await expect(bulkMarkPaidOut(['c-1'])).rejects.toThrow();
    expect(mockDb.commission.updateMany).not.toHaveBeenCalled();
  });
});
