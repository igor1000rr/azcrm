// POST /api/files/upload  — multipart/form-data
// Загрузка файла в карточку клиента (общая папка)

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { clientVisibilityFilter } from '@/lib/permissions';
import { saveBuffer } from '@/lib/storage';
import { revalidatePath } from 'next/cache';
import path from 'node:path';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 МБ

// Whitelist расширений и MIME-типов для файлов клиентов.
// Категории клиентских файлов: паспорт, контракт, фото, скан, общее.
// Разрешаем: документы, изображения, PDF. Запрещаем: исполняемые, архивы,
// HTML/JS (XSS через скачанный файл), shell-скрипты.
const ALLOWED_EXTENSIONS = new Set([
  '.pdf',
  '.doc', '.docx',
  '.xls', '.xlsx',
  '.ppt', '.pptx',
  '.txt', '.rtf',
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic', '.heif',
  '.csv',
  '.odt', '.ods',
]);

const ALLOWED_MIME_PREFIXES = [
  'image/',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.oasis.opendocument',
  'text/plain',
  'text/csv',
  'text/rtf',
  'application/rtf',
];

function isAllowedFile(name: string, mime: string): { ok: true } | { ok: false; reason: string } {
  const ext = path.extname(name).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { ok: false, reason: `Расширение ${ext || '(нет)'} не разрешено` };
  }
  // MIME может быть пустым на некоторых клиентах — тогда полагаемся только на extension
  if (mime && !ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p))) {
    return { ok: false, reason: `Тип файла ${mime} не разрешён` };
  }
  return { ok: true };
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const form = await req.formData();
    const file = form.get('file') as File | null;
    const clientId = form.get('clientId') as string | null;
    const category = (form.get('category') as string | null) ?? 'GENERAL';
    const notes    = form.get('notes') as string | null;

    if (!file || !clientId) {
      return NextResponse.json({ error: 'file and clientId required' }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'file too large (max 50 MB)' }, { status: 413 });
    }

    // Whitelist расширений и MIME — отбиваем .exe/.html/.php/.sh
    const check = isAllowedFile(file.name, file.type || '');
    if (!check.ok) {
      return NextResponse.json({ error: check.reason }, { status: 415 });
    }

    // Проверка прав: клиент должен быть видим
    const client = await db.client.findFirst({
      where: { id: clientId, ...clientVisibilityFilter(user) },
      select: { id: true },
    });
    if (!client) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const saved = await saveBuffer('uploads', buffer, file.name);

    const record = await db.clientFile.create({
      data: {
        clientId,
        name:         file.name,
        fileUrl:      saved.url,
        fileSize:     saved.size,
        mimeType:     file.type || null,
        category:     category as 'GENERAL' | 'PASSPORT' | 'CONTRACT' | 'CERTIFICATE' | 'PHOTO' | 'SCAN' | 'OTHER',
        uploadedById: user.id,
        notes:        notes || null,
      },
    });

    // Обновляем страницы где этот файл показывается
    revalidatePath(`/clients/${clientId}`);

    return NextResponse.json({
      id:       record.id,
      name:     record.name,
      url:      record.fileUrl,
      size:     record.fileSize,
      category: record.category,
    });
  } catch (e) {
    const status = (e as Error & { statusCode?: number }).statusCode ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
