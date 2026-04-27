// Юнит-тесты подсчёта рабочих часов
import { describe, it, expect } from 'vitest';
import { parseTimeToMinutes, calcHours, sumHours } from '@/lib/finance/work-hours';

describe('parseTimeToMinutes', () => {
  it('09:00 → 540', () => expect(parseTimeToMinutes('09:00')).toBe(540));
  it('00:00 → 0',   () => expect(parseTimeToMinutes('00:00')).toBe(0));
  it('23:59 → 1439',() => expect(parseTimeToMinutes('23:59')).toBe(1439));
  it('9:30 (одна цифра часа) → 570', () => expect(parseTimeToMinutes('9:30')).toBe(570));
  it('невалидный формат → throws', () => {
    expect(() => parseTimeToMinutes('25:00')).toThrow();
    expect(() => parseTimeToMinutes('abc')).toThrow();
    expect(() => parseTimeToMinutes('12:60')).toThrow();
  });
});

describe('calcHours', () => {
  it('09:00 — 18:00 = 9h', () => expect(calcHours('09:00', '18:00')).toBe(9));
  it('09:30 — 18:15 = 8.75h', () => expect(calcHours('09:30', '18:15')).toBe(8.75));
  it('конец равен/раньше начала → ошибка', () => {
    expect(() => calcHours('18:00', '09:00')).toThrow();
    expect(() => calcHours('09:00', '09:00')).toThrow();
  });
});

describe('sumHours', () => {
  it('суммирует Decimal-совместимые значения', () => {
    expect(sumHours([8, 8.5, 7.25])).toBe(23.75);
  });
  it('пустой массив → 0', () => {
    expect(sumHours([])).toBe(0);
  });
  it('фильтрует null/undefined', () => {
    expect(sumHours([8, null, undefined, 8] as unknown as number[])).toBe(16);
  });
});
