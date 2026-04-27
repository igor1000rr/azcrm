// Юнит-тесты математики комиссий — без БД, чистые функции.
import { describe, it, expect } from 'vitest';
import {
  calcCommissionAmount,
  shouldCalcCommission,
  buildCommissionRows,
} from '@/lib/finance/commission-calc';

describe('calcCommissionAmount', () => {
  it('5% от 1000 = 50.00', () => {
    expect(calcCommissionAmount(1000, 5)).toBe(50);
  });
  it('округление до копеек', () => {
    expect(calcCommissionAmount(333.33, 7)).toBeCloseTo(23.33, 2);
  });
  it('0% даёт 0', () => {
    expect(calcCommissionAmount(1000, 0)).toBe(0);
  });
  it('не теряет цент на 1234.56 × 5%', () => {
    expect(calcCommissionAmount(1234.56, 5)).toBe(61.73);
  });
});

describe('shouldCalcCommission', () => {
  it('по умолчанию (startFrom=2): первый платёж — без комиссии', () => {
    expect(shouldCalcCommission(1, 2)).toBe(false);
    expect(shouldCalcCommission(2, 2)).toBe(true);
    expect(shouldCalcCommission(5, 2)).toBe(true);
  });
  it('startFrom=1: всегда начисляем', () => {
    expect(shouldCalcCommission(1, 1)).toBe(true);
  });
  it('startFrom=3: 1 и 2 — нет, с 3-го — да', () => {
    expect(shouldCalcCommission(2, 3)).toBe(false);
    expect(shouldCalcCommission(3, 3)).toBe(true);
  });
});

describe('buildCommissionRows', () => {
  const baseLead = { salesManagerId: 'u-s', legalManagerId: 'u-l' };

  it('создаёт записи на обоих менеджеров если оба назначены', () => {
    const rows = buildCommissionRows({
      paymentId: 'p1', amount: 1000, lead: baseLead, salesPct: 5, legalPct: 3,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ userId: 'u-s', role: 'SALES', amount: 50 });
    expect(rows[1]).toMatchObject({ userId: 'u-l', role: 'LEGAL', amount: 30 });
  });

  it('не создаёт для роли с 0%', () => {
    const rows = buildCommissionRows({
      paymentId: 'p1', amount: 1000, lead: baseLead, salesPct: 5, legalPct: 0,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe('SALES');
  });

  it('не создаёт если нет менеджера', () => {
    const rows = buildCommissionRows({
      paymentId: 'p1', amount: 1000,
      lead: { salesManagerId: null, legalManagerId: null },
      salesPct: 5, legalPct: 5,
    });
    expect(rows).toHaveLength(0);
  });

  it('basePayment и percent сохраняются для аудита', () => {
    const [row] = buildCommissionRows({
      paymentId: 'p1', amount: 800, lead: baseLead, salesPct: 7, legalPct: 0,
    });
    expect(row).toMatchObject({
      paymentId: 'p1',
      basePayment: 800,
      percent: 7,
      amount: 56,
    });
  });
});
