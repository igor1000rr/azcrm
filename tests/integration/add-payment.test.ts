// Интеграционный тест server action addPayment.
// Prisma client замокан — проверяем именно бизнес-логику + side effects.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = {
  lead: { findUnique: vi.fn() },
  payment: { count: vi.fn(), create: vi.fn() },
  setting: { findUnique: vi.fn() },
  commission: { createMany: vi.fn() },
  leadEvent: { create: vi.fn() },
};

vi.mock('@/lib/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({
    id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN',
  })),
}));

const { addPayment } = await import('@/app/(app)/actions');

beforeEach(() => {
  Object.values(mockDb).forEach((entity) => {
    Object.values(entity).forEach((fn) => (fn as { mockReset: () => void }).mockReset());
  });
});

describe('addPayment', () => {
  function setupLead(overrides: Partial<{
    salesManagerId: string | null;
    legalManagerId: string | null;
    service: { salesCommissionPercent: number; legalCommissionPercent: number } | null;
  }> = {}) {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'lead-1',
      salesManagerId: 'u-s',
      legalManagerId: 'u-l',
      service: { salesCommissionPercent: 5, legalCommissionPercent: 3 },
      ...overrides,
    });
    mockDb.payment.create.mockResolvedValue({ id: 'pay-1' });
  }

  it('1-й платёж — без комиссий (по дефолту startFrom=2)', async () => {
    setupLead();
    mockDb.payment.count.mockResolvedValue(0);
    mockDb.setting.findUnique.mockResolvedValue(null);

    await addPayment({ leadId: 'lead-1', amount: 1000, method: 'CASH' });

    expect(mockDb.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sequence: 1 }) }),
    );
    expect(mockDb.commission.createMany).not.toHaveBeenCalled();
  });

  it('2-й платёж — начисление обоим менеджерам', async () => {
    setupLead();
    mockDb.payment.count.mockResolvedValue(1);
    mockDb.setting.findUnique.mockResolvedValue(null);

    await addPayment({ leadId: 'lead-1', amount: 1000, method: 'TRANSFER' });

    expect(mockDb.commission.createMany).toHaveBeenCalledTimes(1);
    const arg = mockDb.commission.createMany.mock.calls[0][0];
    expect(arg.data).toHaveLength(2);
    expect(arg.data[0]).toMatchObject({ role: 'SALES', amount: 50, userId: 'u-s' });
    expect(arg.data[1]).toMatchObject({ role: 'LEGAL', amount: 30, userId: 'u-l' });
  });

  it('startFrom=1 → 1-й платёж тоже с комиссиями', async () => {
    setupLead();
    mockDb.payment.count.mockResolvedValue(0);
    mockDb.setting.findUnique.mockResolvedValue({ value: '1' });

    await addPayment({ leadId: 'lead-1', amount: 1000, method: 'CASH' });

    expect(mockDb.commission.createMany).toHaveBeenCalled();
  });

  it('нет менеджера легализации — только SALES комиссия', async () => {
    setupLead({ legalManagerId: null });
    mockDb.payment.count.mockResolvedValue(2);
    mockDb.setting.findUnique.mockResolvedValue(null);

    await addPayment({ leadId: 'lead-1', amount: 1000, method: 'CASH' });

    const arg = mockDb.commission.createMany.mock.calls[0][0];
    expect(arg.data).toHaveLength(1);
    expect(arg.data[0].role).toBe('SALES');
  });

  it('услуга не задана — дефолтные 5/5%', async () => {
    setupLead({ service: null });
    mockDb.payment.count.mockResolvedValue(2);
    mockDb.setting.findUnique.mockResolvedValue(null);

    await addPayment({ leadId: 'lead-1', amount: 1000, method: 'CASH' });

    const arg = mockDb.commission.createMany.mock.calls[0][0];
    expect(arg.data[0].percent).toBe(5);
    expect(arg.data[1].percent).toBe(5);
  });

  it('LeadEvent PAYMENT_ADDED создаётся всегда', async () => {
    setupLead();
    mockDb.payment.count.mockResolvedValue(0);
    mockDb.setting.findUnique.mockResolvedValue(null);

    await addPayment({ leadId: 'lead-1', amount: 500, method: 'CARD' });

    expect(mockDb.leadEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: 'PAYMENT_ADDED' }) }),
    );
  });

  it('zod валидация: amount должен быть > 0', async () => {
    await expect(addPayment({ leadId: 'lead-1', amount: 0, method: 'CASH' }))
      .rejects.toThrow();
    await expect(addPayment({ leadId: 'lead-1', amount: -100, method: 'CASH' }))
      .rejects.toThrow();
  });

  it('лид не найден → throw', async () => {
    mockDb.lead.findUnique.mockResolvedValue(null);
    await expect(addPayment({ leadId: 'no-such', amount: 100, method: 'CASH' }))
      .rejects.toThrow('Лид не найден');
  });
});
