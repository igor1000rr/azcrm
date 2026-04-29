// Integration: clients/[id]/actions — setEmployer + setWorkCity + setLeadServices
// Покрывает: zod валидацию, проверку прав, audit вызовы, маппинг полей,
// $transaction для setLeadServices с правильным порядком операций.

import { describe, it, expect, vi, beforeEach } from 'vitest';

type AnyFn = ReturnType<typeof vi.fn>;

const mockTx = {
  leadService: {
    deleteMany: vi.fn() as AnyFn,
    createMany: vi.fn() as AnyFn,
  },
  lead: { update: vi.fn() as AnyFn },
};

const mockDb = {
  lead: {
    findUnique: vi.fn() as AnyFn,
    update:     vi.fn() as AnyFn,
  },
  $transaction: vi.fn(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)) as AnyFn,
};

const mockAudit = vi.fn();
const mockCanEditLead = vi.fn(() => true);
const mockNormalizePhone = vi.fn((p: string) => p.replace(/\s+/g, ''));

vi.mock('@/lib/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({ id: 'u-1', email: 'u@a', name: 'U', role: 'SALES' })),
}));
vi.mock('@/lib/permissions', () => ({
  canEditLead: mockCanEditLead,
  assert: vi.fn((cond: boolean) => { if (!cond) throw new Error('Forbidden'); }),
}));
vi.mock('@/lib/audit', () => ({ audit: mockAudit }));
vi.mock('@/lib/utils', async () => ({
  ...(await vi.importActual<object>('@/lib/utils')),
  normalizePhone: mockNormalizePhone,
}));

const { setEmployer, setWorkCity, setLeadServices } = await import('@/app/(app)/clients/[id]/actions');

beforeEach(() => {
  mockDb.lead.findUnique.mockReset();
  mockDb.lead.update.mockReset();
  mockDb.$transaction.mockClear();
  mockTx.leadService.deleteMany.mockReset();
  mockTx.leadService.createMany.mockReset();
  mockTx.lead.update.mockReset();
  mockAudit.mockReset();
  mockCanEditLead.mockReset();
  mockCanEditLead.mockReturnValue(true);
  mockNormalizePhone.mockClear();
});

// ====================== setEmployer ======================

describe('setEmployer', () => {
  it('лид не найден → throw', async () => {
    mockDb.lead.findUnique.mockResolvedValue(null);
    await expect(setEmployer({ leadId: 'lead-1', name: 'Acme', phone: '+48 123' }))
      .rejects.toThrow('Лид не найден');
  });

  it('canEditLead false → throw "Forbidden"', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'lead-1', salesManagerId: 'other', legalManagerId: null,
      employerName: null, employerPhone: null,
    });
    mockCanEditLead.mockReturnValue(false);
    await expect(setEmployer({ leadId: 'lead-1', name: 'X' }))
      .rejects.toThrow('Forbidden');
    expect(mockDb.lead.update).not.toHaveBeenCalled();
  });

  it('успех → lead.update + audit с правильным action', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'lead-1', salesManagerId: 'u-1', legalManagerId: null,
      employerName: 'OldCo', employerPhone: '+48OLD',
    });

    await setEmployer({ leadId: 'lead-1', name: 'NewCo', phone: '+48 999 888' });

    expect(mockDb.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: {
        employerName: 'NewCo',
        employerPhone: '+48999888',
      },
    });
    expect(mockNormalizePhone).toHaveBeenCalledWith('+48 999 888');
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'lead.set_employer',
      entityType: 'Lead',
      entityId: 'lead-1',
    }));
  });

  it('пустое name → сохраняется как null', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'lead-1', salesManagerId: 'u-1', legalManagerId: null,
      employerName: 'Old', employerPhone: null,
    });

    await setEmployer({ leadId: 'lead-1', name: '   ', phone: null });

    expect(mockDb.lead.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { employerName: null, employerPhone: null },
    }));
  });

  it('null phone → не вызывает normalizePhone, employerPhone=null', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'lead-1', salesManagerId: 'u-1', legalManagerId: null,
      employerName: null, employerPhone: '+48OLD',
    });

    await setEmployer({ leadId: 'lead-1', name: 'X', phone: null });

    expect(mockNormalizePhone).not.toHaveBeenCalled();
    expect(mockDb.lead.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ employerPhone: null }),
    }));
  });

  it('zod: leadId не строка → throw', async () => {
    await expect(setEmployer({ leadId: 123 as unknown as string, name: 'X' }))
      .rejects.toThrow();
  });
});

// ====================== setWorkCity ======================

describe('setWorkCity', () => {
  it('лид не найден → throw', async () => {
    mockDb.lead.findUnique.mockResolvedValue(null);
    await expect(setWorkCity('lead-1', 'city-1'))
      .rejects.toThrow('Лид не найден');
  });

  it('canEditLead false → throw', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'lead-1', salesManagerId: 'other', legalManagerId: null, workCityId: null,
    });
    mockCanEditLead.mockReturnValue(false);
    await expect(setWorkCity('lead-1', 'city-1')).rejects.toThrow('Forbidden');
  });

  it('успех → lead.update с workCityId + audit', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'lead-1', salesManagerId: 'u-1', legalManagerId: null, workCityId: 'old-city',
    });

    await setWorkCity('lead-1', 'new-city');

    expect(mockDb.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: { workCityId: 'new-city' },
    });
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'lead.set_work_city',
      before: { workCityId: 'old-city' },
      after:  { workCityId: 'new-city' },
    }));
  });

  it('cityId=null → стирает workCityId', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'lead-1', salesManagerId: 'u-1', legalManagerId: null, workCityId: 'old',
    });
    await setWorkCity('lead-1', null);
    expect(mockDb.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: { workCityId: null },
    });
  });
});

// ====================== setLeadServices ======================

describe('setLeadServices', () => {
  it('лид не найден → throw', async () => {
    mockDb.lead.findUnique.mockResolvedValue(null);
    await expect(setLeadServices({
      leadId: 'lead-1', items: [{ serviceId: 's-1', amount: 100, qty: 1 }],
    })).rejects.toThrow('Лид не найден');
  });

  it('canEditLead false → throw', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'lead-1', salesManagerId: 'other', legalManagerId: null,
      totalAmount: 0, serviceId: null,
    });
    mockCanEditLead.mockReturnValue(false);
    await expect(setLeadServices({
      leadId: 'lead-1', items: [{ serviceId: 's-1', amount: 100, qty: 1 }],
    })).rejects.toThrow('Forbidden');
  });

  it('zod: items без serviceId → throw', async () => {
    await expect(setLeadServices({
      leadId: 'lead-1', items: [{ amount: 100, qty: 1 } as never],
    })).rejects.toThrow();
  });

  it('zod: amount отрицательный → throw', async () => {
    await expect(setLeadServices({
      leadId: 'lead-1', items: [{ serviceId: 's-1', amount: -10, qty: 1 }],
    })).rejects.toThrow();
  });

  it('total = sum(amount * qty)', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'lead-1', salesManagerId: 'u-1', legalManagerId: null,
      totalAmount: 0, serviceId: null,
    });
    const result = await setLeadServices({
      leadId: 'lead-1',
      items: [
        { serviceId: 's-1', amount: 1000, qty: 2 }, // 2000
        { serviceId: 's-2', amount: 500,  qty: 1 }, // 500
      ],
    });
    expect(result.total).toBe(2500);
    // и lead.update внутри транзакции получает правильный total
    expect(mockTx.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: { totalAmount: 2500, serviceId: 's-1' },
    });
  });

  it('primary serviceId = первая услуга в items', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'lead-1', salesManagerId: 'u-1', legalManagerId: null,
      totalAmount: 0, serviceId: 'old-primary',
    });
    await setLeadServices({
      leadId: 'lead-1',
      items: [
        { serviceId: 'svc-A', amount: 100, qty: 1 },
        { serviceId: 'svc-B', amount: 200, qty: 1 },
      ],
    });
    expect(mockTx.lead.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ serviceId: 'svc-A' }),
    }));
  });

  it('пустые items → primary=null, total=0, createMany не вызывается', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'lead-1', salesManagerId: 'u-1', legalManagerId: null,
      totalAmount: 1000, serviceId: 'old',
    });
    const result = await setLeadServices({ leadId: 'lead-1', items: [] });
    expect(result.total).toBe(0);
    expect(mockTx.leadService.createMany).not.toHaveBeenCalled();
    expect(mockTx.lead.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { totalAmount: 0, serviceId: null },
    }));
  });

  it('транзакция: deleteMany ВСЕГДА перед createMany', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'lead-1', salesManagerId: 'u-1', legalManagerId: null,
      totalAmount: 0, serviceId: null,
    });

    // Записываем порядок вызовов
    const calls: string[] = [];
    mockTx.leadService.deleteMany.mockImplementation(async () => { calls.push('delete'); });
    mockTx.leadService.createMany.mockImplementation(async () => { calls.push('create'); });
    mockTx.lead.update.mockImplementation(async () => { calls.push('update'); });

    await setLeadServices({
      leadId: 'lead-1',
      items: [{ serviceId: 's-1', amount: 100, qty: 1 }],
    });
    expect(calls).toEqual(['delete', 'create', 'update']);
  });

  it('createMany получает items с position 0..N', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'lead-1', salesManagerId: 'u-1', legalManagerId: null,
      totalAmount: 0, serviceId: null,
    });
    await setLeadServices({
      leadId: 'lead-1',
      items: [
        { serviceId: 's-A', amount: 100, qty: 1, notes: 'note A' },
        { serviceId: 's-B', amount: 200, qty: 2 },
      ],
    });
    expect(mockTx.leadService.createMany).toHaveBeenCalledWith({
      data: [
        { leadId: 'lead-1', serviceId: 's-A', amount: 100, qty: 1, notes: 'note A', position: 0 },
        { leadId: 'lead-1', serviceId: 's-B', amount: 200, qty: 2, notes: null,     position: 1 },
      ],
    });
  });

  it('audit вызывается с правильными before/after', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'lead-1', salesManagerId: 'u-1', legalManagerId: null,
      totalAmount: 500, serviceId: 'old-svc',
    });
    await setLeadServices({
      leadId: 'lead-1',
      items: [{ serviceId: 'new-svc', amount: 1000, qty: 1 }],
    });

    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'lead.set_services',
      before: { totalAmount: 500, serviceId: 'old-svc' },
      after:  { totalAmount: 1000, serviceId: 'new-svc', count: 1 },
    }));
  });
});
