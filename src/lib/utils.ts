// Универсальные утилиты для UI и форматирования
import clsx, { type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatMoney(value: number | { toString(): string } | null | undefined) {
  if (value == null) return '0';
  const n = typeof value === 'number' ? value : Number(value.toString());
  if (Number.isNaN(n)) return '0';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);
}

export function formatPrice(value: number | { toString(): string } | null | undefined) {
  return `${formatMoney(value)} zł`;
}

export function formatDate(d: Date | string | null | undefined) {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateTime(d: Date | string | null | undefined) {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function formatTime(d: Date | string | null | undefined) {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export function formatRelative(d: Date | string | null | undefined) {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  const now  = Date.now();
  const diff = (now - date.getTime()) / 1000;
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
    const dn = Math.floor(diff / 86400);
    return `${dn} ${plural(dn, 'день', 'дня', 'дней')} назад`;
  }
  return formatDate(date);
}

export function daysUntil(d: Date | string | null | undefined): number | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  const ms = date.getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  return name.trim().split(/\s+/).map((s) => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return '';
  let p = phone.replace(/[\s\-()]/g, '');
  if (!p.startsWith('+') && /^\d/.test(p)) p = '+' + p;
  return p;
}

export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const p = normalizePhone(phone);
  const m = p.match(/^\+48(\d{3})(\d{3})(\d{3})$/);
  if (m) return `+48 ${m[1]} ${m[2]} ${m[3]}`;
  const ua = p.match(/^\+380(\d{2})(\d{3})(\d{2})(\d{2})$/);
  if (ua) return `+380 ${ua[1]} ${ua[2]} ${ua[3]} ${ua[4]}`;
  const by = p.match(/^\+375(\d{2})(\d{3})(\d{2})(\d{2})$/);
  if (by) return `+375 ${by[1]} ${by[2]} ${by[3]} ${by[4]}`;
  return p;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10  = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

export function truncate(text: string | null | undefined, len = 60): string {
  if (!text) return '';
  return text.length > len ? text.slice(0, len - 1) + '…' : text;
}

export function formatFileSize(bytes: number): string {
  if (!bytes) return '0 Б';
  const k = 1024;
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + units[i];
}
