// GET /api/files/<bucket>/<path...>
// Отдаёт файлы из storage. Доступ:
//  - 'avatars'                — публично (для аватарок в UI без auth)
//  - 'docs'                   — авторизация ИЛИ short-lived ooToken (для OnlyOffice)
//  - 'uploads', 'wa-media'    — авторизация + проверка владения
//      (PII клиентов: паспорта, фото из WhatsApp). ADMIN видит всё,
//      SALES/LEGAL — только файлы клиентов в своих лидах.
//  - 'blueprints', 'expenses' — только ADMIN
//
// Для OnlyOffice сервера, который ходит за файлом без сессии, поддерживается
// query-параметр ?ooToken=<JWT> — short-lived подпись на конкретный путь.

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { streamFile } from '@/lib/storage';
import { verifyFileAccessToken } from '@/lib/onlyoffice';
import { clientVisibilityFilter, leadVisibilityFilter } from '@/lib/permissions';
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

  // Только аватарки публичные. wa-media тоже требует auth — могут содержать
  // фотки паспортов клиентов, изначально предсказуемые имена.
  const isPublicBucket = bucket === 'avatars';

  // OnlyOffice сервер скачивает docs по подписанному URL без сессии.
  // Принимаем ooToken только для bucket=docs (другие — ADMIN-only).
  const ooToken = req.nextUrl.searchParams.get('ooToken');
  let allowedByOoToken = false;
  if (ooToken && bucket === 'docs') {
    const storedNameTmp = pathSegments.join('/');
    const expectedPath  = `/api/files/${bucket}/${storedNameTmp}`;
    if (verifyFileAccessToken(ooToken, expectedPath)) {
      allowedByOoToken = true;
    }
  }

  if (!isPublicBucket && !allowedByOoToken) {
    const session = await auth();
    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 });
    }
    // Админские bucket'ы — только для ADMIN
    if ((bucket === 'blueprints' || bucket === 'expenses') && session.user.role !== 'ADMIN') {
      return new NextResponse('Forbidden', { status: 403 });
    }

    // Проверка владения для bucket'ов с PII клиентов.
    // ADMIN видит всё. SALES/LEGAL — только файлы из видимых им клиентов/лидов.
    if (session.user.role !== 'ADMIN' && (bucket === 'uploads' || bucket === 'wa-media')) {
      const owns = await checkFileOwnership(
        bucket as 'uploads' | 'wa-media',
        pathSegments.join('/'),
        { id: session.user.id, role: session.user.role, email: session.user.email, name: session.user.name },
      );
      if (!owns) {
        return new NextResponse('Forbidden', { status: 403 });
      }
    }
  }

  // Защита от path-traversal
  const storedName = pathSegments.join('/');
  if (storedName.includes('..') || storedName.includes('\\0')) {
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

/**
 * Проверяет что файл принадлежит клиенту/треду, который видим текущему юзеру.
 *
 * - bucket='uploads': в БД ClientFile.fileUrl = '/api/files/uploads/<storedName>'.
 *   Файл видим, если связанный клиент проходит clientVisibilityFilter.
 *
 * - bucket='wa-media': файл видим если есть ChatMessage.mediaUrl ссылающийся
 *   на этот путь, и его ChatThread связан с видимым клиентом, ИЛИ если
 *   thread.lead проходит leadVisibilityFilter.
 *
 * Вернёт true если хоть одна связь найдена для этого юзера; false иначе.
 */
async function checkFileOwnership(
  bucket: 'uploads' | 'wa-media',
  storedName: string,
  user: { id: string; role: 'ADMIN' | 'SALES' | 'LEGAL'; email: string; name: string },
): Promise<boolean> {
  const fileUrl = `/api/files/${bucket}/${storedName}`;

  if (bucket === 'uploads') {
    // ClientFile с этим fileUrl, у которого клиент проходит фильтр видимости
    const found = await db.clientFile.findFirst({
      where: {
        fileUrl,
        client: clientVisibilityFilter(user),
      },
      select: { id: true },
    });
    return !!found;
  }

  // wa-media — медиа из чатов. Видим если:
  //   1) ChatMessage.mediaUrl == fileUrl
  //   2) thread.client проходит clientVisibilityFilter
  //      ИЛИ thread.lead проходит leadVisibilityFilter (для случая когда
  //      клиент уже отвязан — leadId на треде ещё может быть).
  const found = await db.chatMessage.findFirst({
    where: {
      mediaUrl: fileUrl,
      thread: {
        OR: [
          { client: clientVisibilityFilter(user) },
          { lead:   leadVisibilityFilter(user)   },
        ],
      },
    },
    select: { id: true },
  });
  return !!found;
}
