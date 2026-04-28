// Чистые функции для расчёта премий менеджеров — без БД, тестируются юнитами.
//
// Логика начисления (Anna 28.04.2026):
//   sequence=1 (предоплата) → SALES получает свой %
//   sequence=1 И полная оплата сразу (amount >= totalAmount) → SALES + LEGAL оба
//   sequence=2 (финальный платёж) → LEGAL получает свой %
//   sequence>=3 → ничего
//
// % берётся в приоритете: User.commissionPercent → Service.*CommissionPercent → 5%

export type CommissionRole = 'SALES' | 'LEGAL';

export interface CommissionAccrual {
  role:        CommissionRole;
  userId:      string;
  percent:     number;
  amount:      number;
  basePayment: number;
}

export const FALLBACK_COMMISSION_PCT = 5;

/**
 * Округление денежной суммы до 2 знаков после запятой (копейки/гроши).
 * Используем "round half away from zero" через Math.round — стандарт для бухгалтерии.
 */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Сумма премии = base × percent / 100, округление до копеек.
 * Защита от плавающей запятой: 1234.56 × 5% = 61.728 → 61.73 (а не 61.72)
 */
export function calcCommissionAmount(basePayment: number, percent: number): number {
  return roundMoney((basePayment * percent) / 100);
}

/**
 * Резолвит эффективный % комиссии по приоритету:
 *   1. Персональный % менеджера (User.commissionPercent)
 *   2. % услуги (Service.salesCommissionPercent / legalCommissionPercent)
 *   3. Дефолт 5%
 *
 * null/undefined трактуется как «не задано», 0 — как «явно ноль» (пропустить начисление).
 */
export function resolveCommissionPercent(input: {
  userPct:    number | null | undefined;
  servicePct: number | null | undefined;
}): number {
  if (input.userPct != null) return Number(input.userPct);
  if (input.servicePct != null) return Number(input.servicePct);
  return FALLBACK_COMMISSION_PCT;
}

/**
 * Определяет является ли платёж «полной оплатой сразу».
 * Это первый платёж, который покрывает всю стоимость лида (amount >= totalAmount).
 *
 * - Если totalAmount == 0 → НЕ полная оплата (нечего покрывать; например, лид без услуг).
 * - Защита от плавающей запятой: разрешаем дельту 0.01 zł.
 *   Например: totalAmount = 1234.567, amount = 1234.56 — считается полной оплатой.
 * - Переплата (amount > totalAmount) → тоже полная оплата, оба менеджера получат %
 *   с фактической суммы платежа (а не от totalAmount).
 */
export function isFullUpfrontPayment(input: {
  sequence:    number;
  amount:      number;
  totalAmount: number;
}): boolean {
  return input.sequence === 1
    && input.totalAmount > 0
    && input.amount >= input.totalAmount - 0.01;
}

/**
 * Главная функция: какие премии начислить за этот платёж.
 *
 * Возвращает массив 0..2 элементов (SALES и/или LEGAL).
 * Премия НЕ создаётся если:
 *   - менеджер не назначен на лиде
 *   - % == 0 (явно отключено)
 *   - не подходит по правилам sequence
 */
export function buildCommissionAccruals(input: {
  sequence:       number;     // порядковый номер платежа (1, 2, 3, ...)
  amount:         number;     // сумма этого платежа
  totalAmount:    number;     // полная стоимость лида
  salesManagerId: string | null;
  legalManagerId: string | null;
  salesPct:       number;
  legalPct:       number;
}): CommissionAccrual[] {
  const accruals: CommissionAccrual[] = [];
  const isFull = isFullUpfrontPayment({
    sequence:    input.sequence,
    amount:      input.amount,
    totalAmount: input.totalAmount,
  });

  // SALES — на первом платеже
  if (input.sequence === 1 && input.salesManagerId && input.salesPct > 0) {
    accruals.push({
      role:        'SALES',
      userId:      input.salesManagerId,
      percent:     input.salesPct,
      basePayment: input.amount,
      amount:      calcCommissionAmount(input.amount, input.salesPct),
    });
  }

  // LEGAL — на втором платеже ИЛИ на первом если он покрыл всё
  if (input.legalManagerId && input.legalPct > 0) {
    const shouldAccrueLegal =
      input.sequence === 2
      || (input.sequence === 1 && isFull);

    if (shouldAccrueLegal) {
      accruals.push({
        role:        'LEGAL',
        userId:      input.legalManagerId,
        percent:     input.legalPct,
        basePayment: input.amount,
        amount:      calcCommissionAmount(input.amount, input.legalPct),
      });
    }
  }

  return accruals;
}
