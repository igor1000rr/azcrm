// Чистые функции для подсчёта рабочих часов.

const TIME_RE = /^(\d{1,2}):(\d{2})$/;

/** "HH:MM" → минут с начала суток. Бросает на невалидном формате/значении. */
export function parseTimeToMinutes(time: string): number {
  const m = TIME_RE.exec(time);
  if (!m) throw new Error(`Невалидный формат времени: ${time}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`Невалидное время: ${time}`);
  return h * 60 + min;
}

/** Часов между start и end (HH:MM). end должен быть строго после start. */
export function calcHours(start: string, end: string): number {
  const s = parseTimeToMinutes(start);
  const e = parseTimeToMinutes(end);
  if (e <= s) throw new Error('Время окончания должно быть позже начала');
  return (e - s) / 60;
}

/** Сумма часов с защитой от null/undefined. */
export function sumHours(values: Array<number | null | undefined>): number {
  return values.reduce<number>((acc, v) => acc + (v == null ? 0 : Number(v)), 0);
}
