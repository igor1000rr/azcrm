// Парсер числовых вводов из форм. Поддерживает форматы где запятая —
// десятичный разделитель (русский, польский, белорусский — '5,5' = 5.5).
//
// Используется для парсинга процентов комиссии, цен услуг, ZUS/PIT и пр.
// Без него Number('5,5') → NaN → 0, и пользователь ловит баг "слетает %".

/**
 * Парсит число из строки или number, корректно обрабатывая запятую как
 * десятичный разделитель.
 *
 * Примеры:
 *   parseNumeric('5')     → 5
 *   parseNumeric('5.5')   → 5.5
 *   parseNumeric('5,5')   → 5.5    ← главный кейс
 *   parseNumeric(' 5 % ') → 5      ← пробелы и %
 *   parseNumeric('1 200') → 1200   ← пробел как разделитель тысяч
 *   parseNumeric('')      → null
 *   parseNumeric('abc')   → null
 *   parseNumeric(null)    → null
 *   parseNumeric(0)       → 0      ← числовой 0 != null
 *   parseNumeric(5)       → 5
 */
export function parseNumeric(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const cleaned = value
    .trim()
    .replace(/%/g, '')
    .replace(/\s+/g, '')   // убираем пробелы (в том числе как разделитель тысяч)
    .replace(',', '.');    // запятая → точка

  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;

  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

/**
 * То же что parseNumeric, но с дефолтом если не получилось распарсить.
 * parseNumericOr('5,5', 0)  → 5.5
 * parseNumericOr('abc', 5)  → 5
 * parseNumericOr('', 5)     → 5
 */
export function parseNumericOr(value: unknown, fallback: number): number {
  const parsed = parseNumeric(value);
  return parsed != null ? parsed : fallback;
}

/**
 * Парсит % (от 0 до 100). Возвращает null если не число или вне диапазона.
 * parsePercent('5,5')  → 5.5
 * parsePercent('150')  → null  (вне диапазона)
 * parsePercent('-5')   → null
 */
export function parsePercent(value: unknown): number | null {
  const num = parseNumeric(value);
  if (num == null) return null;
  if (num < 0 || num > 100) return null;
  return num;
}
