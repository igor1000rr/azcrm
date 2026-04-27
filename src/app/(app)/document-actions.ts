'use server';

// Server Actions для внутренних документов (OnlyOffice) и шаблонов

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireUser, requireAdmin } from '@/lib/auth';
import { canEditLead, assert } from '@/lib/permissions';
import { saveBuffer, removeFile } from '@/lib/storage';
import { renderBlueprint } from '@/lib/docx-templates';
import path from 'node:path';
import fs from 'node:fs/promises';

// ============================================================
// СОЗДАНИЕ НОВОГО ПУСТОГО ДОКУМЕНТА (OnlyOffice стартует с blank)
// ============================================================

const createBlankSchema = z.object({
  leadId: z.string(),
  name:   z.string().min(1).max(200),
  format: z.enum(['DOCX', 'XLSX', 'PPTX']).default('DOCX'),
});

/**
 * Создаёт пустой документ. Берётся "blank.docx" / "blank.xlsx" из storage/blueprints/_blank/
 * Если шаблона нет — создаётся минимальный валидный пустой docx программно.
 */
export async function createBlankDocument(input: z.infer<typeof createBlankSchema>) {
  const user = await requireUser();
  const data = createBlankSchema.parse(input);

  const lead = await db.lead.findUnique({
    where: { id: data.leadId },
    select: { id: true, salesManagerId: true, legalManagerId: true },
  });
  if (!lead) throw new Error('Лид не найден');
  assert(canEditLead(user, lead));

  const buffer = await getBlankBuffer(data.format);
  const fileName = data.name.endsWith(`.${data.format.toLowerCase()}`)
    ? data.name
    : `${data.name}.${data.format.toLowerCase()}`;

  const saved = await saveBuffer('docs', buffer, fileName);

  const doc = await db.internalDocument.create({
    data: {
      leadId:      data.leadId,
      name:        fileName,
      fileUrl:     saved.url,
      format:      data.format,
      fileSize:    saved.size,
      source:      'BLANK',
      createdById: user.id,
    },
  });

  await db.leadEvent.create({
    data: {
      leadId:   data.leadId,
      authorId: user.id,
      kind:     'DOCUMENT_UPLOADED',
      message:  `Создан документ: ${fileName}`,
    },
  });

  revalidatePath(`/clients/${data.leadId}`);
  return { id: doc.id };
}

// ============================================================
// СОЗДАНИЕ ИЗ ШАБЛОНА
// ============================================================

const createFromBlueprintSchema = z.object({
  leadId:      z.string(),
  blueprintId: z.string(),
  customName:  z.string().optional(),
});

export async function createDocumentFromBlueprint(
  input: z.infer<typeof createFromBlueprintSchema>,
) {
  const user = await requireUser();
  const data = createFromBlueprintSchema.parse(input);

  const lead = await db.lead.findUnique({
    where: { id: data.leadId },
    include: {
      client: true,
      funnel: { select: { name: true } },
      stage:  { select: { name: true } },
      city:   { select: { name: true } },
      salesManager: { select: { name: true } },
      legalManager: { select: { name: true } },
    },
  });
  if (!lead) throw new Error('Лид не найден');
  assert(canEditLead(user, lead));

  const blueprint = await db.documentBlueprint.findUnique({
    where: { id: data.blueprintId },
  });
  if (!blueprint || !blueprint.isActive) throw new Error('Шаблон не найден');

  // Контекст для подстановки
  const ctx = buildTemplateContext(lead, user);

  // Генерируем .docx из шаблона
  const rendered = await renderBlueprint(blueprint.fileUrl, ctx);

  const fileName = data.customName ?? `${blueprint.name} — ${lead.client.fullName}.docx`;
  const saved = await saveBuffer('docs', rendered, fileName);

  const doc = await db.internalDocument.create({
    data: {
      leadId:      data.leadId,
      name:        fileName,
      fileUrl:     saved.url,
      format:      blueprint.format,
      fileSize:    saved.size,
      source:      'TEMPLATE',
      blueprintId: blueprint.id,
      createdById: user.id,
    },
  });

  await db.leadEvent.create({
    data: {
      leadId:   data.leadId,
      authorId: user.id,
      kind:     'DOCUMENT_UPLOADED',
      message:  `Создан из шаблона: ${blueprint.name}`,
    },
  });

  revalidatePath(`/clients/${data.leadId}`);
  return { id: doc.id };
}

// ============================================================
// ЗАГРУЗКА СУЩЕСТВУЮЩЕГО (uploaded buffer)
// ============================================================

export async function uploadInternalDocument(
  leadId:   string,
  buffer:   Buffer,
  origName: string,
) {
  const user = await requireUser();
  const lead = await db.lead.findUnique({
    where: { id: leadId },
    select: { id: true, salesManagerId: true, legalManagerId: true },
  });
  if (!lead) throw new Error('Лид не найден');
  assert(canEditLead(user, lead));

  const ext = path.extname(origName).toLowerCase().slice(1);
  const formatMap: Record<string, 'DOCX' | 'XLSX' | 'PPTX' | 'PDF'> = {
    docx: 'DOCX', xlsx: 'XLSX', pptx: 'PPTX', pdf: 'PDF',
  };
  const format = formatMap[ext];
  if (!format) throw new Error('Поддерживаются только DOCX, XLSX, PPTX, PDF');

  const saved = await saveBuffer('docs', buffer, origName);

  const doc = await db.internalDocument.create({
    data: {
      leadId, name: origName,
      fileUrl: saved.url, fileSize: saved.size,
      format, source: 'UPLOAD', createdById: user.id,
    },
  });

  revalidatePath(`/clients/${leadId}`);
  return { id: doc.id };
}

// ============================================================
// УДАЛЕНИЕ
// ============================================================

export async function deleteInternalDocument(id: string) {
  const user = await requireUser();

  const doc = await db.internalDocument.findUnique({
    where: { id },
    include: {
      lead:    { select: { salesManagerId: true, legalManagerId: true } },
      versions: true,
    },
  });
  if (!doc) throw new Error('Документ не найден');
  assert(canEditLead(user, doc.lead));

  // Удаляем все физические файлы (текущий + версии)
  await Promise.all([
    deletePhysicalFile(doc.fileUrl),
    ...doc.versions.map((v) => deletePhysicalFile(v.fileUrl)),
  ]);

  // Удаляем все версии и сам документ
  await db.$transaction([
    db.internalDocument.deleteMany({ where: { parentId: doc.id } }),
    db.internalDocument.delete({ where: { id: doc.id } }),
  ]);

  revalidatePath(`/clients/${doc.leadId}`);
  return { ok: true };
}

// ============================================================
// УПРАВЛЕНИЕ ШАБЛОНАМИ (admin)
// ============================================================

export async function uploadBlueprint(
  buffer: Buffer,
  name: string,
  description: string | null,
  origFileName: string,
) {
  await requireAdmin();

  const ext = path.extname(origFileName).toLowerCase();
  if (ext !== '.docx') throw new Error('Поддерживается только DOCX');

  const saved = await saveBuffer('blueprints', buffer, origFileName);

  // Извлекаем плейсхолдеры из шаблона для подсказки в UI
  const { extractPlaceholders } = await import('@/lib/docx-templates');
  const placeholders = await extractPlaceholders(saved.url);

  const blueprint = await db.documentBlueprint.create({
    data: {
      name,
      description,
      fileUrl:     saved.url,
      format:      'DOCX',
      placeholders,
      isActive:    true,
    },
  });

  revalidatePath('/settings/blueprints');
  return { id: blueprint.id };
}

export async function deleteBlueprint(id: string) {
  await requireAdmin();

  const bp = await db.documentBlueprint.findUnique({ where: { id } });
  if (!bp) throw new Error('Не найдено');

  await deletePhysicalFile(bp.fileUrl);
  await db.documentBlueprint.delete({ where: { id } });

  revalidatePath('/settings/blueprints');
  return { ok: true };
}

// ============================================================
// ВСПОМОГАТЕЛЬНЫЕ
// ============================================================

async function deletePhysicalFile(url: string) {
  // /api/files/<bucket>/<storedName>
  const m = url.match(/^\/api\/files\/([^/]+)\/(.+)$/);
  if (!m) return;
  const bucket = m[1] as 'docs' | 'blueprints' | 'uploads';
  const storedName = m[2];
  await removeFile(bucket, storedName);
}

/** Контекст для подстановки в шаблоны */
function buildTemplateContext(
  lead: {
    client: { fullName: string; birthDate: Date | null; nationality: string | null;
              phone: string; email: string | null; addressPL: string | null;
              addressHome: string | null };
    funnel: { name: string };
    stage:  { name: string };
    city:   { name: string } | null;
    salesManager: { name: string } | null;
    legalManager: { name: string } | null;
    totalAmount:  unknown;
    fingerprintDate:     Date | null;
    fingerprintLocation: string | null;
    attorney: string | null;
    summary:  string | null;
    createdAt: Date;
  },
  user: { name: string; email: string },
) {
  const fmt = (d: Date | null) => d
    ? d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '';

  return {
    today:    new Date().toLocaleDateString('ru-RU'),
    user:     { name: user.name, email: user.email },
    company:  { name: 'AZ Group' },
    client: {
      fullName:    lead.client.fullName,
      birthDate:   fmt(lead.client.birthDate),
      nationality: lead.client.nationality ?? '',
      phone:       lead.client.phone,
      email:       lead.client.email ?? '',
      addressPL:   lead.client.addressPL ?? '',
      addressHome: lead.client.addressHome ?? '',
    },
    lead: {
      service:             lead.funnel.name,
      stage:               lead.stage.name,
      city:                lead.city?.name ?? '',
      salesManager:        lead.salesManager?.name ?? '',
      legalManager:        lead.legalManager?.name ?? '',
      attorney:            lead.attorney ?? '',
      totalAmount:         String(lead.totalAmount),
      fingerprintDate:     fmt(lead.fingerprintDate),
      fingerprintLocation: lead.fingerprintLocation ?? '',
      summary:             lead.summary ?? '',
      createdAt:           fmt(lead.createdAt),
    },
  };
}

/** Получить буфер пустого DOCX/XLSX/PPTX */
async function getBlankBuffer(format: 'DOCX' | 'XLSX' | 'PPTX'): Promise<Buffer> {
  const blanksDir = path.join(
    process.env.STORAGE_ROOT ?? path.join(process.cwd(), 'storage'),
    'blueprints', '_blank',
  );
  const fileName = `blank.${format.toLowerCase()}`;
  const blankPath = path.join(blanksDir, fileName);

  try {
    return await fs.readFile(blankPath);
  } catch {
    // Если blank-файла нет — генерим минимальный валидный
    if (format === 'DOCX') return generateMinimalDocx();
    throw new Error(`Файл-болванка ${fileName} не найден. Положите его в storage/blueprints/_blank/`);
  }
}

/** Минимальный валидный DOCX — пустой документ из ZIP с правильной структурой */
async function generateMinimalDocx(): Promise<Buffer> {
  // Используем модуль docx (он есть в зависимостях) для генерации
  const { Document, Packer, Paragraph } = await import('docx');
  const doc = new Document({
    sections: [{ children: [new Paragraph({ children: [] })] }],
  });
  return Packer.toBuffer(doc);
}
