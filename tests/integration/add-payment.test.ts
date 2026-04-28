// Интеграционный тест server action addPayment.
// Prisma client замокан — проверяем именно бизнес-логику + side effects.
//
// Новая логика премий (Anna 28.04.2026):
//   - sequence=1 → SALES (менеджер продаж получает свой %)
//   - sequence=2 → LEGAL (менеджер легализации получает свой %)
//   - sequence>=3 → никаких премий
// % берётся в порядке: User.commissionPercent → Service.*CommissionPercent → 5%
import { describe, it, expect, vi, beforeEach } from 'vitest';

type AnyFn = ReturnType<typeof vi.fn>;

const mockDb = {
  lead:       { findUnique: vi.fn() as AnyFn },
  payment:    { aggregate:  vi.fn() as AnyFn, create: vi.fn() as AnyFn },
  commission: { create:     vi.fn() as AnyFn },
  leadEvent:  { create:     vi.fn() as AnyFn },
  // $transaction в проде принимает callback и передаёт tx-объект (сам по себе
  // тот же PrismaClient). В моке возвращаем mockDb — вызовы tx.* учтутся.
  $transaction: vi.fn(async (cb: (tx: typeof mockDb) => Promise<unknown>) => cb(mockDb)) as AnyFn,
};

vi.mock('@/lib/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({
    id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN',
  })),
}));
vi.mock('@/lib/permissions', () => ({
  canEditLead:           () => true,
  canTransferLead:       () => true,
  canAssignLegalManager: () => true,
  canDeletePayment:      () => true,
  assert:                (_: boolean) => {},
}));

const { addPayment } = await import('@/app/(app)/actions');

beforeEach(() => {
  mockDb.lead.findUnique.mockReset();
  mockDb.payment.aggregate.mockReset();
  mockDb.payment.create.mockReset();
  mockDb.commission.create.mockReset();
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
    salesManager: { commissionPercent: number | null } | null;
    legalManager: { commissionPercent: number | null } | null;
  }> = {}) {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'lead-1',
      salesManagerId: 'u-s',
      legalManagerId: 'u-l',
      service:      { salesCommissionPercent: 5, legalCommissionPercent: 3 },
      salesManager: { commissionPercent: null },
      legalManager: { commissionPercent: null },
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

  it('1-й платёж — премия SALES (5% по умолчанию из услуги)', async () => {
    setupLead();
    setPrevPaymentsCount(0);

    await addPayment({ leadId: 'lead-1', amount: 1000, method: 'CASH' });

    expect(mockDb.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sequence: 1 }) }),
    );
    expect(mockDb.commission.create).toHaveBeenCalledTimes(1);
    const arg = mockDb.commission.create.mock.calls[0][0];
    expect(arg.data).toMatchObject({ role: 'SALES', userId: 'u-s', percent: 5, amount: 50 });
  });

  it('2-й платёж — премия LEGAL (3% из услуги)', async () => {
    setupLead();
    setPrevPaymentsCount(1);

    await addPayment({ leadId: 'lead-1', amount: 1000, method: 'TRANSFER' });

    expect(mockDb.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sequence: 2 }) }),
    );
    expect(mockDb.commission.create).toHaveBeenCalledTimes(1);
    const arg = mockDb.commission.create.mock.calls[0][0];
    expect(arg.data).toMatchObject({ role: 'LEGAL', userId: 'u-l', percent: 3, amount: 30 });
  });

  it('3-й платёж — без премий (sequence>=3)', async () => {
    setupLead();
    setPrevPaymentsCount(2);

    await addPayment({ leadId: 'lead-1', amount: 1000, method: 'CASH' });

    expect(mockDb.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sequence: 3 }) }),
    );
    expect(mockDb.commission.create).not.toHaveBeenCalled();
  });

  it('персональный % менеджера перебивает % услуги', async () => {
    setupLead({ salesManager: { commissionPercent: 10 } });
    setPrevPaymentsCount(0);

    await addPayment({ leadId: 'lead-1', amount: 1000, method: 'CASH' });

    const arg = mockDb.commission.create.mock.calls[0][0];
    expect(arg.data).toMatchObject({ role: 'SALES', percent: 10, amount: 100 });
  });

  it('1-й платёж без SALES менеджера — премии нет', async () => {
    setupLead({ salesManagerId: null });
    setPrevPaymentsCount(0);

    await addPayment({ leadId: 'lead-1', amount: 1000, method: 'CASH' });

    expect(mockDb.commission.create).not.toHaveBeenCalled();
  });

  it('2-й платёж без LEGAL менеджера — премии нет', async () => {
    setupLead({ legalManagerId: null });
    setPrevPaymentsCount(1);

    await addPayment({ leadId: 'lead-1', amount: 1000, method: 'CASH' });

    expect(mockDb.commission.create).not.toHaveBeenCalled();
  });

  it('услуга не задана — fallback 5% по умолчанию', async () => {
    setupLead({ service: null });
    setPrevPaymentsCount(0);

    await addPayment({ leadId: 'lead-1', amount: 1000, method: 'CASH' });

    const arg = mockDb.commission.create.mock.calls[0][0];
    expect(arg.data).toMatchObject({ role: 'SALES', percent: 5, amount: 50 });
  });

  it('LeadEvent PAYMENT_ADDED создаётся всегда', async () => {
    setupLead();
    setPrevPaymentsCount(0);

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
