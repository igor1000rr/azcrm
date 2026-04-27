// Рендеринг шаблонов .docx с подстановкой полей.
// Используем docxtemplater — стандарт индустрии, работает с {client.fullName} нотацией.
//
// Шаблон загружается из storage, в нём можно использовать:
//   {client.fullName}    — имя клиента
//   {lead.service}       — название услуги
//   {today}              — сегодняшняя дата
//   и т.д. (см. document-actions.ts → buildTemplateContext)
//
// Условия и циклы:
//   {#hasFingerprint}    — блок если есть отпечатки
//     назначены на {lead.fingerprintDate}
//   {/hasFingerprint}
//
// docxtemplater поддерживает:
//   - простая подстановка: {variable}
//   - условные блоки: {#cond}...{/cond} и {^cond}...{/cond} (отрицание)
//   - циклы: {#items}{name}{/items}

import path from 'node:path';
import fs from 'node:fs/promises';

const STORAGE_ROOT = process.env.STORAGE_ROOT ?? path.join(process.cwd(), 'storage');

/**
 * Срендерить шаблон по URL (вида /api/files/blueprints/...) с заданным контекстом.
 * Возвращает Buffer готового .docx.
 */
export async function renderBlueprint(
  fileUrl: string,
  context: Record<string, unknown>,
): Promise<Buffer> {
  const buffer = await readBlueprintFile(fileUrl);

  // Импорт динамически — чтобы тяжёлые либы не уходили в client bundle
  const { default: PizZip } = await import('pizzip');
  const { default: Docxtemplater } = await import('docxtemplater');

  const zip = new PizZip(buffer);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => '', // если плейсхолдер не найден — пустая строка
  });

  doc.render(context);

  return doc.getZip().generate({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  });
}

/**
 * Извлечь список плейсхолдеров из .docx (для подсказки админу в UI).
 * Парсит XML внутри docx и ищет {variable} паттерны.
 */
export async function extractPlaceholders(fileUrl: string): Promise<string[]> {
  try {
    const buffer = await readBlueprintFile(fileUrl);
    const { default: PizZip } = await import('pizzip');
    const zip = new PizZip(buffer);

    // Читаем основной XML документа
    const docXml = zip.file('word/document.xml')?.asText() ?? '';

    // Извлекаем плейсхолдеры. Учитываем что Word может разбить { и } на разные runs.
    // Простой регекс для {var} паттернов.
    const matches = docXml.match(/\{([#/^]?[\w.]+)\}/g) ?? [];
    const placeholders = new Set<string>();
    for (const m of matches) {
      // Убираем фигурные и спец-символы (#/^)
      const clean = m.slice(1, -1).replace(/^[#/^]/, '');
      if (clean) placeholders.add(clean);
    }
    return [...placeholders].sort();
  } catch {
    return [];
  }
}

/** Читает файл шаблона из storage по URL */
async function readBlueprintFile(fileUrl: string): Promise<Buffer> {
  // Парсим URL вида /api/files/<bucket>/<storedName>
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
