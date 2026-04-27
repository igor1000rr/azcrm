// Валидация загружаемых файлов: whitelist расширений и MIME-типов.
//
// Используется в /api/files/upload и любом другом эндпоинте принимающем файлы.
// Цель — отбивать исполняемые (.exe, .bat), скрипты (.html, .js, .php, .sh)
// и всё через что можно сделать XSS через скачанный файл с нашего домена.
import path from 'node:path';

// Категории клиентских файлов: паспорт, контракт, фото, скан, общее.
export const ALLOWED_EXTENSIONS = new Set([
  '.pdf',
  '.doc', '.docx',
  '.xls', '.xlsx',
  '.ppt', '.pptx',
  '.txt', '.rtf',
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic', '.heif',
  '.csv',
  '.odt', '.ods',
]);

export const ALLOWED_MIME_PREFIXES = [
  'image/',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.oasis.opendocument',
  'text/plain',
  'text/csv',
  'text/rtf',
  'application/rtf',
];

export type FileCheckResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Проверяет имя файла и MIME-тип.
 * Расширение из name — всегда обязательно (иначе .exe в сыром виде не попадает в set).
 * MIME опциональный — некоторые клиенты не присылают (старые мобильные).
 */
export function isAllowedFile(name: string, mime: string): FileCheckResult {
  const ext = path.extname(name).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { ok: false, reason: `Расширение ${ext || '(нет)'} не разрешено` };
  }
  // MIME может быть пустым на некоторых клиентах — тогда полагаемся только на extension
  if (mime && !ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p))) {
    return { ok: false, reason: `Тип файла ${mime} не разрешён` };
  }
  return { ok: true };
}
