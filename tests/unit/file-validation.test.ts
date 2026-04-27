// Юнит-тесты src/lib/file-validation.ts — whitelist расширений + MIME.
//
// Цель — убедиться что отбиваются исполняемые и XSS-векторы, проходят реальные
// клиентские документы (паспорт, фото, PDF, офис-форматы).
import { describe, it, expect } from 'vitest';
import { isAllowedFile } from '@/lib/file-validation';

describe('isAllowedFile: отказы (опасные)', () => {
  it('.exe — отказ', () => {
    expect(isAllowedFile('virus.exe', 'application/x-msdownload').ok).toBe(false);
  });

  it('.html — XSS-вектор через скачивание с нашего домена', () => {
    expect(isAllowedFile('xss.html', 'text/html').ok).toBe(false);
  });

  it('.php — отказ', () => {
    expect(isAllowedFile('shell.php', 'application/x-php').ok).toBe(false);
  });

  it('.sh — отказ', () => {
    expect(isAllowedFile('exploit.sh', 'application/x-sh').ok).toBe(false);
  });

  it('.js — отказ', () => {
    expect(isAllowedFile('payload.js', 'application/javascript').ok).toBe(false);
  });

  it('.svg — отказ (может содержать инлайн JS)', () => {
    expect(isAllowedFile('img.svg', 'image/svg+xml').ok).toBe(false);
  });

  it('файл без расширения — отказ', () => {
    expect(isAllowedFile('README', '').ok).toBe(false);
  });

  it('подмена MIME (расширение .pdf, но text/html) — отказ по MIME', () => {
    const r = isAllowedFile('fake.pdf', 'text/html');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/text\/html/);
  });

  it('Reason содержит расширение в отказе', () => {
    const r = isAllowedFile('payload.exe', '');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/\.exe/);
  });
});

describe('isAllowedFile: разрешенные', () => {
  it('PDF паспорт', () => {
    expect(isAllowedFile('passport.pdf', 'application/pdf').ok).toBe(true);
  });

  it('JPEG фото', () => {
    expect(isAllowedFile('photo.jpg', 'image/jpeg').ok).toBe(true);
  });

  it('PNG скан', () => {
    expect(isAllowedFile('scan.png', 'image/png').ok).toBe(true);
  });

  it('DOCX контракт', () => {
    expect(isAllowedFile(
      'contract.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ).ok).toBe(true);
  });

  it('XLSX отчёт', () => {
    expect(isAllowedFile(
      'report.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ).ok).toBe(true);
  });

  it('HEIC (с iPhone)', () => {
    expect(isAllowedFile('IMG_1234.heic', 'image/heic').ok).toBe(true);
  });

  it('CSV', () => {
    expect(isAllowedFile('data.csv', 'text/csv').ok).toBe(true);
  });

  it('TXT', () => {
    expect(isAllowedFile('notes.txt', 'text/plain').ok).toBe(true);
  });

  it('допустимый файл без MIME (старый клиент) — проходит по ext', () => {
    expect(isAllowedFile('passport.pdf', '').ok).toBe(true);
    expect(isAllowedFile('photo.jpeg', '').ok).toBe(true);
  });

  it('CAPS в расширении — работает (lowercase normalize)', () => {
    expect(isAllowedFile('SCAN.PDF', 'application/pdf').ok).toBe(true);
    expect(isAllowedFile('Photo.JPG', 'image/jpeg').ok).toBe(true);
  });
});

describe('isAllowedFile: edge случаи', () => {
  it('двойное расширение fake.pdf.exe — смотрим на последнее (.exe блок)', () => {
    expect(isAllowedFile('fake.pdf.exe', 'application/pdf').ok).toBe(false);
  });

  it('длинное имя с валидным расширением — работает', () => {
    const longName = 'a'.repeat(150) + '.pdf';
    expect(isAllowedFile(longName, 'application/pdf').ok).toBe(true);
  });

  it('кириллица в имени', () => {
    expect(isAllowedFile('Паспорт Петров.pdf', 'application/pdf').ok).toBe(true);
  });
});
