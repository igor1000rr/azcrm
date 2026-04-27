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
