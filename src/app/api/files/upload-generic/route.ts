// POST /api/files/upload-generic — загрузка произвольного файла в указанный bucket
// Используется для прикрепления сканов в Расходах (bucket=expenses).
// Не создаёт запись в БД — просто возвращает url, name, size.
// Только для админа (расходы — закрытый раздел).
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { saveBuffer, type StorageBucket } from '@/lib/storage';

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

    const buffer = Buffer.from(await file.arrayBuffer());
    const saved = await saveBuffer(bucket, buffer, file.name);

    return NextResponse.json({ url: saved.url, name: file.name, size: saved.size });
  } catch (e) {
    const status = (e as Error & { statusCode?: number }).statusCode ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
