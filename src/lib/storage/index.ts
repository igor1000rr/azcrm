// Локальное файловое хранилище на VPS
import { promises as fs } from 'node:fs';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const STORAGE_ROOT = process.env.STORAGE_ROOT ?? path.join(process.cwd(), 'storage');

export type StorageBucket =
  | 'uploads' | 'docs' | 'blueprints' | 'wa-media' | 'wa-sessions' | 'avatars';

export interface SavedFile {
  storedName: string;
  size: number;
  url: string;
}

export async function saveBuffer(
  bucket:    StorageBucket,
  buffer:    Buffer,
  origName:  string,
): Promise<SavedFile> {
  await ensureBucket(bucket);
  const ext = path.extname(origName).toLowerCase().slice(0, 12);
  const id  = crypto.randomBytes(16).toString('hex');
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

export async function removeFile(bucket: StorageBucket, storedName: string): Promise<void> {
  const fullPath = resolveSafe(bucket, storedName);
  if (!fullPath) return;
  try {
    await fs.unlink(fullPath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
}

export async function readFile(bucket: StorageBucket, storedName: string): Promise<Buffer> {
  const fullPath = resolveSafe(bucket, storedName);
  if (!fullPath) throw new Error('Недопустимый путь');
  return fs.readFile(fullPath);
}

export function streamFile(bucket: StorageBucket, storedName: string) {
  const fullPath = resolveSafe(bucket, storedName);
  if (!fullPath) throw new Error('Недопустимый путь');
  return createReadStream(fullPath);
}

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

async function ensureBucket(bucket: StorageBucket) {
  await fs.mkdir(path.join(STORAGE_ROOT, bucket), { recursive: true });
}

function resolveSafe(bucket: StorageBucket, storedName: string): string | null {
  if (storedName.includes('..') || storedName.startsWith('/') || storedName.includes('\0')) return null;
  const bucketRoot = path.resolve(STORAGE_ROOT, bucket);
  const full       = path.resolve(bucketRoot, storedName);
  if (!full.startsWith(bucketRoot + path.sep)) return null;
  return full;
}

export function sanitizeDownloadName(name: string): string {
  return name.replace(/[^\w\u0400-\u04FF\s.-]/g, '_').slice(0, 200);
}
