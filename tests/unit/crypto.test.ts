// Unit: src/lib/crypto.ts — AES-256-GCM шифрование
import { describe, it, expect, beforeEach } from 'vitest';
import {
  encrypt, decrypt, decryptNullable, encryptNullable, _resetKeyCacheForTests,
} from '@/lib/crypto';

// Фиксированный тестовый ключ — 32 байта в hex.
const TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

beforeEach(() => {
  process.env.ENCRYPTION_KEY = TEST_KEY;
  _resetKeyCacheForTests();
});

describe('encrypt/decrypt round-trip', () => {
  it('шифрует и расшифровывает простую строку', () => {
    const plain = 'access_token_xyz_123';
    const enc = encrypt(plain);
    expect(enc).toMatch(/^v1:[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$/);
    expect(decrypt(enc)).toBe(plain);
  });

  it('шифрует кириллицу/utf-8', () => {
    const plain = 'токен ёжик 🦔';
    expect(decrypt(encrypt(plain))).toBe(plain);
  });

  it('два вызова encrypt дают РАЗНЫЕ шифротексты (рандомный IV)', () => {
    const plain = 'same-input';
    const a = encrypt(plain);
    const b = encrypt(plain);
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(plain);
    expect(decrypt(b)).toBe(plain);
  });

  it('пустая строка тоже шифруется/расшифровывается', () => {
    expect(decrypt(encrypt(''))).toBe('');
  });
});

describe('legacy passthrough (без префикса v1:)', () => {
  it('строка без v1: возвращается как есть', () => {
    expect(decrypt('legacy_plaintext_token')).toBe('legacy_plaintext_token');
  });

  it('пустая строка без префикса — тоже passthrough', () => {
    expect(decrypt('')).toBe('');
  });
});

describe('защита от подделки', () => {
  it('подмена authTag → ошибка', () => {
    const enc = encrypt('secret');
    // Меняем последний символ tag
    const broken = enc.slice(0, -1) + (enc.slice(-1) === '0' ? '1' : '0');
    expect(() => decrypt(broken)).toThrow();
  });

  it('подмена ciphertext → ошибка', () => {
    const enc = encrypt('secret');
    const parts = enc.split(':');
    parts[2] = parts[2].slice(0, -1) + (parts[2].slice(-1) === '0' ? '1' : '0');
    expect(() => decrypt(parts.join(':'))).toThrow();
  });

  it('кривой формат → ошибка', () => {
    expect(() => decrypt('v1:not-enough-parts')).toThrow(/v1:iv:ct:tag/);
  });
});

describe('nullable хелперы', () => {
  it('decryptNullable(null) = null', () => {
    expect(decryptNullable(null)).toBeNull();
    expect(decryptNullable(undefined)).toBeNull();
  });

  it('encryptNullable(null) = undefined (для prisma data объектов)', () => {
    expect(encryptNullable(null)).toBeUndefined();
    expect(encryptNullable(undefined)).toBeUndefined();
  });

  it('decryptNullable + encrypt round-trip', () => {
    const enc = encryptNullable('hello');
    expect(enc).not.toBeUndefined();
    expect(decryptNullable(enc!)).toBe('hello');
  });
});

describe('валидация ENCRYPTION_KEY', () => {
  it('пустой ключ → ошибка с подсказкой как сгенерировать', () => {
    process.env.ENCRYPTION_KEY = '';
    _resetKeyCacheForTests();
    expect(() => encrypt('x')).toThrow(/openssl rand -hex 32/);
  });

  it('ключ неправильной длины → ошибка', () => {
    process.env.ENCRYPTION_KEY = 'abcd';
    _resetKeyCacheForTests();
    expect(() => encrypt('x')).toThrow(/64 hex-символов/);
  });
});
