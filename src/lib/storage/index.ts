// Локальное файловое хранилище на VPS.
// На старте — простая запись в /storage директорию.
// Если перейдём на S3 — этот модуль это инкапсулирует.

import { promises as fs } from 'node:fs';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';

// Базовый путь хранилища. В docker — будет смонтированный volume.
const STORAGE_ROOT = process.env.STORAGE_ROOT ?? path.join(process.cwd(), 'storage');

/** Категории — корневые директории внутри STORAGE_ROOT */
export type StorageBucket =
  | 'uploads'      // пользовательские загрузки (файлы клиентов)
  | 'docs'         // внутренние документы (OnlyOffice)
  | 'blueprints'   // шаблоны .docx
  | 'wa-media'     // медиа из WhatsApp
  | 'wa-sessions'  // зашифрованные сессии whatsapp-web.js
  | 'avatars';     // аватары пользователей

export interface SavedFile {
  /** Относительный путь от bucket, который записывается в БД */
  storedName: string;
  /** Размер файла в байтах */
  size: number;
  /** Полный URL для доступа: /api/files/<bucket>/<storedName> */
  url: string;
}

/**
 * Сохранить буфер файла в storage.
 * Имя на диске будет хешировано чтобы избежать коллизий и path-traversal.
 */
export async function saveBuffer(
  bucket:    StorageBucket,
  buffer:    Buffer,
  origName:  string,
): Promise<SavedFile> {
  await ensureBucket(bucket);

  const ext = path.extname(origName).toLowerCase().slice(0, 12);
  const id  = crypto.randomBytes(16).toString('hex');
  // Каскад из 2 уровней — чтобы не плодить миллион файлов в одной папке
  const sub = `${id.slice(0, 2)}/${id.slice(2, 4)}`;
  const storedName = `${sub}/${id}${ext}`;
  const fullPath = path.join(STORAGE_ROOT, bucket, storedName);

  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, buffer);

  return {
    storedName,
    size: buffer.length,
    url:  `/api/files/${bucket}/${storedName}`,
  };
}

/** Удалить файл. Идемпотентно — не падает если файла нет. */
export async function removeFile(bucket: StorageBucket, storedName: string): Promise<void> {
  const fullPath = resolveSafe(bucket, storedName);
  if (!fullPath) return;
  try {
    await fs.unlink(fullPath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
}

/** Прочитать файл в буфер */
export async function readFile(bucket: StorageBucket, storedName: string): Promise<Buffer> {
  const fullPath = resolveSafe(bucket, storedName);
  if (!fullPath) throw new Error('Недопустимый путь');
  return fs.readFile(fullPath);
}

/** Получить ReadableStream для отдачи файла HTTP-клиенту */
export function streamFile(bucket: StorageBucket, storedName: string) {
  const fullPath = resolveSafe(bucket, storedName);
  if (!fullPath) throw new Error('Недопустимый путь');
  return createReadStream(fullPath);
}

/** Скачать файл по URL и сохранить в bucket (для OnlyOffice callback) */
export async function downloadAndSave(
  url:       string,
  bucket:    StorageBucket,
  origName:  string,
): Promise<SavedFile> {
  await ensureBucket(bucket);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Не удалось скачать: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return saveBuffer(bucket, buffer, origName);
}

/** Создаёт bucket-директорию если ещё не создана */
async function ensureBucket(bucket: StorageBucket) {
  await fs.mkdir(path.join(STORAGE_ROOT, bucket), { recursive: true });
}

/**
 * Защита от path-traversal: storedName не должен содержать '..' или абсолютных путей.
 * Возвращает абсолютный путь или null если путь подозрительный.
 */
function resolveSafe(bucket: StorageBucket, storedName: string): string | null {
  if (storedName.includes('..') || storedName.startsWith('/') || storedName.includes('\0')) {
    return null;
  }
  const bucketRoot = path.resolve(STORAGE_ROOT, bucket);
  const full       = path.resolve(bucketRoot, storedName);
  // Проверяем что результат всё ещё внутри bucketRoot
  if (!full.startsWith(bucketRoot + path.sep)) return null;
  return full;
}

/** Утилита: безопасное имя для скачивания (для Content-Disposition) */
export function sanitizeDownloadName(name: string): string {
  return name.replace(/[^\w\u0400-\u04FF\s.-]/g, '_').slice(0, 200);
}
