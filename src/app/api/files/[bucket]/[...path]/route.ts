// GET /api/files/<bucket>/<path...>
// Отдаёт файлы из storage. Доступ:
//  - 'avatars'                — публично (для аватарок в UI без auth)
//  - 'docs'                   — авторизация ИЛИ short-lived ooToken (для OnlyOffice)
//  - 'uploads', 'wa-media'    — авторизация + проверка владения,
//      ИЛИ short-lived mediaToken (для WhatsApp worker'а — он без auth
//      сессии, ему нужен токен чтобы скачать файл при отправке).
//      PII клиентов: паспорта, фото из WhatsApp. ADMIN видит всё,
//      SALES/LEGAL — только файлы клиентов в своих лидах.
//  - 'blueprints', 'expenses' — только ADMIN
//
// Для OnlyOffice сервера, который ходит за файлом без сессии, поддерживается
// query-параметр ?ooToken=<JWT> — short-lived подпись на конкретный путь.
// Для WhatsApp worker'а — аналогичный ?mediaToken=<JWT>.
//
// 06.05.2026 — фикс скачивания на ChromeOS Files API (баг Anna):
//   Раньше отдавали файл без Content-Disposition. Браузер брал имя из
//   URL (hash-имя вида '6f75c5bea08c...docx'). ChromeOS Files API при
//   сохранении такого имени бросал ошибку validatePathNameLength.
//   Теперь достаём оригинальное имя из БД и ставим RFC 5987 заголовок:
//     Content-Disposition: attachment; filename="ascii"; filename*=UTF-8''<encoded>
//   Для image/audio/video используем 'inline' (чтобы <img>/<audio>/<video>
//   продолжали работать), но с filename — при «Save as» имя будет правильное.
//   Также добавлен X-Content-Type-Options: nosniff (пункт #93 аудита) —
//   страховка от MIME-sniffing атак через подмену расширения у SVG/HTML.

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { streamFile, sanitizeDownloadName, type StorageBucket } from '@/lib/storage';
import { verifyFileAccessToken } from '@/lib/onlyoffice';
import {
  clientVisibilityFilter,
  leadVisibilityFilter,
  whatsappAccountFilter,
} from '@/lib/permissions';
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
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.mp4':  'video/mp4',
  '.mp3':  'audio/mpeg',
  '.ogg':  'audio/ogg',
  '.opus': 'audio/opus',
  '.txt':  'text/plain; charset=utf-8',
};

/**
 * Достаёт оригинальное имя файла из БД для красивого Content-Disposition.
 *
 * Файлы в storage лежат под hash-именами (см. saveBuffer в lib/storage),
 * а оригинальное имя ('Договор Иван Петров.pdf', 'Passport Yulia.jpg' и т.д.)
 * хранится в соответствующей записи БД. Без этого имени ChromeOS Files API
 * валит сохранение, и в любом случае Anna получала бы файл с неинформативным
 * именем-хешем.
 *
 * Возвращает null если запись не найдена — handler в этом случае
 * fallback'ится на последний сегмент пути (hash + расширение).
 */
async function getOriginalFileName(
  bucket: string,
  storedName: string,
): Promise<string | null> {
  const fileUrl = `/api/files/${bucket}/${storedName}`;

  if (bucket === 'uploads') {
    const f = await db.clientFile.findFirst({
      where: { fileUrl },
      select: { name: true },
    });
    return f?.name ?? null;
  }
  if (bucket === 'wa-media') {
    const m = await db.chatMessage.findFirst({
      where: { mediaUrl: fileUrl },
      select: { mediaName: true },
    });
    return m?.mediaName ?? null;
  }
  if (bucket === 'docs') {
    const d = await db.internalDocument.findFirst({
      where: { fileUrl },
      select: { name: true, format: true },
    });
    if (!d) return null;
    // name юзер мог сохранить и с расширением, и без — добавляем по format
    // только если его ещё нет
    const ext = d.format.toLowerCase();
    return d.name.toLowerCase().endsWith(`.${ext}`) ? d.name : `${d.name}.${ext}`;
  }
  if (bucket === 'blueprints') {
    const b = await db.documentBlueprint.findFirst({
      where: { fileUrl },
      select: { name: true, format: true },
    });
    if (!b) return null;
    const ext = b.format.toLowerCase();
    return b.name.toLowerCase().endsWith(`.${ext}`) ? b.name : `${b.name}.${ext}`;
  }
  if (bucket === 'expenses') {
    const e = await db.expense.findFirst({
      where: { fileUrl },
      select: { fileName: true },
    });
    return e?.fileName ?? null;
  }
  // 'avatars' — отдаём как есть (отображаются в <img>, имя не важно)
  return null;
}

/**
 * Формирует значение Content-Disposition по RFC 5987.
 *
 * Поддержка кириллицы и других не-ASCII символов в имени файла:
 *   - filename="..."         — ASCII fallback (для legacy браузеров)
 *   - filename*=UTF-8''...   — percent-encoded UTF-8 (RFC 5987, понимают все
 *                              современные браузеры включая ChromeOS Files API)
 *
 * mode='inline' — для image/audio/video чтобы <img>/<audio>/<video> работали;
 * mode='attachment' — для документов, чтобы скачивались а не открывались
 * в браузере встроенным просмотрщиком.
 */
function buildContentDisposition(
  originalName: string | null,
  fallbackName: string,
  mode: 'inline' | 'attachment',
): string {
  // Если из БД ничего не достали — используем последний сегмент storedName
  // (hash + расширение). Хуже чем оригинальное, но всё равно валидное имя.
  const raw = originalName ?? fallbackName;
  // Чистим от path-сепараторов и контрольных символов, ограничиваем длину.
  // sanitizeDownloadName из lib/storage уже умеет правильно обращаться
  // с кириллицей (regex [^\w\u0400-\u04FF\s.-]) и обрезать до 200 символов.
  const safe = sanitizeDownloadName(raw);
  // ASCII fallback — все не-printable-ASCII заменяем на '_'
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  // RFC 5987 — UTF-8 + percent-encoded
  const utf8 = encodeURIComponent(safe);
  return `${mode}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

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

  // WhatsApp worker скачивает media-файлы по подписанному URL без сессии.
  // mediaToken работает только для bucket=uploads и wa-media (PII-bucket'ы
  // которые worker'у нужны для отправки в WhatsApp). Подпись та же что
  // у ooToken — переиспользуем signFileAccessToken/verifyFileAccessToken,
  // но через отдельный query-параметр чтобы не путать семантику.
  const mediaToken = req.nextUrl.searchParams.get('mediaToken');
  let allowedByMediaToken = false;
  if (mediaToken && (bucket === 'uploads' || bucket === 'wa-media')) {
    const storedNameTmp = pathSegments.join('/');
    const expectedPath  = `/api/files/${bucket}/${storedNameTmp}`;
    if (verifyFileAccessToken(mediaToken, expectedPath)) {
      allowedByMediaToken = true;
    }
  }

  if (!isPublicBucket && !allowedByOoToken && !allowedByMediaToken) {
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

  // Достаём оригинальное имя из БД и формируем Content-Disposition.
  // Для аватарок имя в БД не нужно — отдаются inline в <img>, имя файла
  // в этом контексте никому не интересно (но всё равно ставим inline+filename
  // на случай «Save image as»).
  const originalName = await getOriginalFileName(bucket, storedName);

  // image/audio/video → 'inline' (чтобы <img>/<audio>/<video> в UI работали),
  // всё остальное (pdf, docx, xlsx, ...) → 'attachment' (принудительно
  // скачивается, не открывается во встроенном просмотрщике браузера).
  const isInlineable =
    contentType.startsWith('image/') ||
    contentType.startsWith('audio/') ||
    contentType.startsWith('video/');

  const fallbackName = path.basename(storedName) || 'file';
  const contentDisposition = buildContentDisposition(
    originalName,
    fallbackName,
    isInlineable ? 'inline' : 'attachment',
  );

  // Стримим — без полного буфера в память
  const nodeStream = streamFile(bucket as StorageBucket, storedName);
  // Конвертация Node.js stream → Web ReadableStream
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;

  return new NextResponse(webStream, {
    headers: {
      'Content-Type':            contentType,
      'Content-Length':          String(stat.size),
      'Content-Disposition':     contentDisposition,
      // X-Content-Type-Options: nosniff — пункт #93 аудита.
      // Запрещает браузеру MIME-sniffing'ом «угадывать» тип файла.
      // Защита от загрузки SVG/HTML под видом картинки и последующего
      // выполнения JS в контексте нашего домена.
      'X-Content-Type-Options':  'nosniff',
      'Cache-Control':           isPublicBucket ? 'public, max-age=3600' : 'private, no-store',
    },
  });
}

/**
 * Проверяет что файл принадлежит видимому пользователю объекту.
 *
 * - bucket='uploads': в БД ClientFile.fileUrl = '/api/files/uploads/<storedName>'.
 *   Файл видим, если связанный клиент проходит clientVisibilityFilter.
 *
 * - bucket='wa-media': файл видим если есть ChatMessage.mediaUrl ссылающийся
 *   на этот путь, и его ChatThread проходит ОДНУ ИЗ проверок:
 *     1. thread.client проходит clientVisibilityFilter (есть лид у юзера на клиенте)
 *     2. thread.lead   проходит leadVisibilityFilter   (юзер менеджер на лиде)
 *     3. thread.whatsappAccount проходит whatsappAccountFilter (юзер видит канал —
 *        свой личный или общий ownerId=null).
 *
 *   Anna 04.05.2026: «у меня документы открываются, а у заказчицы вот что:
 *   Forbidden». Корень — после отключения автосоздания лидов 01.05 webhook
 *   стал создавать только Client (без Lead). На общем канале (ownerId=null)
 *   client.ownerId тоже null. Картинка от такого клиента имеет thread без
 *   лида и без своего ownerId → checkFileOwnership пускал только ADMIN.
 *   SALES/LEGAL получали 403 даже хотя в /inbox этот thread видели через
 *   whatsappAccountFilter (общий канал).
 *
 *   Фикс: добавил третью OR-ветку — permission на media равно permission
 *   на сам канал. Если юзер видит thread в /inbox, должен видеть и media
 *   из него.
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

  // wa-media — медиа из чатов. Видим если ChatMessage.mediaUrl == fileUrl
  // и thread проходит хотя бы одну проверку доступа.
  const found = await db.chatMessage.findFirst({
    where: {
      mediaUrl: fileUrl,
      thread: {
        OR: [
          { client: clientVisibilityFilter(user) },
          { lead:   leadVisibilityFilter(user)   },
          { whatsappAccount: whatsappAccountFilter(user) },
        ],
      },
    },
    select: { id: true },
  });
  return !!found;
}
