// POST /api/onlyoffice/callback?docId=<internalDocumentId>
// OnlyOffice вызывает этот endpoint при изменениях документа.
// Status=2 — нужно скачать обновлённый файл и сохранить.
//
// БЕЗОПАСНОСТЬ:
//  1. JWT-токен ОБЯЗАТЕЛЕН (раньше при отсутствии токена проверка пропускалась —
//     любой мог подменить документ POST'ом без auth).
//  2. body.url проверяется по hostname против белого списка (ONLYOFFICE_PUBLIC_URL
//     и APP_INTERNAL_URL) — иначе SSRF: можно было заставить скачать любой URL.
//  3. body валидируется через zod — битый JSON/левый формат не доходит до логики.
//
// 06.05.2026 — пункт #1.10 аудита: имена файлов искажались при сохранении.
// Было: doc.name.replace(/[^\\\\w\\\\s.-]/g, '_') — двойная экранировка backslash'ей
// в исходнике. На самом деле regex означал «не `\`, не `w`, не `\`, не `s`, не `.`,
// не `-`» — то есть всю кириллицу превращал в `_`. «Договор № 5.docx» → «_______».
// Плюс: doc.name уже содержит расширение, а к нему добавлялся ещё `${ext}` →
// «Договор.docx.docx» в лучшем случае.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import {
  verifyJwt, OOCallbackStatus, type OOCallbackBody,
} from '@/lib/onlyoffice';
import { downloadAndSave } from '@/lib/storage';
import { parseBody } from '@/lib/api-validation';
import { logger } from '@/lib/logger';
import path from 'node:path';

const OOCallbackSchema = z.object({
  key:    z.string().min(1).max(128).optional(),
  status: z.number().int().min(0).max(7),
  url:    z.string().url().max(4096).optional(),
  users:  z.array(z.string().max(128)).max(50).optional(),
  actions: z.array(z.object({
    type:   z.number().int(),
    userid: z.string().max(128),
  })).max(50).optional(),
  token:  z.string().max(8192).optional(),
});

function isAllowedDownloadUrl(rawUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;

  const allowedHosts = new Set<string>();
  for (const env of [
    process.env.ONLYOFFICE_PUBLIC_URL,
    process.env.ONLYOFFICE_INTERNAL_URL,
    process.env.APP_INTERNAL_URL,
    process.env.APP_PUBLIC_URL,
  ]) {
    if (!env) continue;
    try {
      allowedHosts.add(new URL(env).hostname);
    } catch {}
  }
  allowedHosts.add('onlyoffice');
  allowedHosts.add('localhost');
  allowedHosts.add('127.0.0.1');

  return allowedHosts.has(u.hostname);
}

/**
 * Безопасное имя файла для сохранения в storage.
 *
 * Разрешаем: любые Unicode-буквы (\p{L}), цифры (\p{N}), пробел, точка,
 * дефис, подчёркивание, скобки и №.
 * Запрещаем: path-сепараторы (/, \), null-byte, control chars, < > : * ? " |
 * (опасные для файловой системы Windows/Linux/path traversal).
 *
 * #1.10 аудита: до фикса было /[^\\\\w\\\\s.-]/g (двойное экранирование) —
 * regex буквально интерпретировался как «не `\`, не `w`, не `\`, не `s`,
 * не `.`, не `-`», и вся кириллица заменялась на `_`.
 */
function sanitizeFileName(name: string): string {
  // \p{L} — буквы любого алфавита (кириллица, латиница, китайские иероглифы…)
  // \p{N} — цифры
  // Флаг `u` обязателен для Unicode property escapes.
  const safe = name.replace(/[^\p{L}\p{N}\s.\-_()№]/gu, '_');
  // Сжимаем подряд идущие подчёркивания (несколько запрещённых символов
  // подряд → один `_` вместо «___»).
  return safe.replace(/_+/g, '_').trim() || 'document';
}

export async function POST(req: NextRequest) {
  try {
    const docId = req.nextUrl.searchParams.get('docId');
    if (!docId) {
      return NextResponse.json({ error: 1, message: 'docId required' }, { status: 400 });
    }

    const parsed = await parseBody(req, OOCallbackSchema);
    if (!parsed.ok) {
      return NextResponse.json({ error: 1, message: 'invalid body' }, { status: 400 });
    }
    const body = parsed.data as OOCallbackBody & { token?: string };

    const authHeader = req.headers.get('authorization') ?? '';
    const headerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const token = headerToken || body.token;

    if (!token) {
      return NextResponse.json({ error: 1, message: 'unauthorized' }, { status: 401 });
    }
    const verified = verifyJwt<OOCallbackBody>(token);
    if (!verified) {
      return NextResponse.json({ error: 1, message: 'invalid token' }, { status: 401 });
    }

    const doc = await db.internalDocument.findUnique({ where: { id: docId } });
    if (!doc) {
      return NextResponse.json({ error: 1, message: 'document not found' }, { status: 404 });
    }

    switch (body.status) {
      case OOCallbackStatus.NO_CHANGES:
      case OOCallbackStatus.EDITING: {
        break;
      }

      case OOCallbackStatus.READY_TO_SAVE:
      case OOCallbackStatus.EDITING_FORCESAVED: {
        if (!body.url) {
          return NextResponse.json({ error: 1, message: 'no url' }, { status: 400 });
        }

        if (!isAllowedDownloadUrl(body.url)) {
          logger.error('[onlyoffice/callback] rejected url:', body.url);
          return NextResponse.json({ error: 1, message: 'untrusted url' }, { status: 400 });
        }

        // #1.10 аудита: правильная конкатенация имени и расширения.
        // doc.name может быть как с расширением ("Договор.docx") так и без
        // ("Договор"). Берём базу через path.parse — она правильно отрезает
        // существующий .ext, а ext получаем из fileUrl (источник истины
        // о реальном формате файла).
        const ext = path.extname(doc.fileUrl);
        const baseName = path.parse(doc.name).name; // отрезаем существующий .ext
        const safeName = sanitizeFileName(baseName);
        const newFileName = `${safeName}${ext}`;

        const saved = await downloadAndSave(body.url, 'docs', newFileName);

        await db.$transaction(async (tx) => {
          await tx.internalDocument.create({
            data: {
              leadId:       doc.leadId,
              name:         doc.name + ` (v${doc.version})`,
              fileUrl:      doc.fileUrl,
              format:       doc.format,
              fileSize:     doc.fileSize,
              source:       doc.source,
              blueprintId:  doc.blueprintId,
              version:      doc.version,
              parentId:     doc.id,
              createdById:  doc.createdById,
              createdAt:    doc.createdAt,
            },
          });
          await tx.internalDocument.update({
            where: { id: doc.id },
            data: {
              fileUrl:  saved.url,
              fileSize: saved.size,
              version:  { increment: 1 },
            },
          });
        });

        break;
      }

      case OOCallbackStatus.CLOSED_NO_CHANGES: {
        break;
      }

      case OOCallbackStatus.SAVE_ERROR:
      case OOCallbackStatus.FORCESAVE_ERROR: {
        logger.error(`[onlyoffice] save error for doc ${docId}:`, body);
        break;
      }
    }

    return NextResponse.json({ error: 0 });
  } catch (e) {
    logger.error('[onlyoffice/callback] ', e);
    return NextResponse.json({ error: 1, message: (e as Error).message }, { status: 500 });
  }
}
