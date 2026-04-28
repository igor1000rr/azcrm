// Чистые функции для расчёта зарплаты менеджера — без БД, тестируются юнитами.
//
// Структура зарплаты (Anna 28.04.2026):
//   Зп чистая    = ставка × часы + премия       (получает на руки)
//   Грязными свои = зп чистая + ZUS + PIT       (полная стоимость для компании)
//
// ZUS — польский соцстрах, PIT — польский подоходный налог.
// Anna вводит ZUS и PIT вручную в карточке сотрудника, ставка/час тоже.
// Часы и премия берутся автоматически из табеля и таблицы premium-начислений.

import { roundMoney } from './commission-calc';

export interface PayrollCalcInput {
  hourlyRate:      number;  // ставка за час, zł
  totalHours:      number;  // часы из табеля за период
  totalCommission: number;  // сумма всех премий менеджера за период
  zus:             number;  // ZUS (ввод Anna)
  pit:             number;  // PIT (ввод Anna)
}

export interface PayrollCalcResult {
  ratePart:   number;  // ставка × часы
  netTotal:   number;  // зп чистая = ratePart + commission
  grossTotal: number;  // грязными свои = net + zus + pit
}

/**
 * Расчёт строки зарплаты менеджера.
 *
 * Все входы должны быть >= 0 (отрицательных значений не ожидается; если пришли —
 * нормализуем в 0 чтобы не получить отрицательную зарплату).
 */
export function calcPayrollRow(input: PayrollCalcInput): PayrollCalcResult {
  const rate       = Math.max(0, Number(input.hourlyRate)      || 0);
  const hours      = Math.max(0, Number(input.totalHours)      || 0);
  const commission = Math.max(0, Number(input.totalCommission) || 0);
  const zus        = Math.max(0, Number(input.zus)             || 0);
  const pit        = Math.max(0, Number(input.pit)             || 0);

  const ratePart   = roundMoney(rate * hours);
  const netTotal   = roundMoney(ratePart + commission);
  const grossTotal = roundMoney(netTotal + zus + pit);

  return { ratePart, netTotal, grossTotal };
}

/**
 * Сумма по всем строкам — для итогового KPI «чистый ФОТ».
 * Складывает уже округлённые значения; если нужна точность — считай заново.
 */
export function sumPayrollTotals(rows: PayrollCalcResult[]): {
  ratePart:   number;
  netTotal:   number;
  grossTotal: number;
} {
  return rows.reduce(
    (acc, r) => ({
      ratePart:   roundMoney(acc.ratePart   + r.ratePart),
      netTotal:   roundMoney(acc.netTotal   + r.netTotal),
      grossTotal: roundMoney(acc.grossTotal + r.grossTotal),
    }),
    { ratePart: 0, netTotal: 0, grossTotal: 0 },
  );
}
