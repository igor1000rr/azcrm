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
//
// 06.05.2026 — пункт #119 аудита: editor config JWT теперь имеет exp.
// До этого signJwt() не добавлял exp — токен жил вечно. Если URL с
// конфигом утечёт (история браузера, log-файлы, screen share) — у злоумышленника
// валидный editor JWT навсегда. Сейчас exp = iat + 8 часов (стандартная
// рабочая смена; OnlyOffice сам не проверяет exp, но наш callback верификатор
// теперь автоматически отклоняет истёкшие). Anna откроет документ заново —
// получит свежий токен.

import crypto from 'node:crypto';

// Публичный URL OnlyOffice — куда смотрит браузер пользователя
export const OO_PUBLIC_URL = process.env.ONLYOFFICE_PUBLIC_URL ?? 'http://localhost:8080';
// Внутренний URL — куда OnlyOffice стучится за callback'ом (внутри docker)
export const OO_CALLBACK_PUBLIC_URL = process.env.APP_PUBLIC_URL ?? 'http://localhost:3000';

// Секрет JWT — обязателен. Без него любой может подделать callback OnlyOffice
// и записать произвольный файл по url. Падаем громко при отсутствии в проде.
const OO_JWT_SECRET = process.env.ONLYOFFICE_JWT_SECRET ?? '';

// Время жизни editor config JWT — 8 часов (рабочая смена).
// Если документ открыт дольше 8 часов и autosave переподключается —
// фронт получит ошибку и пользователь обновит страницу. Это редкий
// случай; норма — открыть, поправить, закрыть в течение часов.
const EDITOR_CONFIG_TTL_SEC = 8 * 60 * 60;

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
    key:       string;
    title:     string;
    url:       string;
    permissions: {
      edit:     boolean;
      download: boolean;
      print:    boolean;
      comment:  boolean;
    };
  };
  documentType: 'word' | 'cell' | 'slide' | 'pdf';
  editorConfig: {
    callbackUrl: string;
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
  token?: string;
}

export type DocFormat = 'DOCX' | 'XLSX' | 'PPTX' | 'PDF';

export function getDocumentType(format: DocFormat): 'word' | 'cell' | 'slide' | 'pdf' {
  return ({DOCX: 'word', XLSX: 'cell', PPTX: 'slide', PDF: 'pdf'} as const)[format];
}

export function getFileExtension(format: DocFormat): string {
  return ({DOCX: 'docx', XLSX: 'xlsx', PPTX: 'pptx', PDF: 'pdf'} as const)[format];
}

export function buildEditorConfig(opts: {
  documentId: string;
  documentKey: string;
  fileName:   string;
  format:     DocFormat;
  fileUrl:    string;
  user:       { id: string; name: string };
  mode?:      'edit' | 'view';
}): OnlyOfficeConfig {
  const documentType = getDocumentType(opts.format);
  const fileType     = getFileExtension(opts.format);

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

  // Подписываем config с TTL — добавляем iat/exp в payload.
  // OnlyOffice игнорирует эти поля, но наш verifyJwt их теперь проверяет.
  config.token = signJwtWithExp(
    config as unknown as Record<string, unknown>,
    EDITOR_CONFIG_TTL_SEC,
  );
  return config;
}

export function signFileAccessToken(filePath: string, ttlSeconds = 300): string {
  return signJwt({
    p: filePath,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  });
}

export function verifyFileAccessToken(token: string, expectedPath: string): boolean {
  const payload = verifyJwt<{ p: string; exp: number }>(token);
  if (!payload) return false;
  if (payload.p !== expectedPath) return false;
  // verifyJwt уже проверил exp если он есть, но дублируем для самодокументации.
  if (payload.exp < Math.floor(Date.now() / 1000)) return false;
  return true;
}

/**
 * SSRF-защита для callback'а OnlyOffice.
 * При status=2 OnlyOffice присылает url откуда нужно скачать новый файл.
 * Принимаем только хосты, известные нам по env (публичный + внутренний).
 */
export function isAllowedDownloadUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;

    const allowed = new Set<string>();
    for (const envUrl of [
      process.env.ONLYOFFICE_PUBLIC_URL,
      process.env.APP_INTERNAL_URL,
      process.env.ONLYOFFICE_INTERNAL_URL,
    ]) {
      if (!envUrl) continue;
      try { allowed.add(new URL(envUrl).hostname); } catch {}
    }
    // Имена сервисов внутри docker-compose
    allowed.add('onlyoffice');
    allowed.add('documentserver');
    allowed.add('azgroup-onlyoffice');

    return allowed.has(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Подписать JWT с автоматическим добавлением iat/exp полей.
 * Используется для editor config (TTL 8 часов).
 */
export function signJwtWithExp(payload: Record<string, unknown>, ttlSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({
    ...payload,
    iat: now,
    exp: now + ttlSeconds,
  });
}

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

/**
 * Верификация JWT.
 *
 * 06.05.2026 — пункт #119 аудита: теперь автоматически проверяется поле exp
 * если оно присутствует в payload. Это закрывает историю с editor config JWT
 * который раньше жил вечно.
 *
 * Поведение:
 *   - Подпись невалидна → null
 *   - Payload не парсится → null
 *   - exp в payload и < now() → null (истёк)
 *   - exp нет → токен валиден (для legacy совместимости — callback'и
 *     OnlyOffice внутри docker сети могут не передавать exp)
 */
export function verifyJwt<T = Record<string, unknown>>(token: string): T | null {
  try {
    const secret = requireSecret();
    const [b64Header, b64Payload, sig] = token.split('.');
    if (!b64Header || !b64Payload || !sig) return null;

    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${b64Header}.${b64Payload}`)
      .digest('base64url');

    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;

    const payload = JSON.parse(
      Buffer.from(b64Payload, 'base64url').toString('utf-8'),
    ) as Record<string, unknown>;

    // Автоматическая проверка exp если оно есть.
    // Используем typeof === 'number' чтобы строки '0'/'null' не проходили.
    if (typeof payload.exp === 'number') {
      const nowSec = Math.floor(Date.now() / 1000);
      if (payload.exp < nowSec) return null;
    }

    return payload as T;
  } catch {
    return null;
  }
}

function base64url(str: string): string {
  return Buffer.from(str, 'utf-8').toString('base64url');
}

function absoluteUrl(relativeOrAbsolute: string): string {
  if (relativeOrAbsolute.startsWith('http')) return relativeOrAbsolute;
  const internal = process.env.APP_INTERNAL_URL ?? OO_CALLBACK_PUBLIC_URL;
  return `${internal}${relativeOrAbsolute}`;
}

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
  url?:   string;
  users?: string[];
  actions?: Array<{ type: number; userid: string }>;
}
