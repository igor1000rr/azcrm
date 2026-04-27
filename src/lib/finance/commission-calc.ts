// Чистые функции для расчёта комиссий — без БД, тестируются юнитами.

export type CommissionRole = 'SALES' | 'LEGAL';

export interface CommissionRow {
  paymentId:   string;
  userId:      string;
  role:        CommissionRole;
  basePayment: number;
  percent:     number;
  amount:      number;
}

/**
 * Сумма комиссии = basePayment × percent / 100, округление до копеек (2 знака).
 */
export function calcCommissionAmount(basePayment: number, percent: number): number {
  return Math.round((basePayment * percent) / 100 * 100) / 100;
}

/**
 * Начислять ли комиссию за этот платёж.
 * sequence — порядковый номер платежа (1 — предоплата, 2+ — следующие).
 * startFromN — глобальная настройка commission.startFromPaymentNumber.
 */
export function shouldCalcCommission(sequence: number, startFromN: number): boolean {
  return sequence >= startFromN;
}

/**
 * Собирает массив записей Commission для двух менеджеров (продаж/легализации).
 * Не создаёт записи если процент = 0 или менеджер не назначен.
 */
export function buildCommissionRows(input: {
  paymentId: string;
  amount:    number;
  lead: { salesManagerId: string | null; legalManagerId: string | null };
  salesPct:  number;
  legalPct:  number;
}): CommissionRow[] {
  const rows: CommissionRow[] = [];

  if (input.lead.salesManagerId && input.salesPct > 0) {
    rows.push({
      paymentId:   input.paymentId,
      userId:      input.lead.salesManagerId,
      role:        'SALES',
      basePayment: input.amount,
      percent:     input.salesPct,
      amount:      calcCommissionAmount(input.amount, input.salesPct),
    });
  }

  if (input.lead.legalManagerId && input.legalPct > 0) {
    rows.push({
      paymentId:   input.paymentId,
      userId:      input.lead.legalManagerId,
      role:        'LEGAL',
      basePayment: input.amount,
      percent:     input.legalPct,
      amount:      calcCommissionAmount(input.amount, input.legalPct),
    });
  }

  return rows;
}
