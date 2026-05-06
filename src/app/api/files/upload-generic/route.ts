// POST /api/files/upload-generic — загрузка произвольного файла в указанный bucket
// Используется для прикрепления сканов в Расходах (bucket=expenses).
// Не создаёт запись в БД — просто возвращает url, name, size.
// Только для админа (расходы — закрытый раздел).
//
// 06.05.2026 — пункт #37 аудита расширен: раньше здесь вообще не было
// никакой валидации файла (только размер + bucket whitelist). Админ мог
// случайно или через XSS загрузить .exe/.html/.php в expenses bucket —
// это потенциальный RCE/XSS вектор если файл потом будет скачан
import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import { requireAdmin } from '@/lib/auth';
import { saveBuffer, type StorageBucket } from '@/lib/storage';
import { isAllowedFile, validateMagicBytes } from '@/lib/file-validation';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 МБ
const ALLOWED_BUCKETS = ['expenses'] as const satisfies readonly StorageBucket[];

function isAllowedBucket(b: string): b is (typeof ALLOWED_BUCKETS)[number] {
  return (ALLOWED_BUCKETS as readonly string[]).includes(b);
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const form = await req.formData();
    const file = form.get('file') as File | null;
    const bucketRaw = (form.get('bucket') as string | null) ?? 'expenses';

    if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 });
    if (!isAllowedBucket(bucketRaw)) {
      return NextResponse.json({ error: 'invalid bucket' }, { status: 400 });
    }
    const bucket: StorageBucket = bucketRaw;

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'file too large (max 50 MB)' }, { status: 413 });
    }

    // 1. Whitelist расширений и MIME — отбиваем .exe/.html/.php/.sh
    const check = isAllowedFile(file.name, file.type || '');
    if (!check.ok) {
      return NextResponse.json({ error: check.reason }, { status: 415 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // 2. Magic-bytes — проверка реального содержимого на
    // соответствие расширению (#37 аудита).
    const ext = path.extname(file.name).toLowerCase();
    const magicCheck = validateMagicBytes(buffer, ext);
    if (!magicCheck.ok) {
      return NextResponse.json({ error: magicCheck.reason }, { status: 415 });
    }

    const saved = await saveBuffer(bucket, buffer, file.name);

    return NextResponse.json({ url: saved.url, name: file.name, size: saved.size });
  } catch (e) {
    const status = (e as Error & { statusCode?: number }).statusCode ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
