// OnlyOffice Document Server интеграция
import crypto from 'node:crypto';

export const OO_PUBLIC_URL = process.env.ONLYOFFICE_PUBLIC_URL ?? 'http://localhost:8080';
export const OO_CALLBACK_PUBLIC_URL = process.env.APP_PUBLIC_URL ?? 'http://localhost:3000';
const OO_JWT_SECRET = process.env.ONLYOFFICE_JWT_SECRET ?? 'change-me-in-production';

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

  const fullFileUrl   = absoluteUrl(opts.fileUrl);
  const callbackUrl   = `${OO_CALLBACK_PUBLIC_URL}/api/onlyoffice/callback?docId=${opts.documentId}`;

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

  config.token = signJwt(config);
  return config;
}

export function signJwt(payload: Record<string, unknown>): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const b64Header  = base64url(JSON.stringify(header));
  const b64Payload = base64url(JSON.stringify(payload));
  const data = `${b64Header}.${b64Payload}`;
  const sig = crypto
    .createHmac('sha256', OO_JWT_SECRET)
    .update(data)
    .digest('base64url');
  return `${data}.${sig}`;
}

export function verifyJwt<T = Record<string, unknown>>(token: string): T | null {
  try {
    const [b64Header, b64Payload, sig] = token.split('.');
    if (!b64Header || !b64Payload || !sig) return null;

    const expected = crypto
      .createHmac('sha256', OO_JWT_SECRET)
      .update(`${b64Header}.${b64Payload}`)
      .digest('base64url');

    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

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
