// DELETE /api/files/delete/<id> — удаление файла клиента
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { canViewLead } from '@/lib/permissions';
import { removeFile } from '@/lib/storage';
import { revalidatePath } from 'next/cache';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const file = await db.clientFile.findUnique({
      where: { id },
      include: {
        client: {
          include: { leads: { select: { salesManagerId: true, legalManagerId: true } } },
        },
      },
    });
    if (!file) return NextResponse.json({ error: 'not found' }, { status: 404 });

    // Должен иметь доступ хотя бы к одному лиду этого клиента
    const hasAccess = user.role === 'ADMIN'
      || file.client.leads.some((l) => canViewLead(user, l));
    if (!hasAccess) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    // Удаляем физический файл (если url начинается с /api/files/uploads/)
    const m = file.fileUrl.match(/^\/api\/files\/uploads\/(.+)$/);
    if (m) await removeFile('uploads', m[1]);

    await db.clientFile.delete({ where: { id } });

    revalidatePath(`/clients/${file.client.id}`);

    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = (e as Error & { statusCode?: number }).statusCode ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
