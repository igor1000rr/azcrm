// OnlyOffice Document Server интеграция.
//
// Архитектура:
//   1. Anna открывает документ в карточке лида → /api/onlyoffice/config?docId=...
//   2. Endpoint возвращает JSON конфиг с JWT-токеном
//   3. Frontend инжектит api.js OnlyOffice и отрисовывает редактор
//   4. OnlyOffice сохраняет → callback на /api/onlyoffice/callback
//   5. Callback скачивает .docx с OO и сохраняет в storage, обновляет БД
//
// ВАЖНО: OnlyOffice сервер должен иметь доступ к нашему /api/files/...
// и наоборот — мы должны иметь доступ к OnlyOffice по OO_PUBLIC_URL.
// В docker-compose они в одной сети.

import crypto from 'node:crypto';

// Публичный URL OnlyOffice — куда смотрит браузер пользователя
export const OO_PUBLIC_URL = process.env.ONLYOFFICE_PUBLIC_URL ?? 'http://localhost:8080';
// Внутренний URL — куда OnlyOffice стучится за callback'ом (внутри docker)
export const OO_CALLBACK_PUBLIC_URL = process.env.APP_PUBLIC_URL ?? 'http://localhost:3000';

// Секрет JWT — обязателен. Без него любой может подделать callback OnlyOffice
// и записать произвольный файл по url. Падаем громко при отсутствии в проде.
const OO_JWT_SECRET = process.env.ONLYOFFICE_JWT_SECRET ?? '';

function requireSecret(): string {
  if (!OO_JWT_SECRET) {
    throw new Error(
      'ONLYOFFICE_JWT_SECRET не задан в .env — это уязвимость, отказ работать. ' +
      'Сгенерируй: openssl rand -hex 32',
    );
  }
  return OO_JWT_SECRET;
}

export interface OnlyOfficeConfig {
  document: {
    fileType:  string;
    key:       string;     // уникальный ключ — менять при смене содержимого
    title:     string;
    url:       string;     // откуда OO скачает файл
    permissions: {
      edit:     boolean;
      download: boolean;
      print:    boolean;
      comment:  boolean;
    };
  };
  documentType: 'word' | 'cell' | 'slide' | 'pdf';
  editorConfig: {
    callbackUrl: string;   // куда OO отправит callback при сохранении
    user: { id: string; name: string };
    customization: {
      autosave:     boolean;
      forcesave:    boolean;
      compactToolbar: boolean;
      hideRightMenu:  boolean;
      logo?: { image: string; url: string };
    };
    lang:   string;
    mode:   'edit' | 'view';
    plugins?: { autostart: string[] };
  };
  height: string;
  width:  string;
  type:   'desktop' | 'mobile' | 'embedded';
  token?: string;          // подпись JWT всего конфига
}

export type DocFormat = 'DOCX' | 'XLSX' | 'PPTX' | 'PDF';

export function getDocumentType(format: DocFormat): 'word' | 'cell' | 'slide' | 'pdf' {
  return ({DOCX: 'word', XLSX: 'cell', PPTX: 'slide', PDF: 'pdf'} as const)[format];
}

export function getFileExtension(format: DocFormat): string {
  return ({DOCX: 'docx', XLSX: 'xlsx', PPTX: 'pptx', PDF: 'pdf'} as const)[format];
}

/**
 * Сборка конфига для OnlyOffice editor.
 * Подписывает JWT-токеном чтобы OO принял запрос.
 */
export function buildEditorConfig(opts: {
  documentId: string;
  documentKey: string;       // должен меняться при изменении файла
  fileName:   string;
  format:     DocFormat;
  fileUrl:    string;        // относительный URL: /api/files/docs/...
  user:       { id: string; name: string };
  mode?:      'edit' | 'view';
}): OnlyOfficeConfig {
  const documentType = getDocumentType(opts.format);
  const fileType     = getFileExtension(opts.format);

  // Подписываем URL файла токеном — OO сервер скачает без сессии,
  // но только этот конкретный путь и не дольше 10 минут.
  const fileToken      = signFileAccessToken(opts.fileUrl, 600);
  const fileUrlWithTok = `${opts.fileUrl}?ooToken=${encodeURIComponent(fileToken)}`;
  const fullFileUrl    = absoluteUrl(fileUrlWithTok);
  const callbackUrl    = `${OO_CALLBACK_PUBLIC_URL}/api/onlyoffice/callback?docId=${opts.documentId}`;

  const config: OnlyOfficeConfig = {
    document: {
      fileType,
      key:   opts.documentKey,
      title: opts.fileName,
      url:   fullFileUrl,
      permissions: {
        edit:     opts.mode !== 'view',
        download: true,
        print:    true,
        comment:  true,
      },
    },
    documentType,
    editorConfig: {
      callbackUrl,
      user: { id: opts.user.id, name: opts.user.name },
      customization: {
        autosave:       true,
        forcesave:      true,
        compactToolbar: true,
        hideRightMenu:  false,
      },
      lang: 'ru',
      mode: opts.mode ?? 'edit',
    },
    height: '100%',
    width:  '100%',
    type:   'desktop',
  };

  // Подписываем весь конфиг JWT (кастуем к Record для signJwt-signature)
  config.token = signJwt(config as unknown as Record<string, unknown>);
  return config;
}

/**
 * Подписать short-lived токен доступа к файлу для OnlyOffice сервера.
 * OO ходит за файлом по публичному URL без сессии — этот токен пускает
 * только конкретный путь и только на короткий срок (по умолчанию 5 мин).
 */
export function signFileAccessToken(filePath: string, ttlSeconds = 300): string {
  return signJwt({
    p: filePath,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  });
}

/** Проверить токен из ?ooToken=... — путь должен совпадать, срок не истёк */
export function verifyFileAccessToken(token: string, expectedPath: string): boolean {
  const payload = verifyJwt<{ p: string; exp: number }>(token);
  if (!payload) return false;
  if (payload.p !== expectedPath) return false;
  if (payload.exp < Math.floor(Date.now() / 1000)) return false;
  return true;
}

/** Простой HS256 JWT (без зависимостей) — OnlyOffice использует HS256 */
export function signJwt(payload: Record<string, unknown>): string {
  const secret = requireSecret();
  const header = { alg: 'HS256', typ: 'JWT' };
  const b64Header  = base64url(JSON.stringify(header));
  const b64Payload = base64url(JSON.stringify(payload));
  const data = `${b64Header}.${b64Payload}`;
  const sig = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64url');
  return `${data}.${sig}`;
}

/** Проверка JWT (для callback от OnlyOffice) */
export function verifyJwt<T = Record<string, unknown>>(token: string): T | null {
  try {
    const secret = requireSecret();
    const [b64Header, b64Payload, sig] = token.split('.');
    if (!b64Header || !b64Payload || !sig) return null;

    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${b64Header}.${b64Payload}`)
      .digest('base64url');

    // Защита от timing-attack + от падения при разной длине строк
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;

    return JSON.parse(Buffer.from(b64Payload, 'base64url').toString('utf-8')) as T;
  } catch {
    return null;
  }
}

function base64url(str: string): string {
  return Buffer.from(str, 'utf-8').toString('base64url');
}

function absoluteUrl(relativeOrAbsolute: string): string {
  if (relativeOrAbsolute.startsWith('http')) return relativeOrAbsolute;
  // Внутри docker OnlyOffice идёт к app по внутренней сети
  const internal = process.env.APP_INTERNAL_URL ?? OO_CALLBACK_PUBLIC_URL;
  return `${internal}${relativeOrAbsolute}`;
}

/**
 * Статусы callback'а OnlyOffice
 * 0 — без изменений
 * 1 — редактируется
 * 2 — готов к сохранению (нужно скачать)
 * 3 — ошибка сохранения
 * 4 — закрыт без изменений
 * 6 — редактируется, но текущая версия сохранена
 * 7 — ошибка при принудительном сохранении
 */
export const OOCallbackStatus = {
  NO_CHANGES:    0,
  EDITING:       1,
  READY_TO_SAVE: 2,
  SAVE_ERROR:    3,
  CLOSED_NO_CHANGES: 4,
  EDITING_FORCESAVED: 6,
  FORCESAVE_ERROR: 7,
} as const;

export interface OOCallbackBody {
  key:    string;
  status: number;
  url?:   string;       // URL для скачивания нового состояния (status=2)
  users?: string[];     // кто редактировал
  actions?: Array<{ type: number; userid: string }>;
}
