// CSV-хелперы. UTF-8 BOM + ; разделитель — для Excel с русской локалью.
//
// 06.05.2026 — пункт #59 аудита: добавлена защита от CSV-injection.
// Excel/LibreOffice/Numbers интерпретируют ячейки начинающиеся с
// '=', '+', '-', '@', '\t', '\r' как формулы. Если злонамеренный
// клиент введёт в форме на лендинге fullName='=cmd|"/c calc"!A1',
// при экспорте лидов в Excel и открытии файла Anna запустит код
// на своей машине (DDE-injection / WEBSERVICE / IMPORTXML утечка
// данных, и т.д.).
//
// Защита: префиксуем такие ячейки одинарной кавычкой `'` — Excel
// её не отображает и не пытается интерпретировать как формулу.

/**
 * Символы которые делают ячейку «формулой» в Excel и его аналогах.
 * Если поле начинается с одного из них — префиксуем одинарной кавычкой.
 *
 * Список взят из OWASP CSV Injection Prevention Cheat Sheet.
 * Tab и CR попали потому что они могут привести к escape из ячейки
 * при импорте в некоторых версиях Excel.
 */
const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

export function escapeCsvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let s = String(value);

  // Защита от CSV-injection: если ячейка начинается с символа-формулы,
  // добавляем одинарную кавычку. Excel её не отображает, но воспринимает
  // как «это текст, не формула».
  if (s.length > 0 && FORMULA_PREFIXES.includes(s[0])) {
    s = `'${s}`;
  }

  // Стандартное CSV-экранирование: оборачиваем в кавычки если есть
  // разделитель/перенос строки/кавычка.
  if (s.includes(';') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildCsv(
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): string {
  const all = [headers, ...rows];
  const body = all.map((r) => r.map(escapeCsvField).join(';')).join('\r\n');
  return '\uFEFF' + body;
}
