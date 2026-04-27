// Integration: finance/payroll — upsertPayrollConfig
import { describe, it, expect, vi, beforeEach } from 'vitest';

type AnyFn = ReturnType<typeof vi.fn>;

const mockDb = {
  payrollConfig: { findUnique: vi.fn() as AnyFn, upsert: vi.fn() as AnyFn },
};
const mockAudit = vi.fn();
const mockRequireAdmin = vi.fn(async () => ({ id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN' }));

vi.mock('@/lib/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({ id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN' })),
  requireAdmin: mockRequireAdmin,
}));
vi.mock('@/lib/audit', () => ({ audit: mockAudit }));

const { upsertPayrollConfig } = await import('@/app/(app)/finance/payroll/actions');

beforeEach(() => {
  Object.values(mockDb.payrollConfig).forEach((fn) => (fn as AnyFn).mockReset());
  mockAudit.mockReset();
  mockRequireAdmin.mockReset();
  mockRequireAdmin.mockImplementation(async () => ({ id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN' }));
});

describe('upsertPayrollConfig', () => {
  it('zod: hourlyRate < 0 → throw', async () => {
    await expect(upsertPayrollConfig({ userId: 'u-1', hourlyRate: -10 } as never))
      .rejects.toThrow();
  });
  it('новый конфиг (existing=null) → upsert + audit без before', async () => {
    mockDb.payrollConfig.findUnique.mockResolvedValue(null);
    await upsertPayrollConfig({ userId: 'u-1', hourlyRate: 50, fixedSalary: 0, taxAmount: 0 } as never);
    expect(mockDb.payrollConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u-1' } }),
    );
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'payroll.upsert', entityId: 'u-1' }),
    );
  });
  it('существующий конфиг → audit получает before', async () => {
    mockDb.payrollConfig.findUnique.mockResolvedValue({ userId: 'u-1', hourlyRate: 30 });
    await upsertPayrollConfig({ userId: 'u-1', hourlyRate: 50 } as never);
    const auditCall = mockAudit.mock.calls[0][0];
    expect(auditCall.before).toMatchObject({ hourlyRate: 30 });
  });
  it('не-админ → throw', async () => {
    mockRequireAdmin.mockImplementation(async () => { throw new Error('Forbidden'); });
    await expect(upsertPayrollConfig({ userId: 'u-1' } as never)).rejects.toThrow();
    expect(mockDb.payrollConfig.upsert).not.toHaveBeenCalled();
  });
});
