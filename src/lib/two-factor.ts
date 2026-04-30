// Утилиты двухфакторной аутентификации (TOTP по RFC 6238).
//
// Алгоритм TOTP:
//   1. У юзера и сервера общий секрет (32-байтная base32-строка).
//   2. Каждые 30 секунд алгоритм вычисляет 6-значный код по HMAC-SHA1
//      от текущего timestamp / 30 + secret.
//   3. Совместим с Google Authenticator, Authy, 1Password, Microsoft
//      Authenticator — все используют один стандарт.
//
// Backup-коды:
//   На случай потери телефона генерируем 10 одноразовых кодов вида
//   XXXX-XXXX (Crockford base32, без неоднозначных символов).
//   Хеши через bcrypt — даже при leak БД коды нельзя использовать.

// ВАЖНО: используем 'crypto' а не 'node:crypto' — webpack в Next.js
// не справляется со схемой 'node:' и падает при сборке. Сам модуль
// в Node.js одинаковый, разница только в синтаксисе импорта.
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';

// Стандартные параметры — не меняй без причины:
// step=30s, digits=6, algorithm=SHA1 — то что используют все аутентификаторы.
// window=1 значит «принять код для текущего интервала ±1» — даёт ±30 секунд
// допуска для рассинхрона часов клиента/сервера.
authenticator.options = {
  step:      30,
  window:    1,
  digits:    6,
};

const ISSUER = 'AZ Group CRM';
const BACKUP_CODES_COUNT = 10;
// 8 символов из Crockford base32 без неоднозначных (I, L, O, U).
// Энтропия ~40 бит на код — больше чем достаточно для одноразовых.
const BACKUP_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Сгенерировать новый TOTP-секрет (base32, 32 символа).
 * Хранится в БД, шарится с приложением юзера через QR.
 */
export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

/**
 * Построить otpauth:// URI для генерации QR-кода.
 * Этот URI приложение распознаёт через QR и сохраняет аккаунт.
 *
 * Пример:
 *   otpauth://totp/AZ%20Group%20CRM:anna@azgroup.pl?secret=...&issuer=AZ%20Group%20CRM
 */
export function getTotpUri(secret: string, accountEmail: string): string {
  return authenticator.keyuri(accountEmail, ISSUER, secret);
}

/**
 * Сгенерировать data URL с QR-кодом для встраивания в <img src>.
 * Размер ~200x200, поля минимальные — оптимально для модалки.
 */
export async function generateQrDataUrl(uri: string): Promise<string> {
  return QRCode.toDataURL(uri, {
    width:  220,
    margin: 1,
    color:  { dark: '#1a1a1a', light: '#ffffff' },
  });
}

/**
 * Проверить TOTP-код против секрета.
 *
 * Возвращает true если код валиден в окне ±30 сек от текущего времени.
 * Тримим пробелы и удаляем все нецифры — приложение может вставить пробел
 * в середине ("123 456") а юзер скопировать как есть.
 */
export function verifyTotp(secret: string, code: string): boolean {
  if (!secret) return false;
  const cleaned = String(code).replace(/\D/g, '');
  if (cleaned.length !== 6) return false;
  try {
    return authenticator.verify({ token: cleaned, secret });
  } catch {
    return false;
  }
}

/**
 * Сгенерировать N резервных кодов формата XXXX-XXXX (8 символов через дефис).
 * Возвращает plaintext-коды — показать юзеру ОДИН раз и сохранить только хеши.
 */
export function generateBackupCodes(count = BACKUP_CODES_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = crypto.randomBytes(8);
    let chunk = '';
    for (let j = 0; j < 8; j++) {
      chunk += BACKUP_ALPHABET[bytes[j] % BACKUP_ALPHABET.length];
    }
    codes.push(`${chunk.slice(0, 4)}-${chunk.slice(4)}`);
  }
  return codes;
}

/**
 * Захешировать массив plaintext-кодов через bcrypt для хранения в БД.
 */
export async function hashBackupCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((c) => bcrypt.hash(c, 10)));
}

/**
 * Нормализовать ввод backup-кода: верхний регистр, убрать пробелы.
 * Не пересоздаём дефис — пользователь может ввести с дефисом или без.
 */
function normalizeBackupCode(input: string): string {
  return String(input).toUpperCase().replace(/[^0-9A-Z-]/g, '');
}

/**
 * Проверить input против массива хешей backup-кодов.
 * Возвращает индекс совпавшего кода (для удаления из массива в БД)
 * или -1 если ни один не подошёл.
 *
 * Перебираем все хеши последовательно — bcrypt медленный (10 раундов
 * × 10 кодов ~ 1 сек), поэтому проверяется только когда обычный TOTP
 * не подошёл (см. lib/auth.ts).
 */
export async function findBackupCodeMatch(
  hashedCodes: string[],
  input: string,
): Promise<number> {
  const normalized = normalizeBackupCode(input);
  // Backup-код имеет формат XXXX-XXXX = 9 символов с дефисом, или 8 без
  if (normalized.length < 8 || normalized.length > 9) return -1;
  // Также пробуем версию без дефиса
  const withoutDash = normalized.replace('-', '');
  if (withoutDash.length !== 8) return -1;

  for (let i = 0; i < hashedCodes.length; i++) {
    const hash = hashedCodes[i];
    // Пробуем сразу два варианта — с дефисом и без
    if (await bcrypt.compare(normalized, hash)) return i;
    if (await bcrypt.compare(`${withoutDash.slice(0, 4)}-${withoutDash.slice(4)}`, hash)) return i;
  }
  return -1;
}

/**
 * Определить тип ввода: 6-значный TOTP или 8-9 символьный backup-код.
 * Используется в auth.ts чтобы выбрать правильный метод проверки.
 */
export function isLikelyTotpCode(input: string): boolean {
  return /^\s*\d{3}\s*\d{3}\s*$/.test(input) || /^\s*\d{6}\s*$/.test(input);
}
