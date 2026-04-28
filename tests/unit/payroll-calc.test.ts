// Юнит-тесты расчёта зарплаты — pure-функции без БД.
//
// Структура (Anna 28.04.2026):
//   Зп чистая    = ставка × часы + премия       (получает на руки)
//   Грязными свои = зп чистая + ZUS + PIT       (полная стоимость для компании)
import { describe, it, expect } from 'vitest';
import { calcPayrollRow, sumPayrollTotals } from '@/lib/finance/payroll-calc';

describe('calcPayrollRow', () => {
  it('базовый расчёт: 100 часов × 11 zł + 0 премий', () => {
    const r = calcPayrollRow({
      hourlyRate: 11, totalHours: 100, totalCommission: 0, zus: 0, pit: 0,
    });
    expect(r.ratePart).toBe(1100);
    expect(r.netTotal).toBe(1100);
    expect(r.grossTotal).toBe(1100);
  });

  it('с премиями: ставка×часы + премия = чистая', () => {
    const r = calcPayrollRow({
      hourlyRate: 15, totalHours: 160, totalCommission: 500, zus: 0, pit: 0,
    });
    expect(r.ratePart).toBe(2400);
    expect(r.netTotal).toBe(2900);   // 2400 + 500
    expect(r.grossTotal).toBe(2900); // нет налогов
  });

  it('с ZUS и PIT: грязный = чистая + zus + pit', () => {
    const r = calcPayrollRow({
      hourlyRate: 20, totalHours: 100, totalCommission: 200,
      zus: 300, pit: 150,
    });
    expect(r.ratePart).toBe(2000);
    expect(r.netTotal).toBe(2200);   // 2000 + 200
    expect(r.grossTotal).toBe(2650); // 2200 + 300 + 150
  });

  it('пример Anna из скриншота: Patia Pavel — 77 ч × 11 zł', () => {
    const r = calcPayrollRow({
      hourlyRate: 11, totalHours: 77, totalCommission: 0, zus: 0, pit: 0,
    });
    expect(r.ratePart).toBe(847);
    expect(r.netTotal).toBe(847);
    expect(r.grossTotal).toBe(847);
  });

  it('всё нули → нули', () => {
    const r = calcPayrollRow({
      hourlyRate: 0, totalHours: 0, totalCommission: 0, zus: 0, pit: 0,
    });
    expect(r).toEqual({ ratePart: 0, netTotal: 0, grossTotal: 0 });
  });

  it('только ZUS+PIT без работы (теоретически — больничный)', () => {
    const r = calcPayrollRow({
      hourlyRate: 0, totalHours: 0, totalCommission: 0, zus: 500, pit: 200,
    });
    expect(r.netTotal).toBe(0);
    expect(r.grossTotal).toBe(700);
  });

  it('округление: 16.5 zł × 7.5 ч = 123.75', () => {
    const r = calcPayrollRow({
      hourlyRate: 16.5, totalHours: 7.5, totalCommission: 0, zus: 0, pit: 0,
    });
    expect(r.ratePart).toBe(123.75);
    expect(r.netTotal).toBe(123.75);
  });

  it('защита от плавающей запятой: 0.1 + 0.2 не должно сломать', () => {
    const r = calcPayrollRow({
      hourlyRate: 0.1, totalHours: 1, totalCommission: 0.2,
      zus: 0, pit: 0,
    });
    // 0.1 × 1 = 0.1, + 0.2 = 0.3 (а не 0.30000000000000004)
    expect(r.netTotal).toBe(0.3);
  });

  it('отрицательные значения нормализуются в 0', () => {
    const r = calcPayrollRow({
      hourlyRate: -10, totalHours: -5, totalCommission: -100,
      zus: -50, pit: -20,
    });
    expect(r).toEqual({ ratePart: 0, netTotal: 0, grossTotal: 0 });
  });

  it('строка вместо числа парсится через Number()', () => {
    const r = calcPayrollRow({
      hourlyRate: '15' as unknown as number,
      totalHours: '8' as unknown as number,
      totalCommission: 0, zus: 0, pit: 0,
    });
    expect(r.ratePart).toBe(120);
  });

  it('NaN нормализуется в 0 через `|| 0`', () => {
    const r = calcPayrollRow({
      hourlyRate: NaN, totalHours: 100, totalCommission: 0,
      zus: 0, pit: 0,
    });
    expect(r.ratePart).toBe(0);
  });

  it('реалистичный кейс с польскими налогами', () => {
    // Менеджер продаж: 160 ч × 25 zł/ч + 500 zł премии, ZUS 800, PIT 300
    const r = calcPayrollRow({
      hourlyRate: 25, totalHours: 160, totalCommission: 500,
      zus: 800, pit: 300,
    });
    expect(r.ratePart).toBe(4000);     // 25 × 160
    expect(r.netTotal).toBe(4500);     // на руки
    expect(r.grossTotal).toBe(5600);   // компания платит 5600 (вкл. налоги)
  });
});

describe('sumPayrollTotals', () => {
  it('суммирует строки', () => {
    const total = sumPayrollTotals([
      { ratePart: 1000, netTotal: 1100, grossTotal: 1300 },
      { ratePart: 2000, netTotal: 2200, grossTotal: 2500 },
      { ratePart:  500, netTotal:  500, grossTotal:  600 },
    ]);
    expect(total).toEqual({
      ratePart:   3500,
      netTotal:   3800,
      grossTotal: 4400,
    });
  });

  it('пустой массив → нули', () => {
    expect(sumPayrollTotals([])).toEqual({
      ratePart: 0, netTotal: 0, grossTotal: 0,
    });
  });

  it('один элемент — возвращается как есть', () => {
    const row = { ratePart: 847, netTotal: 847, grossTotal: 847 };
    expect(sumPayrollTotals([row])).toEqual(row);
  });
});
