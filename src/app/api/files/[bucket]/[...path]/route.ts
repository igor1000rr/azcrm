// GET /api/files/<bucket>/<path...>
// Отдаёт файлы из storage. Доступ:
//  - 'docs' и 'uploads' — нужна авторизация (внутренние документы и файлы клиентов)
//  - 'avatars', 'wa-media' — публично (для отображения в UI без auth)
//  - 'blueprints', 'expenses' — только ADMIN

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { streamFile } from '@/lib/storage';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

const STORAGE_ROOT = process.env.STORAGE_ROOT ?? path.join(process.cwd(), 'storage');

// MIME-типы для частых расширений
const MIME_TYPES: Record<string, string> = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.pdf':  'application/pdf',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
  '.mp4':  'video/mp4',
  '.mp3':  'audio/mpeg',
  '.ogg':  'audio/ogg',
  '.opus': 'audio/opus',
  '.txt':  'text/plain; charset=utf-8',
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ bucket: string; path: string[] }> },
) {
  const { bucket, path: pathSegments } = await params;

  // Проверка bucket
  const allowed = ['uploads', 'docs', 'blueprints', 'wa-media', 'avatars', 'expenses'];
  if (!allowed.includes(bucket)) {
    return new NextResponse('Not found', { status: 404 });
  }

  // Проверка прав
  const isPublicBucket = bucket === 'avatars' || bucket === 'wa-media';
  if (!isPublicBucket) {
    const session = await auth();
    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 });
    }
    // Админские bucket'ы — только для ADMIN
    if ((bucket === 'blueprints' || bucket === 'expenses') && session.user.role !== 'ADMIN') {
      return new NextResponse('Forbidden', { status: 403 });
    }
  }

  // Защита от path-traversal
  const storedName = pathSegments.join('/');
  if (storedName.includes('..') || storedName.includes('\0')) {
    return new NextResponse('Bad request', { status: 400 });
  }

  // Существование
  const fullPath = path.resolve(STORAGE_ROOT, bucket, storedName);
  const bucketRoot = path.resolve(STORAGE_ROOT, bucket);
  if (!fullPath.startsWith(bucketRoot + path.sep)) {
    return new NextResponse('Bad request', { status: 400 });
  }

  let stat;
  try {
    stat = await fs.stat(fullPath);
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }

  const ext = path.extname(storedName).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';

  // Стримим — без полного буфера в память
  const nodeStream = streamFile(bucket as 'docs', storedName);
  // Конвертация Node.js stream → Web ReadableStream
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;

  return new NextResponse(webStream, {
    headers: {
      'Content-Type':   contentType,
      'Content-Length': String(stat.size),
      'Cache-Control':  isPublicBucket ? 'public, max-age=3600' : 'private, no-store',
    },
  });
}
