// GET /api/onlyoffice/config?docId=<internalDocumentId>
// Возвращает JSON-конфиг для подключения OnlyOffice editor

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { canViewLead } from '@/lib/permissions';
import { buildEditorConfig } from '@/lib/onlyoffice';

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const docId = req.nextUrl.searchParams.get('docId');
    const mode  = (req.nextUrl.searchParams.get('mode') ?? 'edit') as 'edit' | 'view';

    if (!docId) {
      return NextResponse.json({ error: 'docId required' }, { status: 400 });
    }

    const doc = await db.internalDocument.findUnique({
      where: { id: docId },
      include: {
        lead: { select: { salesManagerId: true, legalManagerId: true } },
      },
    });

    if (!doc) {
      return NextResponse.json({ error: 'document not found' }, { status: 404 });
    }
    if (!canViewLead(user, doc.lead)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    // documentKey должен меняться при изменении содержимого — иначе OO покажет кэш
    const documentKey = `${doc.id}-v${doc.version}-${doc.updatedAt.getTime()}`;

    const config = buildEditorConfig({
      documentId:  doc.id,
      documentKey,
      fileName:    doc.name,
      format:      doc.format,
      fileUrl:     doc.fileUrl,
      user:        { id: user.id, name: user.name },
      mode,
    });

    return NextResponse.json(config);
  } catch (e) {
    const status = (e as Error & { statusCode?: number }).statusCode ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
