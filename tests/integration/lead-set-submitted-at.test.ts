// Integration: clients/[id]/actions — setSubmittedAt
// Anna 30.04.2026: «волшебная штучка» — дата подачи внеска в УВ.
// Покрытие: проверка прав, валидация даты, audit, revalidate /calendar
// (без revalidate календаря красная подсветка событий не уходит после клика).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { revalidatePath } from 'next/cache';

type AnyFn = ReturnType<typeof vi.fn>;

const mockDb = {
  lead: { findUnique: vi.fn() as AnyFn, update: vi.fn() as AnyFn },
};
const mockAudit = vi.fn();
const mockCanEditLead = vi.fn(() => true);

vi.mock('@/lib/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({ id: 'u-1', email: 'u@a', name: 'U', role: 'SALES' })),
  requireAdmin: vi.fn(async () => ({ id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN' })),
}));
vi.mock('@/lib/permissions', () => ({
  canEditLead: mockCanEditLead,
  assert: vi.fn((cond: boolean) => { if (!cond) throw new Error('Forbidden'); }),
}));
vi.mock('@/lib/audit', () => ({ audit: mockAudit }));
vi.mock('@/lib/utils', async () => ({
  ...(await vi.importActual<object>('@/lib/utils')),
  normalizePhone: (p: string) => p.replace(/\s+/g, ''),
}));

const { setSubmittedAt } = await import('@/app/(app)/clients/[id]/actions');

beforeEach(() => {
  mockDb.lead.findUnique.mockReset();
  mockDb.lead.update.mockReset();
  mockAudit.mockReset();
  mockCanEditLead.mockReset();
  mockCanEditLead.mockReturnValue(true);
  vi.mocked(revalidatePath).mockClear();
});

const leadStub = {
  id: 'lead-1', salesManagerId: 'u-1', legalManagerId: null, submittedAt: null,
};

describe('setSubmittedAt', () => {
  it('лид не найден → throw "Лид не найден"', async () => {
    mockDb.lead.findUnique.mockResolvedValue(null);
    await expect(setSubmittedAt('lead-1', '2026-05-15'))
      .rejects.toThrow('Лид не найден');
    expect(mockDb.lead.update).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('canEditLead=false → throw "Forbidden" + не пишет в БД', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      ...leadStub, salesManagerId: 'other',
    });
    mockCanEditLead.mockReturnValue(false);
    await expect(setSubmittedAt('lead-1', '2026-05-15'))
      .rejects.toThrow('Forbidden');
    expect(mockDb.lead.update).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('некорректная дата → throw "Некорректная дата подачи"', async () => {
    mockDb.lead.findUnique.mockResolvedValue(leadStub);
    await expect(setSubmittedAt('lead-1', 'not-a-date'))
      .rejects.toThrow('Некорректная дата подачи');
    expect(mockDb.lead.update).not.toHaveBeenCalled();
  });

  it('успех с датой → submittedAt записывается как Date с правильным днём', async () => {
    mockDb.lead.findUnique.mockResolvedValue(leadStub);

    await setSubmittedAt('lead-1', '2026-05-15');

    expect(mockDb.lead.update).toHaveBeenCalledTimes(1);
    const updateCall = mockDb.lead.update.mock.calls[0][0];
    expect(updateCall.where).toEqual({ id: 'lead-1' });
    expect(updateCall.data.submittedAt).toBeInstanceOf(Date);
    expect(updateCall.data.submittedAt.toISOString().slice(0, 10)).toBe('2026-05-15');
  });

  it('audit с правильным action + before(null) + after(ISO)', async () => {
    mockDb.lead.findUnique.mockResolvedValue(leadStub);

    await setSubmittedAt('lead-1', '2026-05-15');

    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
      userId:     'u-1',
      action:     'lead.set_submitted_at',
      entityType: 'Lead',
      entityId:   'lead-1',
      before:     { submittedAt: null },
      after:      { submittedAt: expect.stringMatching(/^2026-05-15T/) },
    }));
  });

  it('revalidate /clients/{id} И /calendar (без второго подсветка не обновится)', async () => {
    mockDb.lead.findUnique.mockResolvedValue(leadStub);

    await setSubmittedAt('lead-1', '2026-05-15');

    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith('/clients/lead-1');
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith('/calendar');
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledTimes(2);
  });

  it('null → submittedAt=null, audit before содержит старую ISO дату', async () => {
    const oldDate = new Date('2026-04-01T00:00:00.000Z');
    mockDb.lead.findUnique.mockResolvedValue({
      ...leadStub, submittedAt: oldDate,
    });

    await setSubmittedAt('lead-1', null);

    expect(mockDb.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data:  { submittedAt: null },
    });
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
      before: { submittedAt: '2026-04-01T00:00:00.000Z' },
      after:  { submittedAt: null },
    }));
  });

  it('пустая строка → submittedAt=null (не падает с "Некорректная дата")', async () => {
    mockDb.lead.findUnique.mockResolvedValue(leadStub);

    await setSubmittedAt('lead-1', '');

    expect(mockDb.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data:  { submittedAt: null },
    });
  });

  it('возвращает { ok: true }', async () => {
    mockDb.lead.findUnique.mockResolvedValue(leadStub);
    const result = await setSubmittedAt('lead-1', '2026-05-15');
    expect(result).toEqual({ ok: true });
  });

  it('select запроса включает submittedAt (нужен для audit before)', async () => {
    mockDb.lead.findUnique.mockResolvedValue(leadStub);
    await setSubmittedAt('lead-1', '2026-05-15');
    const findCall = mockDb.lead.findUnique.mock.calls[0][0];
    expect(findCall.select).toEqual(expect.objectContaining({
      submittedAt: true,
      salesManagerId: true,
      legalManagerId: true,
    }));
  });
});
