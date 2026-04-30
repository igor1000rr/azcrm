// AES-256-GCM шифрование для чувствительных полей в БД (OAuth-токены, и т.п.).
//
// Зачем: Google access/refresh токены хранятся в User.googleAccessToken /
// googleRefreshToken. При утечке БД (бэкап стащили, дамп выложили) — без
// шифрования атакующий получит готовые токены ко всем календарям менеджеров.
// С шифрованием — нужен ENCRYPTION_KEY, который хранится только в .env.
//
// Ключ генерируется один раз и НЕ должен меняться (иначе старые записи
// нечитаемы). Для генерации: openssl rand -hex 32  (даёт 64-символьный hex,
// 32 байта = 256 бит).
//
// Формат зашифрованной строки в БД:
//   v1:<iv_hex>:<ciphertext_hex>:<authTag_hex>
// Префикс v1: позволяет сосуществовать со старыми (незашифрованными)
// записями: при чтении смотрим префикс — если v1, расшифровываем, иначе
// возвращаем как есть (плавная миграция).

import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES  = 12; // GCM рекомендует 96 бит
const KEY_BYTES = 32; // AES-256

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.ENCRYPTION_KEY ?? '';
  if (!raw) {
    throw new Error(
      'ENCRYPTION_KEY не задан в .env — генерируй: openssl rand -hex 32',
    );
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(raw, 'hex');
  } catch {
    throw new Error('ENCRYPTION_KEY должен быть hex-строкой');
  }
  if (buf.length !== KEY_BYTES) {
    throw new Error(`ENCRYPTION_KEY должен быть ${KEY_BYTES * 2} hex-символов (${KEY_BYTES} байт)`);
  }
  cachedKey = buf;
  return buf;
}

/**
 * Зашифровать строку. Результат всегда начинается с 'v1:'.
 * Идемпотентен: если на вход уже зашифрованная (с префиксом v1:) — шифруем
 * заново (получится двойное шифрование). Поэтому ВЫЗЫВАТЬ ТОЛЬКО на plaintext.
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv  = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('hex')}:${enc.toString('hex')}:${tag.toString('hex')}`;
}

/**
 * Расшифровать строку.
 * Если значение НЕ начинается с 'v1:' — считается legacy plaintext, возвращается
 * как есть (плавная миграция: старые записи в БД ещё не зашифрованы).
 * Если префикс v1:, но расшифровать не удалось (битая запись или wrong key) —
 * бросается ошибка.
 */
export function decrypt(value: string): string {
  if (!value.startsWith('v1:')) return value;
  const parts = value.split(':');
  if (parts.length !== 4) {
    throw new Error('Битый шифротекст: ожидался формат v1:iv:ct:tag');
  }
  const [, ivHex, ctHex, tagHex] = parts;
  const iv  = Buffer.from(ivHex,  'hex');
  const ct  = Buffer.from(ctHex,  'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
  return dec.toString('utf8');
}

/**
 * Хелпер: расшифровать или вернуть null. Используется когда поле в БД
 * может быть null. НЕ глотает все ошибки — если ENCRYPTION_KEY неверный
 * или запись битая, бросает (это критично — лучше упасть громко чем работать
 * с потерянными данными).
 */
export function decryptNullable(value: string | null | undefined): string | null {
  if (value == null) return null;
  return decrypt(value);
}

/** Хелпер: зашифровать или вернуть undefined (для prisma `data` объектов). */
export function encryptNullable(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  return encrypt(value);
}

/**
 * Сбросить кэш ключа — для тестов или при ротации ключа в процессе работы
 * (на практике ротация ключа без миграции данных не поддерживается).
 */
export function _resetKeyCacheForTests(): void {
  cachedKey = null;
}
