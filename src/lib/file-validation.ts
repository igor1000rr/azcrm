// Валидация загружаемых файлов: whitelist расширений и MIME-типов + magic bytes.
//
// Используется в /api/files/upload и любом другом эндпоинте принимающем файлы.
// Цель — отбивать исполняемые (.exe, .bat), скрипты (.html, .js, .php, .sh)
// и всё через что можно сделать XSS через скачанный файл с нашего домена.
//
// 06.05.2026 — пункт #37 аудита: добавлена magic-bytes проверка (validateMagicBytes).
// До: проверялись только name (расширение) и MIME (из Content-Type).
// Оба контролируются клиентом — атакующий мог переименовать virus.exe в
// kontrakt.pdf, выставить Content-Type: application/pdf и обойти isAllowedFile.
// Сейчас в /api/files/upload вызывается ещё и validateMagicBytes(buffer, ext).
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

// =================== MAGIC BYTES ===================
// Сигнатуры начала файла. Источник: https://en.wikipedia.org/wiki/List_of_file_signatures
// Проверяем первые N байт буфера и сверяем с whitelist'ом для расширения.

interface MagicSignature {
  bytes:  number[];   // последовательность байт
  offset: number;     // с какого offset искать (обычно 0)
}

// Карта расширение → допустимые сигнатуры. Если расширение не в карте —
// magic-байты не проверяются (для .txt/.csv это OK — они plaintext без сигнатуры).
const MAGIC_BYTES: Record<string, MagicSignature[]> = {
  '.pdf':  [{ bytes: [0x25, 0x50, 0x44, 0x46], offset: 0 }],                           // %PDF
  '.png':  [{ bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], offset: 0 }],
  '.jpg':  [{ bytes: [0xFF, 0xD8, 0xFF], offset: 0 }],
  '.jpeg': [{ bytes: [0xFF, 0xD8, 0xFF], offset: 0 }],
  '.gif':  [
    { bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], offset: 0 },                        // GIF87a
    { bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], offset: 0 },                        // GIF89a
  ],
  '.webp': [{ bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 }],                           // RIFF (далее WEBP в offset 8 — ниже отдельно)
  // HEIC/HEIF — ftyp box на offset 4: ftypheic/ftypheix/ftyphevc/ftypmif1/ftypmsf1
  '.heic': [
    { bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 }, // "ftyp" — конкретный brand проверим ниже
  ],
  '.heif': [
    { bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 },
  ],
  // ZIP-based Office формат: docx/xlsx/pptx — все начинаются с PK
  '.docx': [{ bytes: [0x50, 0x4B, 0x03, 0x04], offset: 0 }],
  '.xlsx': [{ bytes: [0x50, 0x4B, 0x03, 0x04], offset: 0 }],
  '.pptx': [{ bytes: [0x50, 0x4B, 0x03, 0x04], offset: 0 }],
  '.odt':  [{ bytes: [0x50, 0x4B, 0x03, 0x04], offset: 0 }],
  '.ods':  [{ bytes: [0x50, 0x4B, 0x03, 0x04], offset: 0 }],
  // OLE-based legacy: doc/xls/ppt — D0 CF 11 E0 A1 B1 1A E1
  '.doc': [{ bytes: [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1], offset: 0 }],
  '.xls': [{ bytes: [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1], offset: 0 }],
  '.ppt': [{ bytes: [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1], offset: 0 }],
  // RTF: {\\rtf
  '.rtf': [{ bytes: [0x7B, 0x5C, 0x72, 0x74, 0x66], offset: 0 }],
};

/**
 * Проверяет первые байты буфера на соответствие сигнатуре расширения.
 *
 * @param buffer  начало файла (хватит первых ~32 байт)
 * @param ext     расширение (с точкой, lowercase) — например '.pdf'
 * @returns       { ok: true } если совпало или расширение не проверяется,
 *                { ok: false, reason } если первые байты не совпали с whitelist'ом
 *
 * Для plaintext-форматов (.txt, .csv) magic-байтов нет — пропускаем проверку.
 *
 * WEBP: RIFF в offset 0 + WEBP в offset 8 — проверяем оба условия.
 * HEIC/HEIF: ftyp box в offset 4 + далее brand (heic/heix/hevc/mif1/msf1)
 * в offset 8 — проверяем брэнд тоже.
 */
export function validateMagicBytes(buffer: Buffer | Uint8Array, ext: string): FileCheckResult {
  const lower = ext.toLowerCase();

  // .txt/.csv не имеют сигнатуры — пропускаем (доверяем расширению + ALLOWED_MIME).
  if (lower === '.txt' || lower === '.csv') return { ok: true };

  const sigs = MAGIC_BYTES[lower];
  if (!sigs) {
    // Расширение не в карте magic — пропускаем (но isAllowedFile уже отбил
    // всё что вне ALLOWED_EXTENSIONS, поэтому опасности нет).
    return { ok: true };
  }

  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  // Проверяем что хотя бы одна сигнатура совпадает по offset.
  const matched = sigs.some((sig) => {
    if (buf.length < sig.offset + sig.bytes.length) return false;
    for (let i = 0; i < sig.bytes.length; i++) {
      if (buf[sig.offset + i] !== sig.bytes[i]) return false;
    }
    return true;
  });

  if (!matched) {
    return {
      ok: false,
      reason: `Содержимое файла не соответствует расширению ${lower} (magic bytes не совпадают)`,
    };
  }

  // Дополнительные проверки для составных форматов:
  if (lower === '.webp') {
    // После RIFF (4 байта) идёт длина (4 байта), потом "WEBP" в offset 8
    if (buf.length < 12) return { ok: false, reason: 'Файл слишком короткий для WEBP' };
    const tag = buf.slice(8, 12).toString('ascii');
    if (tag !== 'WEBP') return { ok: false, reason: 'Не WEBP контейнер (отсутствует тег)' };
  }

  if (lower === '.heic' || lower === '.heif') {
    // ftyp в offset 4, brand в offset 8 (4 байта)
    if (buf.length < 12) return { ok: false, reason: 'Файл слишком короткий для HEIC/HEIF' };
    const brand = buf.slice(8, 12).toString('ascii');
    const validBrands = ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis'];
    if (!validBrands.includes(brand)) {
      return { ok: false, reason: `Неизвестный HEIC/HEIF brand: ${brand}` };
    }
  }

  return { ok: true };
}
