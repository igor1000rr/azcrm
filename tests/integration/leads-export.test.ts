// Тест GET /api/leads/export — права + формат CSV
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = { lead: { findMany: vi.fn() } };
const requireAdminMock = vi.fn();

vi.mock('@/lib/db',   () => ({ db: mockDb }));
vi.mock('@/lib/auth', () => ({ requireAdmin: requireAdminMock }));

const { GET } = await import('@/app/api/leads/export/route');

beforeEach(() => {
  mockDb.lead.findMany.mockReset();
  requireAdminMock.mockReset();
});

function makeReq(qs = '') {
  return new Request(`http://localhost/api/leads/export${qs}`) as unknown as Parameters<typeof GET>[0];
}

describe('GET /api/leads/export', () => {
  it('не-admin → 403 (через requireAdmin throw)', async () => {
    requireAdminMock.mockRejectedValue(new Error('Forbidden'));
    await expect(GET(makeReq())).rejects.toThrow('Forbidden');
  });

  it('admin: возвращает CSV с BOM и правильными заголовками', async () => {
    requireAdminMock.mockResolvedValue({ id: 'u', role: 'ADMIN' });
    mockDb.lead.findMany.mockResolvedValue([{
      id: 'L1', createdAt: new Date('2026-04-27T10:00:00Z'),
      client: { fullName: 'Иван Иванов', phone: '+48123', email: null, nationality: 'PL' },
      funnel: { name: 'Karta praca' }, stage: { name: 'Новый' },
      city: { name: 'Łódź' }, service: { name: 'Карта 3 года' },
      sourceKind: 'WHATSAPP', source: null,
      salesManager: { name: 'Olga' }, legalManager: null,
      payments: [{ amount: 500 }],
      totalAmount: 1500, fingerprintDate: null, isArchived: false,
    }]);

    const res = await GET(makeReq('?funnel=f1'));
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    const body = await res.text();
    expect(body.charCodeAt(0)).toBe(0xFEFF);
    expect(body).toContain('Иван Иванов');
    expect(body).toContain('+48123');
    expect(body).toContain('WhatsApp');
    expect(body).toContain('1500.00');
    expect(body).toContain('500.00');
    expect(body).toContain('1000.00');
  });

  it('фильтр по funnel передаётся в where', async () => {
    requireAdminMock.mockResolvedValue({ role: 'ADMIN' });
    mockDb.lead.findMany.mockResolvedValue([]);
    await GET(makeReq('?funnel=f-abc&city=c-xyz'));
    const arg = mockDb.lead.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ funnelId: 'f-abc', cityId: 'c-xyz', isArchived: false });
  });

  it('archived=1 → isArchived: true', async () => {
    requireAdminMock.mockResolvedValue({ role: 'ADMIN' });
    mockDb.lead.findMany.mockResolvedValue([]);
    await GET(makeReq('?archived=1'));
    const arg = mockDb.lead.findMany.mock.calls[0][0];
    expect(arg.where.isArchived).toBe(true);
  });

  it('экранирует ; в полях', async () => {
    requireAdminMock.mockResolvedValue({ role: 'ADMIN' });
    mockDb.lead.findMany.mockResolvedValue([{
      id: 'L1', createdAt: new Date(),
      client: { fullName: 'Smith; John', phone: '+48', email: null, nationality: null },
      funnel: { name: 'F' }, stage: { name: 'S' }, city: null, service: null,
      sourceKind: null, source: null,
      salesManager: null, legalManager: null,
      payments: [], totalAmount: 0, fingerprintDate: null, isArchived: false,
    }]);
    const body = await (await GET(makeReq())).text();
    expect(body).toContain('"Smith; John"');
  });
});
