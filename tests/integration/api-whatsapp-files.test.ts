// Integration: API routes — whatsapp/[action], files/upload, upload-generic, delete
import { describe, it, expect, vi, beforeEach } from 'vitest';

type AnyFn = ReturnType<typeof vi.fn>;

interface MockResponse { status: number; data: unknown; json: () => Promise<unknown>; }
function mockJson(data: unknown, init?: { status?: number }): MockResponse {
  return { status: init?.status ?? 200, data, json: async () => data };
}

vi.mock('next/server', () => ({
  NextResponse: { json: mockJson },
}));

const mockDb = {
  whatsappAccount: { findFirst: vi.fn() as AnyFn, update: vi.fn() as AnyFn },
  chatThread:      { findUnique: vi.fn() as AnyFn, update: vi.fn() as AnyFn },
  chatMessage:     { create: vi.fn() as AnyFn },
  client:          { findFirst: vi.fn() as AnyFn },
  clientFile:      { findUnique: vi.fn() as AnyFn, create: vi.fn() as AnyFn, delete: vi.fn() as AnyFn },
  $transaction: vi.fn(async (arg: unknown) => Array.isArray(arg) ? Promise.all(arg) : arg) as AnyFn,
};
const mockRequireUser   = vi.fn(async () => ({ id: 'u-1', email: 'u@a', name: 'U', role: 'SALES' }));
const mockRequireAdmin  = vi.fn(async () => ({ id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN' }));
const mockCheckRateLimit = vi.fn(() => true);
const mockWorkerConnect    = vi.fn(async () => ({ qr: 'qr-data', status: 'pending' }));
const mockWorkerDisconnect = vi.fn(async () => ({ ok: true }));
const mockWorkerStatus     = vi.fn(async () => ({ ok: true, isConnected: true }));
const mockWorkerSendMessage = vi.fn(async () => ({ ok: true, messageId: 'msg-123' }));
const mockSaveBuffer = vi.fn(async () => ({ url: '/api/files/uploads/test.pdf', size: 1024 }));
const mockRemoveFile = vi.fn();
const mockIsAllowedFile = vi.fn(() => ({ ok: true }));
const mockCanViewLead = vi.fn(() => true);

vi.mock('@/lib/db',          () => ({ db: mockDb }));
vi.mock('@/lib/auth',        () => ({
  requireUser:  mockRequireUser,
  requireAdmin: mockRequireAdmin,
}));
vi.mock('@/lib/permissions', () => ({
  whatsappAccountFilter:    vi.fn(() => ({})),
  clientVisibilityFilter:   vi.fn(() => ({})),
  canViewLead:              mockCanViewLead,
}));
vi.mock('@/lib/rate-limit',  () => ({ checkRateLimit: mockCheckRateLimit }));
vi.mock('@/lib/whatsapp',    () => ({
  workerConnect:    mockWorkerConnect,
  workerDisconnect: mockWorkerDisconnect,
  workerStatus:     mockWorkerStatus,
  workerSendMessage: mockWorkerSendMessage,
}));
vi.mock('@/lib/storage',     () => ({
  saveBuffer: mockSaveBuffer,
  removeFile: mockRemoveFile,
}));
vi.mock('@/lib/file-validation', () => ({ isAllowedFile: mockIsAllowedFile }));

function makeReq(opts: {
  body?: unknown;
  formData?: FormData;
  headers?: Record<string, string>;
} = {}) {
  return {
    nextUrl: new URL('http://localhost/api/x'),
    headers: new Headers(opts.headers ?? {}),
    json:    async () => opts.body ?? {},
    formData: async () => opts.formData ?? new FormData(),
  } as unknown as Request;
}

beforeEach(() => {
  Object.values(mockDb).forEach((entity) => {
    if (typeof entity === 'function') (entity as AnyFn).mockReset();
    else Object.values(entity).forEach((fn) => (fn as AnyFn).mockReset());
  });
  mockDb.$transaction.mockImplementation(async (arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg) : arg,
  );
  mockRequireUser.mockReset();
  mockRequireUser.mockImplementation(async () => ({ id: 'u-1', email: 'u@a', name: 'U', role: 'SALES' }));
  mockRequireAdmin.mockReset();
  mockRequireAdmin.mockImplementation(async () => ({ id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN' }));
  mockCheckRateLimit.mockReset();
  mockCheckRateLimit.mockReturnValue(true);
  [mockWorkerConnect, mockWorkerDisconnect, mockWorkerStatus, mockWorkerSendMessage,
   mockSaveBuffer, mockRemoveFile, mockIsAllowedFile, mockCanViewLead].forEach((m) => m.mockReset());
  mockWorkerConnect.mockResolvedValue({ qr: 'qr-data', status: 'pending' });
  mockWorkerDisconnect.mockResolvedValue({ ok: true });
  mockWorkerStatus.mockResolvedValue({ ok: true, isConnected: true });
  mockWorkerSendMessage.mockResolvedValue({ ok: true, messageId: 'msg-123' });
  mockSaveBuffer.mockResolvedValue({ url: '/api/files/uploads/test.pdf', size: 1024 });
  mockIsAllowedFile.mockReturnValue({ ok: true });
  mockCanViewLead.mockReturnValue(true);
});

async function callWA(action: string, body: unknown) {
  const { POST } = await import('@/app/api/whatsapp/[action]/route');
  return POST(
    makeReq({ body }) as never,
    { params: Promise.resolve({ action }) } as never,
  ) as Promise<MockResponse>;
}

describe('POST /api/whatsapp/[action]', () => {
  it('неизвестный action → 400', async () => {
    const res = await callWA('hack', { accountId: 'wa-1' });
    expect(res.status).toBe(400);
  });
  it('accountId отсутствует → 400', async () => {
    const res = await callWA('connect', {});
    expect(res.status).toBe(400);
  });
  it('нет доступа к аккаунту (whatsappAccountFilter) → 403', async () => {
    mockDb.whatsappAccount.findFirst.mockResolvedValue(null);
    const res = await callWA('connect', { accountId: 'wa-1' });
    expect(res.status).toBe(403);
  });
  it('connect → workerConnect + возвращает QR', async () => {
    mockDb.whatsappAccount.findFirst.mockResolvedValue({ id: 'wa-1' });
    const res = await callWA('connect', { accountId: 'wa-1' });
    expect(res.status).toBe(200);
    expect(mockWorkerConnect).toHaveBeenCalledWith('wa-1');
    expect((res.data as { qr: string }).qr).toBe('qr-data');
  });
  it('disconnect → worker + пометить isConnected=false', async () => {
    mockDb.whatsappAccount.findFirst.mockResolvedValue({ id: 'wa-1' });
    await callWA('disconnect', { accountId: 'wa-1' });
    expect(mockWorkerDisconnect).toHaveBeenCalledWith('wa-1');
    expect(mockDb.whatsappAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'wa-1' }, data: { isConnected: false } }),
    );
  });
  it('status → workerStatus', async () => {
    mockDb.whatsappAccount.findFirst.mockResolvedValue({ id: 'wa-1' });
    const res = await callWA('status', { accountId: 'wa-1' });
    expect(res.status).toBe(200);
    expect(mockWorkerStatus).toHaveBeenCalledWith('wa-1');
  });
  it('send: rate-limit не прошёл → 429', async () => {
    mockDb.whatsappAccount.findFirst.mockResolvedValue({ id: 'wa-1' });
    mockCheckRateLimit.mockReturnValue(false);
    const res = await callWA('send', { accountId: 'wa-1', threadId: 'th-1', body: 'hi' });
    expect(res.status).toBe(429);
    expect(mockWorkerSendMessage).not.toHaveBeenCalled();
  });
  it('send: нет threadId → 400', async () => {
    mockDb.whatsappAccount.findFirst.mockResolvedValue({ id: 'wa-1' });
    const res = await callWA('send', { accountId: 'wa-1', body: 'hi' });
    expect(res.status).toBe(400);
  });
  it('send: тред не найден → 404', async () => {
    mockDb.whatsappAccount.findFirst.mockResolvedValue({ id: 'wa-1' });
    mockDb.chatThread.findUnique.mockResolvedValue(null);
    const res = await callWA('send', { accountId: 'wa-1', threadId: 'th-x', body: 'hi' });
    expect(res.status).toBe(404);
  });
  it('send: нет номера назначения → 400', async () => {
    mockDb.whatsappAccount.findFirst.mockResolvedValue({ id: 'wa-1' });
    mockDb.chatThread.findUnique.mockResolvedValue({
      id: 'th-1', externalPhoneNumber: null, clientId: null, client: null,
    });
    const res = await callWA('send', { accountId: 'wa-1', threadId: 'th-1', body: 'hi' });
    expect(res.status).toBe(400);
  });
  it('send: успех → chatMessage.create + chatThread.update', async () => {
    mockDb.whatsappAccount.findFirst.mockResolvedValue({ id: 'wa-1' });
    mockDb.chatThread.findUnique.mockResolvedValue({
      id: 'th-1', externalPhoneNumber: '+48999', clientId: 'cl-1',
      client: { phone: '+48999' },
    });
    const res = await callWA('send', { accountId: 'wa-1', threadId: 'th-1', body: 'Привет' });
    expect(res.status).toBe(200);
    expect(mockWorkerSendMessage).toHaveBeenCalledWith('wa-1', '+48999', 'Привет', undefined);
    expect(mockDb.chatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          threadId: 'th-1', direction: 'OUT', body: 'Привет',
          externalId: 'msg-123', senderId: 'u-1',
        }),
      }),
    );
  });
});

describe('POST /api/files/upload', () => {
  function makeFile(name: string, type: string, size = 100): File {
    return new File(['x'.repeat(size)], name, { type });
  }
  function makeForm(fields: Record<string, string | File>): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    return fd;
  }

  it('file или clientId отсутствует → 400', async () => {
    const { POST } = await import('@/app/api/files/upload/route');
    const res = await POST(makeReq({ formData: makeForm({}) }) as never) as MockResponse;
    expect(res.status).toBe(400);
  });
  it('file > 50 МБ → 413', async () => {
    const big = new File([new Uint8Array(51 * 1024 * 1024)], 'big.pdf', { type: 'application/pdf' });
    const { POST } = await import('@/app/api/files/upload/route');
    const res = await POST(makeReq({ formData: makeForm({ file: big, clientId: 'cl-1' }) }) as never) as MockResponse;
    expect(res.status).toBe(413);
  });
  it('isAllowedFile вернул ok=false → 415', async () => {
    mockIsAllowedFile.mockReturnValue({ ok: false, reason: 'Исполняемые файлы запрещены' });
    const file = makeFile('x.exe', 'application/octet-stream');
    const { POST } = await import('@/app/api/files/upload/route');
    const res = await POST(makeReq({ formData: makeForm({ file, clientId: 'cl-1' }) }) as never) as MockResponse;
    expect(res.status).toBe(415);
  });
  it('клиент не виден (clientVisibilityFilter) → 403', async () => {
    mockDb.client.findFirst.mockResolvedValue(null);
    const file = makeFile('x.pdf', 'application/pdf');
    const { POST } = await import('@/app/api/files/upload/route');
    const res = await POST(makeReq({ formData: makeForm({ file, clientId: 'cl-x' }) }) as never) as MockResponse;
    expect(res.status).toBe(403);
  });
  it('успех → saveBuffer + clientFile.create + revalidate', async () => {
    mockDb.client.findFirst.mockResolvedValue({ id: 'cl-1' });
    mockDb.clientFile.create.mockResolvedValue({
      id: 'f-1', name: 'x.pdf', fileUrl: '/api/files/uploads/test.pdf', fileSize: 1024, category: 'GENERAL',
    });
    const file = makeFile('x.pdf', 'application/pdf');
    const { POST } = await import('@/app/api/files/upload/route');
    const res = await POST(makeReq({ formData: makeForm({ file, clientId: 'cl-1', category: 'PASSPORT' }) }) as never) as MockResponse;
    expect(res.status).toBe(200);
    expect(mockSaveBuffer).toHaveBeenCalled();
    expect(mockDb.clientFile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ clientId: 'cl-1', category: 'PASSPORT', uploadedById: 'u-1' }),
      }),
    );
  });
});

describe('POST /api/files/upload-generic', () => {
  function makeFile(name: string, type: string): File {
    return new File(['x'], name, { type });
  }
  function makeForm(fields: Record<string, string | File>): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    return fd;
  }

  it('нет file → 400', async () => {
    const { POST } = await import('@/app/api/files/upload-generic/route');
    const res = await POST(makeReq({ formData: makeForm({}) }) as never) as MockResponse;
    expect(res.status).toBe(400);
  });
  it('invalid bucket → 400', async () => {
    const file = makeFile('x.pdf', 'application/pdf');
    const { POST } = await import('@/app/api/files/upload-generic/route');
    const res = await POST(makeReq({ formData: makeForm({ file, bucket: 'docs' }) }) as never) as MockResponse;
    expect(res.status).toBe(400);
  });
  it('bucket=expenses + файл → saveBuffer + 200', async () => {
    const file = makeFile('receipt.jpg', 'image/jpeg');
    const { POST } = await import('@/app/api/files/upload-generic/route');
    const res = await POST(makeReq({ formData: makeForm({ file, bucket: 'expenses' }) }) as never) as MockResponse;
    expect(res.status).toBe(200);
    expect(mockSaveBuffer).toHaveBeenCalledWith('expenses', expect.anything(), 'receipt.jpg');
  });
  it('не-админ → ошибка из requireAdmin', async () => {
    mockRequireAdmin.mockImplementation(async () => {
      const e = new Error('Forbidden') as Error & { statusCode?: number };
      e.statusCode = 403; throw e;
    });
    const file = makeFile('x.pdf', 'application/pdf');
    const { POST } = await import('@/app/api/files/upload-generic/route');
    const res = await POST(makeReq({ formData: makeForm({ file, bucket: 'expenses' }) }) as never) as MockResponse;
    expect(res.status).toBe(403);
    expect(mockSaveBuffer).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/files/delete/[id]', () => {
  it('файл не найден → 404', async () => {
    mockDb.clientFile.findUnique.mockResolvedValue(null);
    const { DELETE } = await import('@/app/api/files/delete/[id]/route');
    const res = await DELETE(
      makeReq() as never,
      { params: Promise.resolve({ id: 'f-x' }) } as never,
    ) as MockResponse;
    expect(res.status).toBe(404);
  });
  it('нет прав (canViewLead=false на всех лидах) → 403', async () => {
    mockDb.clientFile.findUnique.mockResolvedValue({
      id: 'f-1', fileUrl: '/api/files/uploads/x.pdf', clientId: 'cl-1',
      client: { id: 'cl-1', leads: [{ salesManagerId: 'other', legalManagerId: 'other' }] },
    });
    mockCanViewLead.mockReturnValue(false);
    const { DELETE } = await import('@/app/api/files/delete/[id]/route');
    const res = await DELETE(
      makeReq() as never,
      { params: Promise.resolve({ id: 'f-1' }) } as never,
    ) as MockResponse;
    expect(res.status).toBe(403);
  });
  it('uploads-файл → removeFile + clientFile.delete', async () => {
    mockDb.clientFile.findUnique.mockResolvedValue({
      id: 'f-1', fileUrl: '/api/files/uploads/abc.pdf', clientId: 'cl-1',
      client: { id: 'cl-1', leads: [{ salesManagerId: 'u-1', legalManagerId: null }] },
    });
    const { DELETE } = await import('@/app/api/files/delete/[id]/route');
    await DELETE(
      makeReq() as never,
      { params: Promise.resolve({ id: 'f-1' }) } as never,
    );
    expect(mockRemoveFile).toHaveBeenCalledWith('uploads', 'abc.pdf');
    expect(mockDb.clientFile.delete).toHaveBeenCalled();
  });
  it('external URL → без removeFile, но clientFile.delete', async () => {
    mockDb.clientFile.findUnique.mockResolvedValue({
      id: 'f-1', fileUrl: 'https://external.example/file.pdf', clientId: 'cl-1',
      client: { id: 'cl-1', leads: [{ salesManagerId: 'u-1', legalManagerId: null }] },
    });
    const { DELETE } = await import('@/app/api/files/delete/[id]/route');
    await DELETE(
      makeReq() as never,
      { params: Promise.resolve({ id: 'f-1' }) } as never,
    );
    expect(mockRemoveFile).not.toHaveBeenCalled();
    expect(mockDb.clientFile.delete).toHaveBeenCalled();
  });
  it('ADMIN обходит canViewLead', async () => {
    mockRequireUser.mockImplementation(async () => ({ id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN' }));
    mockDb.clientFile.findUnique.mockResolvedValue({
      id: 'f-1', fileUrl: '/api/files/uploads/abc.pdf', clientId: 'cl-1',
      client: { id: 'cl-1', leads: [{ salesManagerId: 'other', legalManagerId: 'other' }] },
    });
    mockCanViewLead.mockReturnValue(false);
    const { DELETE } = await import('@/app/api/files/delete/[id]/route');
    const res = await DELETE(
      makeReq() as never,
      { params: Promise.resolve({ id: 'f-1' }) } as never,
    ) as MockResponse;
    expect(res.status).toBe(200);
    expect(mockDb.clientFile.delete).toHaveBeenCalled();
  });
});
