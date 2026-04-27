// Интеграционный тест server action addPayment.
// Prisma client замокан — проверяем именно бизнес-логику + side effects.
//
// Адаптирован под новый addPayment (db.$transaction(callback) + payment.aggregate
// вместо payment.count). $transaction в моке просто вызывает callback с тем же
// mockDb в качестве tx — этого достаточно чтобы проверить что нужные методы
// вызываются с правильными аргументами.
import { describe, it, expect, vi, beforeEach } from 'vitest';

type AnyFn = ReturnType<typeof vi.fn>;

const mockDb = {
  lead:       { findUnique: vi.fn() as AnyFn },
  payment:    { aggregate:  vi.fn() as AnyFn, create: vi.fn() as AnyFn },
  setting:    { findUnique: vi.fn() as AnyFn },
  commission: { createMany: vi.fn() as AnyFn },
  leadEvent:  { create:     vi.fn() as AnyFn },
  // $transaction в проде принимает callback и передаёт tx-объект (сам по себе
  // тот же PrismaClient). В моке возвращаем mockDb — вызовы tx.payment.create учтутся.
  $transaction: vi.fn(async (cb: (tx: typeof mockDb) => Promise<unknown>) => cb(mockDb)) as AnyFn,
};

vi.mock('@/lib/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({
    id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN',
  })),
}));

const { addPayment } = await import('@/app/(app)/actions');

beforeEach(() => {
  mockDb.lead.findUnique.mockReset();
  mockDb.payment.aggregate.mockReset();
  mockDb.payment.create.mockReset();
  mockDb.setting.findUnique.mockReset();
  mockDb.commission.createMany.mockReset();
  mockDb.leadEvent.create.mockReset();
  mockDb.$transaction.mockReset();
  // Дефолтная реализация $transaction — просто выполнить callback с mockDb в качестве tx
  mockDb.$transaction.mockImplementation(
    async (cb: (tx: typeof mockDb) => Promise<unknown>) => cb(mockDb),
  );
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

  /** Хелпер: выставить MAX(sequence) как будто было N предыдущих платежей */
  function setPrevPaymentsCount(n: number) {
    mockDb.payment.aggregate.mockResolvedValue({
      _max: { sequence: n === 0 ? null : n },
    });
  }

  it('1-й платёж — без комиссий (по дефолту startFrom=2)', async () => {
    setupLead();
    setPrevPaymentsCount(0);
    mockDb.setting.findUnique.mockResolvedValue(null);

    await addPayment({ leadId: 'lead-1', amount: 1000, method: 'CASH' });

    expect(mockDb.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sequence: 1 }) }),
    );
    expect(mockDb.commission.createMany).not.toHaveBeenCalled();
  });

  it('2-й платёж — начисление обоим менеджерам', async () => {
    setupLead();
    setPrevPaymentsCount(1);
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
    setPrevPaymentsCount(0);
    mockDb.setting.findUnique.mockResolvedValue({ value: '1' });

    await addPayment({ leadId: 'lead-1', amount: 1000, method: 'CASH' });

    expect(mockDb.commission.createMany).toHaveBeenCalled();
  });

  it('нет менеджера легализации — только SALES комиссия', async () => {
    setupLead({ legalManagerId: null });
    setPrevPaymentsCount(2);
    mockDb.setting.findUnique.mockResolvedValue(null);

    await addPayment({ leadId: 'lead-1', amount: 1000, method: 'CASH' });

    const arg = mockDb.commission.createMany.mock.calls[0][0];
    expect(arg.data).toHaveLength(1);
    expect(arg.data[0].role).toBe('SALES');
  });

  it('услуга не задана — дефолтные 5/5%', async () => {
    setupLead({ service: null });
    setPrevPaymentsCount(2);
    mockDb.setting.findUnique.mockResolvedValue(null);

    await addPayment({ leadId: 'lead-1', amount: 1000, method: 'CASH' });

    const arg = mockDb.commission.createMany.mock.calls[0][0];
    expect(arg.data[0].percent).toBe(5);
    expect(arg.data[1].percent).toBe(5);
  });

  it('LeadEvent PAYMENT_ADDED создаётся всегда', async () => {
    setupLead();
    setPrevPaymentsCount(0);
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

  it('retry на P2002: при race condition повторяет транзакцию и в итоге успевает', async () => {
    setupLead();
    setPrevPaymentsCount(0);
    mockDb.setting.findUnique.mockResolvedValue(null);

    // Первый вызов транзакции кидает P2002, второй — проходит
    let call = 0;
    mockDb.$transaction.mockImplementation(
      async (cb: (tx: typeof mockDb) => Promise<unknown>) => {
        call++;
        if (call === 1) {
          const e = new Error('Unique constraint') as Error & { code?: string };
          e.code = 'P2002';
          throw e;
        }
        return cb(mockDb);
      },
    );

    const result = await addPayment({ leadId: 'lead-1', amount: 1000, method: 'CASH' });
    expect(result).toEqual({ id: 'pay-1' });
    expect(mockDb.$transaction).toHaveBeenCalledTimes(2);
  });
});
