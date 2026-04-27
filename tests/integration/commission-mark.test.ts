import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = {
  commission: { update: vi.fn(), updateMany: vi.fn() },
  auditLog:   { create: vi.fn() },
};
const requireAdminMock = vi.fn();

vi.mock('@/lib/db',    () => ({ db: mockDb }));
vi.mock('@/lib/auth',  () => ({ requireAdmin: requireAdminMock }));
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }));

const { markCommissionPaidOut, bulkMarkPaidOut } =
  await import('@/app/(app)/finance/commissions/actions');

beforeEach(() => {
  mockDb.commission.update.mockReset();
  mockDb.commission.updateMany.mockReset();
  requireAdminMock.mockReset();
  requireAdminMock.mockResolvedValue({ id: 'u-admin', role: 'ADMIN' });
});

describe('markCommissionPaidOut', () => {
  it('paidOut=true → update + paidOutAt установлен', async () => {
    mockDb.commission.update.mockResolvedValue({});
    await markCommissionPaidOut('c1', true, 'выплачено наличными');
    const arg = mockDb.commission.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'c1' });
    expect(arg.data.paidOut).toBe(true);
    expect(arg.data.paidOutAt).toBeInstanceOf(Date);
    expect(arg.data.paidOutNotes).toBe('выплачено наличными');
  });

  it('paidOut=false → paidOutAt=null', async () => {
    mockDb.commission.update.mockResolvedValue({});
    await markCommissionPaidOut('c1', false);
    const arg = mockDb.commission.update.mock.calls[0][0];
    expect(arg.data.paidOutAt).toBeNull();
  });

  it('не-admin → 403 (через requireAdmin)', async () => {
    requireAdminMock.mockRejectedValue(new Error('Forbidden'));
    await expect(markCommissionPaidOut('c1', true)).rejects.toThrow('Forbidden');
  });
});

describe('bulkMarkPaidOut', () => {
  it('updateMany по списку id', async () => {
    mockDb.commission.updateMany.mockResolvedValue({ count: 3 });
    const res = await bulkMarkPaidOut(['c1', 'c2', 'c3']);
    expect(res.count).toBe(3);
    expect(mockDb.commission.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['c1', 'c2', 'c3'] } },
      data: expect.objectContaining({ paidOut: true }),
    });
  });
});
