// Integration: finance/services — upsert + delete + setCommissionStartPayment
import { describe, it, expect, vi, beforeEach } from 'vitest';

type AnyFn = ReturnType<typeof vi.fn>;

const mockDb = {
  service: {
    findUnique: vi.fn() as AnyFn, create: vi.fn() as AnyFn,
    update: vi.fn() as AnyFn, delete: vi.fn() as AnyFn,
  },
  lead:    { count: vi.fn() as AnyFn },
  setting: { upsert: vi.fn() as AnyFn },
};
const mockAudit = vi.fn();
const mockRequireAdmin = vi.fn(async () => ({ id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN' }));

vi.mock('@/lib/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({ id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN' })),
  requireAdmin: mockRequireAdmin,
}));
vi.mock('@/lib/audit', () => ({ audit: mockAudit }));

const { upsertService, deleteService, setCommissionStartPayment } =
  await import('@/app/(app)/finance/services/actions');

beforeEach(() => {
  Object.values(mockDb).forEach((entity) => Object.values(entity).forEach((fn) => (fn as AnyFn).mockReset()));
  mockAudit.mockReset();
  mockRequireAdmin.mockReset();
  mockRequireAdmin.mockImplementation(async () => ({ id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN' }));
});

describe('upsertService', () => {
  it('zod: name <2 символов → throw', async () => {
    await expect(upsertService({ name: 'A' } as never)).rejects.toThrow();
  });
  it('zod: salesCommissionPercent > 100 → throw', async () => {
    await expect(upsertService({ name: 'X', salesCommissionPercent: 150 } as never))
      .rejects.toThrow();
  });
  it('создание (без id) → service.create + audit service.create', async () => {
    mockDb.service.create.mockResolvedValue({ id: 's-new' });
    const r = await upsertService({
      name: 'Карта побыту', basePrice: 5000,
      salesCommissionPercent: 5, legalCommissionPercent: 5,
    } as never);
    expect(r).toEqual({ id: 's-new' });
    expect(mockDb.service.create).toHaveBeenCalled();
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'service.create' }));
  });
  it('обновление (с id) → service.update + audit service.update + before', async () => {
    mockDb.service.findUnique.mockResolvedValue({ id: 's-1', name: 'Old', basePrice: 100 });
    mockDb.service.update.mockResolvedValue({ id: 's-1' });
    await upsertService({ id: 's-1', name: 'New', basePrice: 200 } as never);
    expect(mockDb.service.update).toHaveBeenCalled();
    const auditCall = mockAudit.mock.calls[0][0];
    expect(auditCall.action).toBe('service.update');
    expect(auditCall.before).toMatchObject({ name: 'Old' });
  });
});

describe('deleteService', () => {
  it('есть лиды → деактивация вместо удаления', async () => {
    mockDb.lead.count.mockResolvedValue(3);
    const r = await deleteService('s-1');
    expect(r).toMatchObject({ deactivated: true, leadsCount: 3 });
    expect(mockDb.service.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's-1' }, data: { isActive: false } }),
    );
    expect(mockDb.service.delete).not.toHaveBeenCalled();
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'service.deactivate' }));
  });
  it('лидов нет → реальное удаление', async () => {
    mockDb.lead.count.mockResolvedValue(0);
    await deleteService('s-1');
    expect(mockDb.service.delete).toHaveBeenCalledWith({ where: { id: 's-1' } });
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'service.delete' }));
  });
  it('не-админ → throw', async () => {
    mockRequireAdmin.mockImplementation(async () => { throw new Error('Forbidden'); });
    await expect(deleteService('s-1')).rejects.toThrow();
  });
});

describe('setCommissionStartPayment', () => {
  it('value=1 → upsert', async () => {
    await setCommissionStartPayment(1);
    expect(mockDb.setting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'commission.startFromPaymentNumber' } }),
    );
  });
  it('value=2 → upsert', async () => {
    await setCommissionStartPayment(2);
    expect(mockDb.setting.upsert).toHaveBeenCalled();
  });
  it('value=3 → throw', async () => {
    await expect(setCommissionStartPayment(3)).rejects.toThrow('Допустимые значения');
    expect(mockDb.setting.upsert).not.toHaveBeenCalled();
  });
  it('value=0 → throw', async () => {
    await expect(setCommissionStartPayment(0)).rejects.toThrow();
  });
});
