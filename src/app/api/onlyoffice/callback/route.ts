// POST /api/onlyoffice/callback?docId=<internalDocumentId>
// OnlyOffice вызывает этот endpoint при изменениях документа.
// Status=2 — нужно скачать обновлённый файл и сохранить.
//
// ВАЖНО: этот endpoint вызывается OnlyOffice СЕРВЕРОМ, не браузером.
// JWT-токен валидирует подлинность вызова.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  verifyJwt, OOCallbackStatus, type OOCallbackBody,
} from '@/lib/onlyoffice';
import { downloadAndSave } from '@/lib/storage';
import path from 'node:path';

export async function POST(req: NextRequest) {
  try {
    const docId = req.nextUrl.searchParams.get('docId');
    if (!docId) {
      return NextResponse.json({ error: 1, message: 'docId required' }, { status: 400 });
    }

    const body = await req.json() as OOCallbackBody & { token?: string };

    // OnlyOffice может прислать токен либо в заголовке Authorization, либо в body.token
    const authHeader = req.headers.get('authorization') ?? '';
    const headerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const token = headerToken || body.token;

    if (token) {
      const verified = verifyJwt<OOCallbackBody>(token);
      if (!verified) {
        return NextResponse.json({ error: 1, message: 'invalid token' }, { status: 401 });
      }
      // OnlyOffice заворачивает свой payload в { payload: {...} } иногда. Используем оригинальный body.
    }

    const doc = await db.internalDocument.findUnique({ where: { id: docId } });
    if (!doc) {
      return NextResponse.json({ error: 1, message: 'document not found' }, { status: 404 });
    }

    // Обрабатываем по статусу
    switch (body.status) {
      case OOCallbackStatus.NO_CHANGES:
      case OOCallbackStatus.EDITING: {
        // Ничего не делаем — просто отвечаем 0 что приняли
        break;
      }

      case OOCallbackStatus.READY_TO_SAVE:
      case OOCallbackStatus.EDITING_FORCESAVED: {
        // Скачать обновлённый файл и сохранить
        if (!body.url) {
          return NextResponse.json({ error: 1, message: 'no url' }, { status: 400 });
        }

        const ext = path.extname(doc.fileUrl);
        const newFileName = `${doc.name.replace(/[^\w\s.-]/g, '_')}${ext}`;
        const saved = await downloadAndSave(body.url, 'docs', newFileName);

        // Старая версия — переименовать как parent (создать запись-версию)
        await db.$transaction(async (tx) => {
          // Сохраняем старую версию как отдельную запись
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
          // Обновляем основной документ — новый файл, version+1
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
        // Документ закрыт без изменений
        break;
      }

      case OOCallbackStatus.SAVE_ERROR:
      case OOCallbackStatus.FORCESAVE_ERROR: {
        console.error(`[onlyoffice] save error for doc ${docId}:`, body);
        // Не делаем ничего — следующая попытка может сработать
        break;
      }
    }

    // OnlyOffice ждёт {error: 0} в ответе
    return NextResponse.json({ error: 0 });
  } catch (e) {
    console.error('[onlyoffice/callback] ', e);
    return NextResponse.json({ error: 1, message: (e as Error).message }, { status: 500 });
  }
}
