// Юнит-тесты математики премий менеджеров — pure-функции без БД.
//
// Логика (Anna 28.04.2026):
//   sequence=1 → SALES получает свой %
//   sequence=1 И полная оплата сразу (amount >= totalAmount) → SALES + LEGAL оба
//   sequence=2 → LEGAL получает свой %
//   sequence>=3 → ничего
//   % приоритет: User.commissionPercent → Service → 5%
import { describe, it, expect } from 'vitest';
import {
  calcCommissionAmount,
  roundMoney,
  resolveCommissionPercent,
  isFullUpfrontPayment,
  buildCommissionAccruals,
  FALLBACK_COMMISSION_PCT,
} from '@/lib/finance/commission-calc';

describe('roundMoney', () => {
  it('округляет до 2 знаков', () => {
    expect(roundMoney(123.456)).toBe(123.46);
    expect(roundMoney(123.454)).toBe(123.45);
    expect(roundMoney(0.005)).toBe(0.01);
  });
  it('целые числа остаются целыми', () => {
    expect(roundMoney(100)).toBe(100);
    expect(roundMoney(0)).toBe(0);
  });
});

describe('calcCommissionAmount', () => {
  it('5% от 1000 = 50.00', () => {
    expect(calcCommissionAmount(1000, 5)).toBe(50);
  });
  it('не теряет копейку на 1234.56 × 5% = 61.73', () => {
    expect(calcCommissionAmount(1234.56, 5)).toBe(61.73);
  });
  it('33.33 × 7% = 2.33 (округление)', () => {
    expect(calcCommissionAmount(33.33, 7)).toBe(2.33);
  });
  it('0% всегда даёт 0', () => {
    expect(calcCommissionAmount(1000, 0)).toBe(0);
    expect(calcCommissionAmount(99999, 0)).toBe(0);
  });
  it('100% от суммы даёт всю сумму', () => {
    expect(calcCommissionAmount(500, 100)).toBe(500);
  });
  it('дробный %: 5.5% от 1000 = 55', () => {
    expect(calcCommissionAmount(1000, 5.5)).toBe(55);
  });
  it('очень маленький платёж: 0.50 zł × 5% = 0.03 (округлено вверх)', () => {
    expect(calcCommissionAmount(0.5, 5)).toBe(0.03);
  });
});

describe('resolveCommissionPercent', () => {
  it('персональный % перебивает % услуги', () => {
    expect(resolveCommissionPercent({ userPct: 10, servicePct: 5 })).toBe(10);
  });
  it('если персональный null — берём услугу', () => {
    expect(resolveCommissionPercent({ userPct: null, servicePct: 7 })).toBe(7);
  });
  it('если персональный undefined — берём услугу', () => {
    expect(resolveCommissionPercent({ userPct: undefined, servicePct: 3 })).toBe(3);
  });
  it('если оба не заданы — fallback 5%', () => {
    expect(resolveCommissionPercent({ userPct: null, servicePct: null })).toBe(FALLBACK_COMMISSION_PCT);
    expect(resolveCommissionPercent({ userPct: undefined, servicePct: undefined })).toBe(5);
  });
  it('персональный 0 = "явный ноль", не fallback', () => {
    // Anna может явно поставить 0% менеджеру (например на испытательный срок)
    expect(resolveCommissionPercent({ userPct: 0, servicePct: 5 })).toBe(0);
  });
  it('% услуги 0 = "явный ноль" если персональный не задан', () => {
    expect(resolveCommissionPercent({ userPct: null, servicePct: 0 })).toBe(0);
  });
});

describe('isFullUpfrontPayment', () => {
  it('первый платёж покрывает всё → true', () => {
    expect(isFullUpfrontPayment({ sequence: 1, amount: 5000, totalAmount: 5000 })).toBe(true);
  });
  it('первый платёж переплата → true (full upfront)', () => {
    expect(isFullUpfrontPayment({ sequence: 1, amount: 5500, totalAmount: 5000 })).toBe(true);
  });
  it('первый платёж меньше суммы лида → false', () => {
    expect(isFullUpfrontPayment({ sequence: 1, amount: 2500, totalAmount: 5000 })).toBe(false);
  });
  it('второй платёж — никогда не full upfront', () => {
    expect(isFullUpfrontPayment({ sequence: 2, amount: 5000, totalAmount: 5000 })).toBe(false);
  });
  it('totalAmount=0 → false (нечего покрывать)', () => {
    expect(isFullUpfrontPayment({ sequence: 1, amount: 1000, totalAmount: 0 })).toBe(false);
  });
  it('защита от плавающей запятой: 1234.56 покрывает 1234.567', () => {
    expect(isFullUpfrontPayment({ sequence: 1, amount: 1234.56, totalAmount: 1234.567 })).toBe(true);
  });
  it('недоплата на 1 грош: 999.99 при 1000 → НЕ full upfront', () => {
    expect(isFullUpfrontPayment({ sequence: 1, amount: 999.99, totalAmount: 1001 })).toBe(false);
  });
});

describe('buildCommissionAccruals', () => {
  const baseInput = {
    salesManagerId: 'u-s',
    legalManagerId: 'u-l',
    salesPct:       5,
    legalPct:       3,
  };

  describe('обычная рассрочка (предоплата + финал)', () => {
    it('1-й платёж (предоплата) — только SALES', () => {
      const accruals = buildCommissionAccruals({
        ...baseInput,
        sequence:    1,
        amount:      2000,    // часть от 5000
        totalAmount: 5000,
      });
      expect(accruals).toHaveLength(1);
      expect(accruals[0]).toMatchObject({
        role: 'SALES', userId: 'u-s', percent: 5, amount: 100,
      });
    });

    it('2-й платёж (финал) — только LEGAL', () => {
      const accruals = buildCommissionAccruals({
        ...baseInput,
        sequence:    2,
        amount:      3000,
        totalAmount: 5000,
      });
      expect(accruals).toHaveLength(1);
      expect(accruals[0]).toMatchObject({
        role: 'LEGAL', userId: 'u-l', percent: 3, amount: 90,
      });
    });

    it('3-й платёж — нет премий (sequence>=3)', () => {
      const accruals = buildCommissionAccruals({
        ...baseInput,
        sequence:    3,
        amount:      1000,
        totalAmount: 5000,
      });
      expect(accruals).toHaveLength(0);
    });

    it('платёж #5 — тоже без премий', () => {
      const accruals = buildCommissionAccruals({
        ...baseInput,
        sequence:    5,
        amount:      500,
        totalAmount: 5000,
      });
      expect(accruals).toHaveLength(0);
    });
  });

  describe('полная оплата сразу (Anna: «вряд ли такие случаи будут, это их зп»)', () => {
    it('1-й платёж = вся сумма → SALES + LEGAL оба', () => {
      const accruals = buildCommissionAccruals({
        ...baseInput,
        sequence:    1,
        amount:      5000,
        totalAmount: 5000,
      });
      expect(accruals).toHaveLength(2);
      expect(accruals[0]).toMatchObject({ role: 'SALES', amount: 250 });   // 5000 × 5%
      expect(accruals[1]).toMatchObject({ role: 'LEGAL', amount: 150 });   // 5000 × 3%
    });

    it('переплата (платёж > totalAmount) — оба получают, % считается от платежа', () => {
      const accruals = buildCommissionAccruals({
        ...baseInput,
        sequence:    1,
        amount:      6000,    // переплатили на 1000
        totalAmount: 5000,
      });
      expect(accruals).toHaveLength(2);
      expect(accruals[0].amount).toBe(300);  // 6000 × 5% — от фактического платежа
      expect(accruals[1].amount).toBe(180);  // 6000 × 3%
    });

    it('недоплата 999.99 при totalAmount=1000 → только SALES', () => {
      const accruals = buildCommissionAccruals({
        ...baseInput,
        sequence:    1,
        amount:      950,
        totalAmount: 1000,
      });
      expect(accruals).toHaveLength(1);
      expect(accruals[0].role).toBe('SALES');
    });
  });

  describe('% = 0 (Anna может явно отключить премию)', () => {
    it('SALES % = 0 → 1-й платёж не даёт SALES', () => {
      const accruals = buildCommissionAccruals({
        ...baseInput,
        salesPct: 0,
        sequence: 1,
        amount: 1000, totalAmount: 5000,
      });
      expect(accruals).toHaveLength(0);
    });

    it('LEGAL % = 0 → 2-й платёж не даёт LEGAL', () => {
      const accruals = buildCommissionAccruals({
        ...baseInput,
        legalPct: 0,
        sequence: 2,
        amount: 3000, totalAmount: 5000,
      });
      expect(accruals).toHaveLength(0);
    });

    it('LEGAL % = 0 при полной оплате → только SALES', () => {
      const accruals = buildCommissionAccruals({
        ...baseInput,
        legalPct: 0,
        sequence: 1,
        amount: 5000, totalAmount: 5000,
      });
      expect(accruals).toHaveLength(1);
      expect(accruals[0].role).toBe('SALES');
    });

    it('SALES % = 0 при полной оплате → только LEGAL', () => {
      const accruals = buildCommissionAccruals({
        ...baseInput,
        salesPct: 0,
        sequence: 1,
        amount: 5000, totalAmount: 5000,
      });
      expect(accruals).toHaveLength(1);
      expect(accruals[0].role).toBe('LEGAL');
    });

    it('оба % = 0 → пусто даже при полной оплате', () => {
      const accruals = buildCommissionAccruals({
        ...baseInput,
        salesPct: 0, legalPct: 0,
        sequence: 1,
        amount: 5000, totalAmount: 5000,
      });
      expect(accruals).toHaveLength(0);
    });
  });

  describe('менеджер не назначен', () => {
    it('SALES не назначен → 1-й платёж без премии', () => {
      const accruals = buildCommissionAccruals({
        ...baseInput,
        salesManagerId: null,
        sequence: 1,
        amount: 1000, totalAmount: 5000,
      });
      expect(accruals).toHaveLength(0);
    });

    it('LEGAL не назначен → 2-й платёж без премии', () => {
      const accruals = buildCommissionAccruals({
        ...baseInput,
        legalManagerId: null,
        sequence: 2,
        amount: 3000, totalAmount: 5000,
      });
      expect(accruals).toHaveLength(0);
    });

    it('LEGAL не назначен при полной оплате → только SALES', () => {
      const accruals = buildCommissionAccruals({
        ...baseInput,
        legalManagerId: null,
        sequence: 1,
        amount: 5000, totalAmount: 5000,
      });
      expect(accruals).toHaveLength(1);
      expect(accruals[0].role).toBe('SALES');
    });

    it('никто не назначен → пусто', () => {
      const accruals = buildCommissionAccruals({
        ...baseInput,
        salesManagerId: null, legalManagerId: null,
        sequence: 1,
        amount: 5000, totalAmount: 5000,
      });
      expect(accruals).toHaveLength(0);
    });
  });

  describe('basePayment и percent сохраняются для аудита', () => {
    it('запись содержит исходные данные платежа', () => {
      const [accrual] = buildCommissionAccruals({
        salesManagerId: 'u-s', legalManagerId: 'u-l',
        salesPct: 7, legalPct: 0,
        sequence: 1,
        amount: 800, totalAmount: 5000,
      });
      expect(accrual).toMatchObject({
        userId:      'u-s',
        role:        'SALES',
        basePayment: 800,
        percent:     7,
        amount:      56,
      });
    });
  });
});
