// Рендеринг шаблонов .docx с подстановкой полей
import path from 'node:path';
import fs from 'node:fs/promises';

const STORAGE_ROOT = process.env.STORAGE_ROOT ?? path.join(process.cwd(), 'storage');

export async function renderBlueprint(
  fileUrl: string,
  context: Record<string, unknown>,
): Promise<Buffer> {
  const buffer = await readBlueprintFile(fileUrl);

  const { default: PizZip } = await import('pizzip');
  const { default: Docxtemplater } = await import('docxtemplater');

  const zip = new PizZip(buffer);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => '',
  });

  doc.render(context);

  return doc.getZip().generate({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  });
}

export async function extractPlaceholders(fileUrl: string): Promise<string[]> {
  try {
    const buffer = await readBlueprintFile(fileUrl);
    const { default: PizZip } = await import('pizzip');
    const zip = new PizZip(buffer);

    const docXml = zip.file('word/document.xml')?.asText() ?? '';

    const matches = docXml.match(/\{([#/^]?[\w.]+)\}/g) ?? [];
    const placeholders = new Set<string>();
    for (const m of matches) {
      const clean = m.slice(1, -1).replace(/^[#/^]/, '');
      if (clean) placeholders.add(clean);
    }
    return [...placeholders].sort();
  } catch {
    return [];
  }
}

async function readBlueprintFile(fileUrl: string): Promise<Buffer> {
  const m = fileUrl.match(/^\/api\/files\/([^/]+)\/(.+)$/);
  if (!m) throw new Error(`Некорректный URL шаблона: ${fileUrl}`);
  const [, bucket, storedName] = m;

  if (storedName.includes('..') || storedName.includes('\0')) {
    throw new Error('Недопустимый путь');
  }

  const fullPath = path.resolve(STORAGE_ROOT, bucket, storedName);
  const bucketRoot = path.resolve(STORAGE_ROOT, bucket);
  if (!fullPath.startsWith(bucketRoot + path.sep)) {
    throw new Error('Недопустимый путь');
  }

  return fs.readFile(fullPath);
}
