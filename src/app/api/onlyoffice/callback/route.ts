// POST /api/onlyoffice/callback?docId=<internalDocumentId>
// OnlyOffice вызывает этот endpoint при изменениях документа.
// Status=2 — нужно скачать обновлённый файл и сохранить.
//
// БЕЗОПАСНОСТЬ:
//  1. JWT-токен ОБЯЗАТЕЛЕН (раньше при отсутствии токена проверка пропускалась —
//     любой мог подменить документ POST'ом без auth).
//  2. body.url проверяется по hostname против белого списка (ONLYOFFICE_PUBLIC_URL
//     и APP_INTERNAL_URL) — иначе SSRF: можно было заставить скачать любой URL.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  verifyJwt, OOCallbackStatus, type OOCallbackBody,
} from '@/lib/onlyoffice';
import { downloadAndSave } from '@/lib/storage';
import path from 'node:path';

/**
 * Разрешённые источники файла OnlyOffice. Помимо публичного URL — внутренний
 * адрес app в docker-сети, потому что callback ходит изнутри.
 */
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
  // В docker-compose сервис называется 'onlyoffice' — допускаем по умолчанию
  allowedHosts.add('onlyoffice');
  allowedHosts.add('localhost');
  allowedHosts.add('127.0.0.1');

  return allowedHosts.has(u.hostname);
}

export async function POST(req: NextRequest) {
  try {
    const docId = req.nextUrl.searchParams.get('docId');
    if (!docId) {
      return NextResponse.json({ error: 1, message: 'docId required' }, { status: 400 });
    }

    const body = await req.json() as OOCallbackBody & { token?: string };

    // Токен либо в Authorization, либо в body.token. ОБЯЗАТЕЛЕН.
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

        // Защита от SSRF — URL должен быть с разрешённого OO-сервера
        if (!isAllowedDownloadUrl(body.url)) {
          console.error('[onlyoffice/callback] rejected url:', body.url);
          return NextResponse.json({ error: 1, message: 'untrusted url' }, { status: 400 });
        }

        const ext = path.extname(doc.fileUrl);
        const newFileName = `${doc.name.replace(/[^\\w\\s.-]/g, '_')}${ext}`;
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
        console.error(`[onlyoffice] save error for doc ${docId}:`, body);
        break;
      }
    }

    return NextResponse.json({ error: 0 });
  } catch (e) {
    console.error('[onlyoffice/callback] ', e);
    return NextResponse.json({ error: 1, message: (e as Error).message }, { status: 500 });
  }
}
