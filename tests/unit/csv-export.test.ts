// Юнит-тесты CSV-экранирования и форматирования.
import { describe, it, expect } from 'vitest';
import { escapeCsvField, buildCsv } from '@/lib/finance/csv';

describe('escapeCsvField', () => {
  it('обычная строка — без кавычек', () => {
    expect(escapeCsvField('hello')).toBe('hello');
  });
  it('содержит ; — оборачивает в кавычки', () => {
    expect(escapeCsvField('a;b')).toBe('"a;b"');
  });
  it('содержит кавычку — удваивает', () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
  });
  it('перенос строки — оборачивает', () => {
    expect(escapeCsvField('a\nb')).toBe('"a\nb"');
  });
  it('null/undefined → пустая строка', () => {
    expect(escapeCsvField(null as unknown as string)).toBe('');
    expect(escapeCsvField(undefined as unknown as string)).toBe('');
  });
  it('число конвертируется', () => {
    expect(escapeCsvField(42)).toBe('42');
  });
});

describe('buildCsv', () => {
  it('собирает CSV с BOM и ; разделителем', () => {
    const csv = buildCsv(
      ['ID', 'Имя'],
      [['1', 'Анна'], ['2', 'Игорь']],
    );
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('ID;Имя');
    expect(csv).toContain('1;Анна');
    expect(csv).toContain('2;Игорь');
  });

  it('экранирует ячейки с ;', () => {
    const csv = buildCsv(['x'], [['a;b']]);
    expect(csv).toContain('"a;b"');
  });

  it('пустой набор строк — только заголовок', () => {
    const csv = buildCsv(['A', 'B'], []);
    expect(csv).toBe('\uFEFFA;B');
  });
});
