// Integration: API routes — files/[bucket]/[...path] (ooToken security)
//                    + onlyoffice/config + onlyoffice/callback (JWT)
// Критичные security-пути: path traversal, ooToken JWT, изоляция bucket'ов.
import { describe, it, expect, vi, beforeEach } from 'vitest';

type AnyFn = ReturnType<typeof vi.fn>;

interface MockResponse { status: number; data?: unknown; json?: () => Promise<unknown>; }

vi.mock('next/server', () => ({
  NextResponse: class NextResponse {
    status: number;
    body: unknown;
    constructor(body: unknown, init?: { status?: number }) {
      this.body = body;
      this.status = init?.status ?? 200;
    }
    static json(data: unknown, init?: { status?: number }): MockResponse {
      return { status: init?.status ?? 200, data, json: async () => data };
    }
  },
}));

const mockDb = {
  internalDocument: { findUnique: vi.fn() as AnyFn, create: vi.fn() as AnyFn, update: vi.fn() as AnyFn },
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: typeof mockDb) => Promise<unknown>)(mockDb);
    if (Array.isArray(arg)) return Promise.all(arg);
  }) as AnyFn,
};
const mockAuth                  = vi.fn(async () => ({ user: { id: 'u-1', role: 'SALES' } }));
const mockRequireUser           = vi.fn(async () => ({ id: 'u-1', email: 'u@a', name: 'U', role: 'SALES' }));
const mockVerifyFileAccessToken = vi.fn(() => false);
const mockVerifyJwt             = vi.fn(() => null);
// Без implementation — иначе TS зафиксирует tuple вызовов calls как `[]`
// (signature `() => {...}` без параметров) и `calls[0][0]` валится:
// "Tuple type '[]' of length '0' has no element at index '0'".
// Дефолт ставится в beforeEach.
const mockBuildEditorConfig     = vi.fn() as AnyFn;
const mockDownloadAndSave       = vi.fn(async () => ({ url: '/api/files/docs/saved.docx', size: 2048 }));
const mockCanViewLead           = vi.fn(() => true);
const mockFsStat = vi.fn();
const mockStreamFile = vi.fn(() => ({
  on: () => undefined, pipe: () => undefined, [Symbol.asyncIterator]: async function* () { yield Buffer.from('x'); },
}));

vi.mock('@/lib/db',          () => ({ db: mockDb }));
vi.mock('@/lib/auth',        () => ({
  auth: mockAuth,
  requireUser: mockRequireUser,
  requireAdmin: vi.fn(async () => ({ id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN' })),
}));
vi.mock('@/lib/permissions', () => ({ canViewLead: mockCanViewLead }));
vi.mock('@/lib/onlyoffice', async () => ({
  verifyFileAccessToken: mockVerifyFileAccessToken,
  verifyJwt:             mockVerifyJwt,
  buildEditorConfig:     mockBuildEditorConfig,
  OOCallbackStatus: {
    NO_CHANGES:        0,
    EDITING:           1,
    READY_TO_SAVE:     2,
    SAVE_ERROR:        3,
    CLOSED_NO_CHANGES: 4,
    EDITING_FORCESAVED: 6,
    FORCESAVE_ERROR:   7,
  },
}));
vi.mock('@/lib/storage', () => ({
  streamFile:      mockStreamFile,
  downloadAndSave: mockDownloadAndSave,
}));
vi.mock('node:fs', () => ({
  promises: { stat: mockFsStat },
}));

function makeReq(opts: {
  url?: string;
  body?: unknown;
  headers?: Record<string, string>;
} = {}) {
  const u = new URL(opts.url ?? 'http://localhost/api/x');
  return {
    nextUrl: u,
    url:     u.toString(),
    headers: new Headers(opts.headers ?? {}),
    json:    async () => opts.body ?? {},
  } as unknown as Request;
}

beforeEach(() => {
  Object.values(mockDb).forEach((entity) => {
    if (typeof entity === 'function') (entity as AnyFn).mockReset();
    else Object.values(entity).forEach((fn) => (fn as AnyFn).mockReset());
  });
  mockDb.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: typeof mockDb) => Promise<unknown>)(mockDb);
    if (Array.isArray(arg)) return Promise.all(arg);
  });
  [mockAuth, mockRequireUser, mockVerifyFileAccessToken, mockVerifyJwt,
   mockBuildEditorConfig, mockDownloadAndSave, mockCanViewLead, mockFsStat].forEach((m) => m.mockReset());
  mockAuth.mockResolvedValue({ user: { id: 'u-1', role: 'SALES' } });
  mockRequireUser.mockImplementation(async () => ({ id: 'u-1', email: 'u@a', name: 'U', role: 'SALES' }));
  mockVerifyFileAccessToken.mockReturnValue(false);
  mockBuildEditorConfig.mockReturnValue({ document: { key: 'doc-key' }, editorConfig: {} });
  mockDownloadAndSave.mockResolvedValue({ url: '/api/files/docs/saved.docx', size: 2048 });
  mockCanViewLead.mockReturnValue(true);
  mockFsStat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
});

async function callFiles(bucket: string, segments: string[], opts: {
  url?: string;
  searchParams?: Record<string, string>;
  authenticated?: boolean;
  role?: string;
} = {}) {
  if (opts.authenticated === false) {
    mockAuth.mockResolvedValue(null as never);
  } else if (opts.role) {
    mockAuth.mockResolvedValue({ user: { id: 'u-1', role: opts.role } } as never);
  }
  const sp = new URLSearchParams(opts.searchParams ?? {});
  const url = `http://localhost/api/files/${bucket}/${segments.join('/')}` +
              (sp.toString() ? '?' + sp.toString() : '');
  const req = makeReq({ url });
  const { GET } = await import('@/app/api/files/[bucket]/[...path]/route');
  return GET(
    req as never,
    { params: Promise.resolve({ bucket, path: segments }) } as never,
  );
}

describe('GET /api/files/[bucket]/[...path] — security', () => {
  it('неизвестный bucket → 404', async () => {
    const res = await callFiles('hack', ['x.pdf']) as unknown as { status: number };
    expect(res.status).toBe(404);
  });
  it('public bucket avatars — без сессии окей (доходит до fs.stat)', async () => {
    mockFsStat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    const res = await callFiles('avatars', ['user-1.jpg'], { authenticated: false }) as unknown as { status: number };
    expect(res.status).toBe(404);
    expect(mockAuth).not.toHaveBeenCalled();
  });
  it('non-public bucket без сессии → 401', async () => {
    const res = await callFiles('uploads', ['x.pdf'], { authenticated: false }) as unknown as { status: number };
    expect(res.status).toBe(401);
  });
  it('blueprints — только ADMIN, SALES → 403', async () => {
    const res = await callFiles('blueprints', ['template.docx'], { role: 'SALES' }) as unknown as { status: number };
    expect(res.status).toBe(403);
  });
  it('expenses — только ADMIN, LEGAL → 403', async () => {
    const res = await callFiles('expenses', ['receipt.jpg'], { role: 'LEGAL' }) as unknown as { status: number };
    expect(res.status).toBe(403);
  });
  it('path traversal с .. → 400', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u-1', role: 'ADMIN' } } as never);
    const res = await callFiles('uploads', ['..', 'etc', 'passwd']) as unknown as { status: number };
    expect(res.status).toBe(400);
  });
  it('null-byte в пути → 400', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u-1', role: 'ADMIN' } } as never);
    const res = await callFiles('uploads', ['file\0.pdf']) as unknown as { status: number };
    expect(res.status).toBe(400);
  });
  it('ooToken верный для docs → пускает без сессии', async () => {
    mockVerifyFileAccessToken.mockReturnValue(true);
    const res = await callFiles('docs', ['secret.docx'], {
      authenticated: false, searchParams: { ooToken: 'valid-jwt' },
    }) as unknown as { status: number };
    expect(res.status).toBe(404);
    expect(mockAuth).not.toHaveBeenCalled();
    expect(mockVerifyFileAccessToken).toHaveBeenCalledWith('valid-jwt', '/api/files/docs/secret.docx');
  });
  it('ooToken НЕВЕРНЫЙ для docs → требует сессию → 401', async () => {
    mockVerifyFileAccessToken.mockReturnValue(false);
    const res = await callFiles('docs', ['secret.docx'], {
      authenticated: false, searchParams: { ooToken: 'invalid' },
    }) as unknown as { status: number };
    expect(res.status).toBe(401);
  });
  it('ooToken верный НО для другого bucket (uploads, не docs) → НЕ принимается', async () => {
    mockVerifyFileAccessToken.mockReturnValue(true);
    const res = await callFiles('uploads', ['private.pdf'], {
      authenticated: false, searchParams: { ooToken: 'valid-but-wrong-bucket' },
    }) as unknown as { status: number };
    expect(res.status).toBe(401);
    expect(mockVerifyFileAccessToken).not.toHaveBeenCalled();
  });
});

describe('GET /api/onlyoffice/config', () => {
  it('нет docId → 400', async () => {
    const { GET } = await import('@/app/api/onlyoffice/config/route');
    const res = await GET(makeReq({ url: 'http://localhost/api/onlyoffice/config' }) as never) as unknown as MockResponse;
    expect(res.status).toBe(400);
  });
  it('документ не найден → 404', async () => {
    mockDb.internalDocument.findUnique.mockResolvedValue(null);
    const { GET } = await import('@/app/api/onlyoffice/config/route');
    const res = await GET(makeReq({ url: 'http://localhost/api/onlyoffice/config?docId=d-x' }) as never) as unknown as MockResponse;
    expect(res.status).toBe(404);
  });
  it('нет прав через canViewLead → 403', async () => {
    mockDb.internalDocument.findUnique.mockResolvedValue({
      id: 'd-1', name: 'X', format: 'docx', fileUrl: '/x', version: 1,
      updatedAt: new Date(), lead: { salesManagerId: 'other', legalManagerId: 'other' },
    });
    mockCanViewLead.mockReturnValue(false);
    const { GET } = await import('@/app/api/onlyoffice/config/route');
    const res = await GET(makeReq({ url: 'http://localhost/api/onlyoffice/config?docId=d-1' }) as never) as unknown as MockResponse;
    expect(res.status).toBe(403);
  });
  it('успех → buildEditorConfig вызывается с documentKey включающим version+updatedAt', async () => {
    const updatedAt = new Date('2026-04-28T12:00:00Z');
    mockDb.internalDocument.findUnique.mockResolvedValue({
      id: 'd-1', name: 'Договор', format: 'docx', fileUrl: '/api/files/docs/x.docx',
      version: 3, updatedAt, lead: { salesManagerId: 'u-1', legalManagerId: null },
    });
    const { GET } = await import('@/app/api/onlyoffice/config/route');
    const res = await GET(makeReq({ url: 'http://localhost/api/onlyoffice/config?docId=d-1' }) as never) as unknown as MockResponse;
    expect(res.status).toBe(200);
    expect(mockBuildEditorConfig).toHaveBeenCalledWith(expect.objectContaining({
      documentId:  'd-1',
      documentKey: `d-1-v3-${updatedAt.getTime()}`,
      fileName:    'Договор',
    }));
  });
  it('mode=view передаётся', async () => {
    mockDb.internalDocument.findUnique.mockResolvedValue({
      id: 'd-1', name: 'X', format: 'docx', fileUrl: '/x', version: 1,
      updatedAt: new Date(), lead: { salesManagerId: 'u-1', legalManagerId: null },
    });
    const { GET } = await import('@/app/api/onlyoffice/config/route');
    await GET(makeReq({ url: 'http://localhost/api/onlyoffice/config?docId=d-1&mode=view' }) as never);
    const call = mockBuildEditorConfig.mock.calls[0]![0];
    expect(call.mode).toBe('view');
  });
});

describe('POST /api/onlyoffice/callback', () => {
  it('нет docId → 400', async () => {
    const { POST } = await import('@/app/api/onlyoffice/callback/route');
    const res = await POST(makeReq({ url: 'http://localhost/api/onlyoffice/callback' }) as never) as unknown as MockResponse;
    expect(res.status).toBe(400);
  });
  it('JWT в Authorization header invalid → 401', async () => {
    mockVerifyJwt.mockReturnValue(null);
    const { POST } = await import('@/app/api/onlyoffice/callback/route');
    const res = await POST(makeReq({
      url: 'http://localhost/api/onlyoffice/callback?docId=d-1',
      headers: { authorization: 'Bearer fake-jwt' },
      body: { status: 0 },
    }) as never) as unknown as MockResponse;
    expect(res.status).toBe(401);
  });
  it('JWT в body.token invalid → 401', async () => {
    mockVerifyJwt.mockReturnValue(null);
    const { POST } = await import('@/app/api/onlyoffice/callback/route');
    const res = await POST(makeReq({
      url: 'http://localhost/api/onlyoffice/callback?docId=d-1',
      body: { status: 0, token: 'fake' },
    }) as never) as unknown as MockResponse;
    expect(res.status).toBe(401);
  });
  it('без JWT вообще — проходит (текущее поведение — dev/disabled JWT)', async () => {
    mockDb.internalDocument.findUnique.mockResolvedValue({
      id: 'd-1', leadId: 'l-1', name: 'X', fileUrl: '/x.docx', format: 'docx',
      fileSize: 100, source: 'BLANK', blueprintId: null, version: 1, createdById: 'u-1',
      createdAt: new Date(),
    });
    const { POST } = await import('@/app/api/onlyoffice/callback/route');
    const res = await POST(makeReq({
      url: 'http://localhost/api/onlyoffice/callback?docId=d-1',
      body: { status: 0 },
    }) as never) as unknown as MockResponse;
    expect(res.status).toBe(200);
  });
  it('документ не найден → 404', async () => {
    mockDb.internalDocument.findUnique.mockResolvedValue(null);
    const { POST } = await import('@/app/api/onlyoffice/callback/route');
    const res = await POST(makeReq({
      url: 'http://localhost/api/onlyoffice/callback?docId=d-x',
      body: { status: 0 },
    }) as never) as unknown as MockResponse;
    expect(res.status).toBe(404);
  });
  it('status=2 (READY_TO_SAVE) без url → 400', async () => {
    mockDb.internalDocument.findUnique.mockResolvedValue({
      id: 'd-1', leadId: 'l-1', name: 'X', fileUrl: '/x.docx', format: 'docx',
      fileSize: 100, source: 'BLANK', blueprintId: null, version: 1, createdById: 'u-1',
      createdAt: new Date(),
    });
    const { POST } = await import('@/app/api/onlyoffice/callback/route');
    const res = await POST(makeReq({
      url: 'http://localhost/api/onlyoffice/callback?docId=d-1',
      body: { status: 2 },
    }) as never) as unknown as MockResponse;
    expect(res.status).toBe(400);
  });
  it('status=2 + url → скачать, сохранить старую версию как parent + version+1', async () => {
    const oldDoc = {
      id: 'd-1', leadId: 'l-1', name: 'Договор', fileUrl: '/api/files/docs/old.docx',
      format: 'docx', fileSize: 1000, source: 'BLANK', blueprintId: null,
      version: 3, createdById: 'u-1', createdAt: new Date(),
    };
    mockDb.internalDocument.findUnique.mockResolvedValue(oldDoc);
    const { POST } = await import('@/app/api/onlyoffice/callback/route');
    const res = await POST(makeReq({
      url: 'http://localhost/api/onlyoffice/callback?docId=d-1',
      body: { status: 2, url: 'http://oo-server/output.docx' },
    }) as never) as unknown as MockResponse;
    expect(res.status).toBe(200);
    expect(mockDownloadAndSave).toHaveBeenCalledWith('http://oo-server/output.docx', 'docs', expect.any(String));
    expect(mockDb.internalDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          parentId: 'd-1', version: 3, name: 'Договор (v3)',
        }),
      }),
    );
    expect(mockDb.internalDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd-1' },
        data: expect.objectContaining({ version: { increment: 1 } }),
      }),
    );
  });
});
