// Универсальные утилиты для UI и форматирования
import clsx, { type ClassValue } from 'clsx';

// Объединение Tailwind классов
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

// ====================== ДЕНЬГИ ======================

/**
 * Форматирует сумму без валюты: 12 345 или 12 345,67.
 * Копейки показываются только если они не нулевые — это важно
 * для комиссий менеджеров (часто дробные суммы вроде 61.73 zł)
 * и в то же время не засоряет KPI целыми суммами (1 000 вместо 1 000,00).
 */
export function formatMoney(value: number | { toString(): string } | null | undefined) {
  if (value == null) return '0';
  const n = typeof value === 'number' ? value : Number(value.toString());
  if (Number.isNaN(n)) return '0';
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
}

/** Форматирует с валютой: 12 345 zł */
export function formatPrice(value: number | { toString(): string } | null | undefined) {
  return `${formatMoney(value)} zł`;
}

// ====================== ДАТЫ ======================

/** ДД.ММ.ГГГГ */
export function formatDate(d: Date | string | null | undefined) {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('ru-RU', {
    day:   '2-digit',
    month: '2-digit',
    year:  'numeric',
  });
}

/** ДД.ММ ГГГГ ЧЧ:ММ */
export function formatDateTime(d: Date | string | null | undefined) {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ru-RU', {
    day:    '2-digit',
    month:  '2-digit',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  });
}

/** ЧЧ:ММ */
export function formatTime(d: Date | string | null | undefined) {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

/** Относительное время: "5 мин назад", "вчера", "3 дня назад" */
export function formatRelative(d: Date | string | null | undefined) {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '';

  const now  = Date.now();
  const diff = (now - date.getTime()) / 1000; // в секундах

  if (diff < 60) return 'только что';
  if (diff < 3600) {
    const m = Math.floor(diff / 60);
    return `${m} ${plural(m, 'мин', 'мин', 'мин')} назад`;
  }
  if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    return `${h} ${plural(h, 'час', 'часа', 'часов')} назад`;
  }
  if (diff < 86400 * 2) return 'вчера';
  if (diff < 86400 * 7) {
    const d = Math.floor(diff / 86400);
    return `${d} ${plural(d, 'день', 'дня', 'дней')} назад`;
  }
  return formatDate(date);
}

/**
 * Дни между датами (положительное число — в будущем).
 * Нормализуем -0 → 0 чтобы Object.is работал предсказуемо.
 */
export function daysUntil(d: Date | string | null | undefined): number | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  const ms = date.getTime() - Date.now();
  const days = Math.ceil(ms / (1000 * 60 * 60 * 24));
  return days === 0 ? 0 : days; // нормализация -0 → +0
}

// ====================== ЧАСОВЫЕ ПОЯСА ======================
//
// Все юзеры CRM в Польше (Europe/Warsaw, CET/CEST). ВСЕ даты
// в БД хранятся в UTC, но Anna в фильтрах вводит "с 01.05 по 31.05"
// в варшавском времени. Без явного перевода:
//   new Date("2026-05-01")           = 2026-05-01 00:00 UTC = 02:00 Warsaw
//   new Date("2026-05-31T23:59:59")  = 2026-05-31 23:59 UTC = 01:59 Warsaw 1 июня
// В итоге выборка "май" теряет первые 2 часа 1 мая и захватывает
// первые 2 часа 1 июня — финансы расходятся между /commissions и /payroll.
//
// 06.05.2026 — пункт #3 аудита. Раньше этих функций не было —
// все finance/* страницы использовали new Date(params.from) напрямую.
//
// Используем Intl.DateTimeFormat вместо хардкода +1/+2 чтобы правильно
// работало переключение CET↔CEST (последнее воскресенье марта/октября).

const WARSAW_TZ = 'Europe/Warsaw';

/**
 * Получить смещение Warsaw относительно UTC в минутах для конкретного
 * момента времени (учитывает летнее/зимнее время).
 */
function warsawOffsetMinutesAt(utcMs: number): number {
  // Форматируем время в варшавском TZ и обратно парсим как UTC —
  // разница = смещение TZ.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: WARSAW_TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = fmt.formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(
    get('year'), get('month') - 1, get('day'),
    get('hour') === 24 ? 0 : get('hour'), get('minute'), get('second'),
  );
  return Math.round((asUtc - utcMs) / 60_000);
}

/**
 * Парсит строку вида "YYYY-MM-DD" как НАЧАЛО дня в Warsaw, возвращает UTC Date.
 * Пример: parseWarsawDateStart('2026-05-01') → 2026-04-30 22:00 UTC (= 00:00 летом CEST).
 */
export function parseWarsawDateStart(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  if (!y || !m || !d) return new Date(NaN);
  // Наивная версия: предположим что "в варшаве 00:00" = UTC 00:00,
  // узнаём реальное смещение в этот момент и скорректируем.
  const naiveUtc = Date.UTC(y, m - 1, d, 0, 0, 0);
  const offsetMin = warsawOffsetMinutesAt(naiveUtc);
  return new Date(naiveUtc - offsetMin * 60_000);
}

/**
 * Парсит строку "YYYY-MM-DD" как КОНЕЦ дня (23:59:59.999) в Warsaw → UTC.
 */
export function parseWarsawDateEnd(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  if (!y || !m || !d) return new Date(NaN);
  const naiveUtc = Date.UTC(y, m - 1, d, 23, 59, 59, 999);
  const offsetMin = warsawOffsetMinutesAt(naiveUtc);
  return new Date(naiveUtc - offsetMin * 60_000);
}

/**
 * Границы текущего месяца в Warsaw → UTC. Для дефолтных фильтров.
 */
export function warsawCurrentMonthBounds(): { from: Date; to: Date } {
  const now = new Date();
  // Берём год/месяц в варшавском TZ (в полночь UTC это может быть уже следующий день).
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: WARSAW_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = fmt.formatToParts(now);
  const y = Number(parts.find((p) => p.type === 'year')!.value);
  const m = Number(parts.find((p) => p.type === 'month')!.value);
  // Последний день месяца — день 0 следующего месяца
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const fromStr = `${y}-${String(m).padStart(2, '0')}-01`;
  const toStr   = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return {
    from: parseWarsawDateStart(fromStr),
    to:   parseWarsawDateEnd(toStr),
  };
}

/**
 * Границы прошлого месяца в Warsaw → UTC.
 */
export function warsawPrevMonthBounds(): { from: Date; to: Date } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: WARSAW_TZ, year: 'numeric', month: '2-digit' });
  const parts = fmt.formatToParts(now);
  let y = Number(parts.find((p) => p.type === 'year')!.value);
  let m = Number(parts.find((p) => p.type === 'month')!.value) - 1;
  if (m === 0) { m = 12; y -= 1; }
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const fromStr = `${y}-${String(m).padStart(2, '0')}-01`;
  const toStr   = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return {
    from: parseWarsawDateStart(fromStr),
    to:   parseWarsawDateEnd(toStr),
  };
}

/**
 * Границы текущего года в Warsaw → UTC.
 */
export function warsawCurrentYearBounds(): { from: Date; to: Date } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: WARSAW_TZ, year: 'numeric' });
  const y = Number(fmt.formatToParts(now).find((p) => p.type === 'year')!.value);
  return {
    from: parseWarsawDateStart(`${y}-01-01`),
    to:   parseWarsawDateEnd(`${y}-12-31`),
  };
}

/**
 * UTC Date → "YYYY-MM-DD" в варшавском TZ.
 * Для input[type=date] в формах фильтров.
 */
export function toWarsawDateStr(d: Date): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: WARSAW_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(d); // en-CA даёт ровно "YYYY-MM-DD"
}

// ====================== ИМЕНА ======================

/** Инициалы: "Иван Петров" → "ИП", максимум 2 буквы */
export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

// ====================== ТЕЛЕФОНЫ ======================

/**
 * Нормализация номера: убираем пробелы, скобки, дефисы.
 * Возвращает в формате "+48..." (если нет +, добавляем).
 */
export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return '';
  let p = phone.replace(/[\s\-()]/g, '');
  if (!p.startsWith('+') && /^\d/.test(p)) p = '+' + p;
  return p;
}

/** Форматирование номера для отображения: "+48 731 006 935" */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const p = normalizePhone(phone);
  // PL: +48 XXX XXX XXX
  const m = p.match(/^\+48(\d{3})(\d{3})(\d{3})$/);
  if (m) return `+48 ${m[1]} ${m[2]} ${m[3]}`;
  // UA: +380 XX XXX XX XX
  const ua = p.match(/^\+380(\d{2})(\d{3})(\d{2})(\d{2})$/);
  if (ua) return `+380 ${ua[1]} ${ua[2]} ${ua[3]} ${ua[4]}`;
  // BY: +375 XX XXX-XX-XX
  const by = p.match(/^\+375(\d{2})(\d{3})(\d{2})(\d{2})$/);
  if (by) return `+375 ${by[1]} ${by[2]} ${by[3]} ${by[4]}`;
  return p;
}

// ====================== ПЛЮРАЛИЗАЦИЯ ======================

/** Русское склонение по числу: plural(n, 'товар', 'товара', 'товаров') */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10  = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

// ====================== ОБРЕЗАНИЕ ======================

export function truncate(text: string | null | undefined, len = 60): string {
  if (!text) return '';
  return text.length > len ? text.slice(0, len - 1) + '…' : text;
}

// ====================== РАЗМЕРЫ ФАЙЛОВ ======================

export function formatFileSize(bytes: number): string {
  if (!bytes) return '0 Б';
  const k = 1024;
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + units[i];
}
