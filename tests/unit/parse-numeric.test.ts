// Юнит-тесты парсера чисел — решает баг «слетает % по премии»
// (когда Anna вводит '5,5' в форме, Number() даёт NaN, и сохраняется 0).
import { describe, it, expect } from 'vitest';
import { parseNumeric, parseNumericOr, parsePercent } from '@/lib/finance/parse-numeric';

describe('parseNumeric', () => {
  describe('целые числа', () => {
    it('строка "5" → 5', () => expect(parseNumeric('5')).toBe(5));
    it('строка "0" → 0', () => expect(parseNumeric('0')).toBe(0));
    it('строка "-5" → -5', () => expect(parseNumeric('-5')).toBe(-5));
    it('число 5 → 5', () => expect(parseNumeric(5)).toBe(5));
    it('число 0 → 0', () => expect(parseNumeric(0)).toBe(0));
  });

  describe('десятичные с точкой', () => {
    it('"5.5" → 5.5', () => expect(parseNumeric('5.5')).toBe(5.5));
    it('"0.01" → 0.01', () => expect(parseNumeric('0.01')).toBe(0.01));
    it('"123.456" → 123.456', () => expect(parseNumeric('123.456')).toBe(123.456));
  });

  describe('десятичные с запятой (главный кейс)', () => {
    it('"5,5" → 5.5 (русский/польский формат)', () => {
      expect(parseNumeric('5,5')).toBe(5.5);
    });
    it('"0,01" → 0.01', () => expect(parseNumeric('0,01')).toBe(0.01));
    it('"123,45" → 123.45', () => expect(parseNumeric('123,45')).toBe(123.45));
  });

  describe('пробелы и спецсимволы', () => {
    it('"  5  " → 5 (обрезаем пробелы)', () => expect(parseNumeric('  5  ')).toBe(5));
    it('"5 %" → 5 (символ процента)', () => expect(parseNumeric('5 %')).toBe(5));
    it('"5%" → 5', () => expect(parseNumeric('5%')).toBe(5));
    it('"1 200" → 1200 (пробел как разделитель тысяч)', () => {
      expect(parseNumeric('1 200')).toBe(1200);
    });
    it('"1 234,56" → 1234.56 (тысячи + запятая)', () => {
      expect(parseNumeric('1 234,56')).toBe(1234.56);
    });
  });

  describe('пустые/невалидные значения → null', () => {
    it('"" → null', () => expect(parseNumeric('')).toBeNull());
    it('"   " → null', () => expect(parseNumeric('   ')).toBeNull());
    it('"abc" → null', () => expect(parseNumeric('abc')).toBeNull());
    it('null → null', () => expect(parseNumeric(null)).toBeNull());
    it('undefined → null', () => expect(parseNumeric(undefined)).toBeNull());
    it('"-" один минус → null', () => expect(parseNumeric('-')).toBeNull());
    it('"." одна точка → null', () => expect(parseNumeric('.')).toBeNull());
    it('NaN число → null', () => expect(parseNumeric(NaN)).toBeNull());
    it('Infinity → null', () => expect(parseNumeric(Infinity)).toBeNull());
    it('объект → null', () => expect(parseNumeric({} as unknown)).toBeNull());
  });
});

describe('parseNumericOr', () => {
  it('возвращает значение если распарсилось', () => {
    expect(parseNumericOr('5,5', 0)).toBe(5.5);
  });
  it('возвращает fallback если не получилось', () => {
    expect(parseNumericOr('abc', 99)).toBe(99);
    expect(parseNumericOr('', 5)).toBe(5);
    expect(parseNumericOr(null, 7)).toBe(7);
  });
  it('0 НЕ становится fallback (явный ноль)', () => {
    expect(parseNumericOr('0', 5)).toBe(0);
    expect(parseNumericOr(0, 5)).toBe(0);
  });
});

describe('parsePercent', () => {
  it('обычные значения 0..100', () => {
    expect(parsePercent('0')).toBe(0);
    expect(parsePercent('5')).toBe(5);
    expect(parsePercent('100')).toBe(100);
    expect(parsePercent('5,5')).toBe(5.5);     // запятая работает
    expect(parsePercent(' 7 % ')).toBe(7);     // с символом и пробелами
  });
  it('вне диапазона → null', () => {
    expect(parsePercent('150')).toBeNull();
    expect(parsePercent('-5')).toBeNull();
    expect(parsePercent('100.01')).toBeNull();
  });
  it('невалидный ввод → null', () => {
    expect(parsePercent('')).toBeNull();
    expect(parsePercent('abc')).toBeNull();
    expect(parsePercent(null)).toBeNull();
  });
});
