// POST /api/files/upload  — multipart/form-data
// Загрузка файла в карточку клиента (общая папка)

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { clientVisibilityFilter } from '@/lib/permissions';
import { saveBuffer } from '@/lib/storage';
import { isAllowedFile } from '@/lib/file-validation';
import { revalidatePath } from 'next/cache';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 МБ

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
