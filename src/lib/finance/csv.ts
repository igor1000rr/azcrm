// CSV-хелперы. UTF-8 BOM + ; разделитель — для Excel с русской локалью.

export function escapeCsvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
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
