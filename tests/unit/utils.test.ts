// Юнит-тесты helper'ов src/lib/utils.ts
import { describe, it, expect } from 'vitest';
import { formatMoney, formatPhone, plural, daysUntil } from '@/lib/utils';

describe('formatMoney', () => {
  it('целое — без копеек', () => {
    const out = formatMoney(1000);
    expect(out.replace(/[\s,]/g, '')).toBe('1000');
  });
  it('копейки сохраняются если есть', () => {
    const out = formatMoney(1234.56);
    expect(out).toMatch(/1[\s,]?234[.,]56/);
  });
  it('0 → "0"', () => {
    expect(formatMoney(0).replace(/[\s,]/g, '')).toBe('0');
  });
});

describe('formatPhone', () => {
  it('форматирует польский номер', () => {
    const out = formatPhone('+48123456789');
    expect(out).toContain('+48');
    expect(out).toMatch(/\d{3}/);
  });
  it('возвращает исходник если не распознано', () => {
    expect(formatPhone('xxx')).toBeTruthy();
  });
});

describe('plural (русский)', () => {
  it('1 → one',  () => expect(plural(1, 'лид', 'лида', 'лидов')).toBe('лид'));
  it('2 → few',  () => expect(plural(2, 'лид', 'лида', 'лидов')).toBe('лида'));
  it('5 → many', () => expect(plural(5, 'лид', 'лида', 'лидов')).toBe('лидов'));
  it('11 → many', () => expect(plural(11, 'лид', 'лида', 'лидов')).toBe('лидов'));
  it('21 → one', () => expect(plural(21, 'лид', 'лида', 'лидов')).toBe('лид'));
  it('22 → few', () => expect(plural(22, 'лид', 'лида', 'лидов')).toBe('лида'));
});

describe('daysUntil', () => {
  it('сегодня → 0', () => {
    const today = new Date().toISOString();
    expect(daysUntil(today)).toBe(0);
  });
  it('завтра → 1', () => {
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    expect(daysUntil(tomorrow)).toBe(1);
  });
  it('вчера → -1', () => {
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    expect(daysUntil(yesterday)).toBe(-1);
  });
});
