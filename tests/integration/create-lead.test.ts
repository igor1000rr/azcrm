// Интеграционные тесты createLead — главный entry для лидов.
//
// Покрываем:
//   - Дедупликация клиента по телефону
//   - Авто-присвоение SALES менеджера если юзер SALES
//   - Авто-выбор первого этапа воронки если stageId не указан
//   - Авто-расчёт totalAmount из service.basePrice
//   - Создание чек-листа документов из documentTemplate
//   - audit + revalidatePath
import { describe, it, expect, vi, beforeEach } from 'vitest';

type AnyFn = ReturnType<typeof vi.fn>;

const mockDb = {
  client:           { findUnique: vi.fn() as AnyFn, create: vi.fn() as AnyFn },
  stage:            { findFirst:  vi.fn() as AnyFn },
  documentTemplate: { findMany:   vi.fn() as AnyFn },
  service:          { findUnique: vi.fn() as AnyFn },
  lead:             { create:     vi.fn() as AnyFn },
};

const mockAudit = vi.fn();

vi.mock('@/lib/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth', () => ({
  requireUser:  vi.fn(async () => ({ id: 'u-sales', email: 's@a', name: 'Sales', role: 'SALES' })),
  requireAdmin: vi.fn(async () => ({ id: 'u-sales', email: 's@a', name: 'Admin', role: 'ADMIN' })),
}));
vi.mock('@/lib/permissions', () => ({
  canEditLead:           vi.fn(() => true),
  canTransferLead:       vi.fn(() => true),
  canAssignLegalManager: vi.fn(() => true),
  canDeletePayment:      vi.fn(() => true),
  assert: vi.fn((cond: boolean) => {
    if (!cond) throw new Error('Forbidden');
  }),
}));
vi.mock('@/lib/audit',  () => ({ audit:  mockAudit }));
vi.mock('@/lib/notify', () => ({ notify: vi.fn()  }));
vi.mock('@/lib/utils',  () => ({
  normalizePhone: (s: string) => '+' + (s || '').replace(/\D/g, ''),
}));

const { createLead } = await import('@/app/(app)/actions');

beforeEach(() => {
  Object.values(mockDb).forEach((entity) => {
    Object.values(entity).forEach((fn) => (fn as AnyFn).mockReset());
  });
  mockAudit.mockReset();
});

describe('createLead: валидация', () => {
  it('без funnelId → zod throw', async () => {
    await expect(createLead({} as never)).rejects.toThrow();
  });

  it('новый клиент без fullName и phone → throw', async () => {
    await expect(createLead({ funnelId: 'f-1' } as never))
      .rejects.toThrow('ФИО и телефон');
  });
});

describe('createLead: дедупликация клиента', () => {
  it('существующий по телефону → используется его id, client.create НЕ вызывается', async () => {
    mockDb.client.findUnique.mockResolvedValue({ id: 'c-existing' });
    mockDb.stage.findFirst.mockResolvedValue({ id: 's-1', position: 0 });
    mockDb.documentTemplate.findMany.mockResolvedValue([]);
    mockDb.lead.create.mockResolvedValue({ id: 'l-1' });

    const res = await createLead({
      funnelId: 'f-1',
      fullName: 'Иван',
      phone:    '+48123',
    });

    expect(res.clientId).toBe('c-existing');
    expect(mockDb.client.create).not.toHaveBeenCalled();
    expect(mockDb.lead.create).toHaveBeenCalled();
  });

  it('новый клиент → client.create с нормализованным телефоном', async () => {
    mockDb.client.findUnique.mockResolvedValue(null);
    mockDb.client.create.mockResolvedValue({ id: 'c-new' });
    mockDb.stage.findFirst.mockResolvedValue({ id: 's-1' });
    mockDb.documentTemplate.findMany.mockResolvedValue([]);
    mockDb.lead.create.mockResolvedValue({ id: 'l-1' });

    await createLead({
      funnelId: 'f-1',
      fullName: 'Петр',
      phone:    '48-123-456',
    });

    expect(mockDb.client.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fullName: 'Петр',
          phone:    '+48123456',
          ownerId:  'u-sales',
        }),
      }),
    );
  });

  it('явно указан clientId → ни findUnique, ни create', async () => {
    mockDb.stage.findFirst.mockResolvedValue({ id: 's-1' });
    mockDb.documentTemplate.findMany.mockResolvedValue([]);
    mockDb.lead.create.mockResolvedValue({ id: 'l-1' });

    await createLead({ funnelId: 'f-1', clientId: 'c-given' });

    expect(mockDb.client.findUnique).not.toHaveBeenCalled();
    expect(mockDb.client.create).not.toHaveBeenCalled();
  });
});

describe('createLead: этап воронки', () => {
  it('без stageId → берётся первый этап воронки', async () => {
    mockDb.client.findUnique.mockResolvedValue({ id: 'c-1' });
    mockDb.stage.findFirst.mockResolvedValue({ id: 's-first', position: 0 });
    mockDb.documentTemplate.findMany.mockResolvedValue([]);
    mockDb.lead.create.mockResolvedValue({ id: 'l-1' });

    await createLead({ funnelId: 'f-1', clientId: 'c-1' });

    expect(mockDb.stage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { funnelId: 'f-1' },
        orderBy: { position: 'asc' },
      }),
    );
    const leadCall = mockDb.lead.create.mock.calls[0][0];
    expect(leadCall.data.stageId).toBe('s-first');
  });

  it('воронка без этапов → throw', async () => {
    mockDb.client.findUnique.mockResolvedValue({ id: 'c-1' });
    mockDb.stage.findFirst.mockResolvedValue(null);

    await expect(createLead({ funnelId: 'f-empty', clientId: 'c-1' }))
      .rejects.toThrow('этапов');
    expect(mockDb.lead.create).not.toHaveBeenCalled();
  });
});

describe('createLead: авто-расчёт totalAmount', () => {
  it('выбрана услуга + сумма=0 → берётся basePrice из прайса', async () => {
    mockDb.client.findUnique.mockResolvedValue({ id: 'c-1' });
    mockDb.stage.findFirst.mockResolvedValue({ id: 's-1' });
    mockDb.service.findUnique.mockResolvedValue({ basePrice: 2500 });
    mockDb.documentTemplate.findMany.mockResolvedValue([]);
    mockDb.lead.create.mockResolvedValue({ id: 'l-1' });

    await createLead({
      funnelId: 'f-1', clientId: 'c-1',
      serviceId: 'srv-1', totalAmount: 0,
    });

    const leadCall = mockDb.lead.create.mock.calls[0][0];
    expect(leadCall.data.totalAmount).toBe(2500);
  });

  it('явно указанная сумма перекрывает basePrice', async () => {
    mockDb.client.findUnique.mockResolvedValue({ id: 'c-1' });
    mockDb.stage.findFirst.mockResolvedValue({ id: 's-1' });
    mockDb.documentTemplate.findMany.mockResolvedValue([]);
    mockDb.lead.create.mockResolvedValue({ id: 'l-1' });

    await createLead({
      funnelId: 'f-1', clientId: 'c-1',
      serviceId: 'srv-1', totalAmount: 5000,
    });

    const leadCall = mockDb.lead.create.mock.calls[0][0];
    expect(leadCall.data.totalAmount).toBe(5000);
    expect(mockDb.service.findUnique).not.toHaveBeenCalled();
  });
});

describe('createLead: документы в чек-листе', () => {
  it('из documentTemplate создаются LeadDocument с isPresent=false', async () => {
    mockDb.client.findUnique.mockResolvedValue({ id: 'c-1' });
    mockDb.stage.findFirst.mockResolvedValue({ id: 's-1' });
    mockDb.documentTemplate.findMany.mockResolvedValue([
      { name: 'Паспорт', position: 1 },
      { name: 'Селфи', position: 2 },
    ]);
    mockDb.lead.create.mockResolvedValue({ id: 'l-1' });

    await createLead({ funnelId: 'f-1', clientId: 'c-1' });

    const leadCall = mockDb.lead.create.mock.calls[0][0];
    expect(leadCall.data.documents.create).toHaveLength(2);
    expect(leadCall.data.documents.create[0]).toMatchObject({
      name: 'Паспорт', position: 1, isPresent: false,
    });
  });
});

describe('createLead: SALES присвоение', () => {
  it('если юзер SALES и не указан salesManagerId → автоприсвоение', async () => {
    mockDb.client.findUnique.mockResolvedValue({ id: 'c-1' });
    mockDb.stage.findFirst.mockResolvedValue({ id: 's-1' });
    mockDb.documentTemplate.findMany.mockResolvedValue([]);
    mockDb.lead.create.mockResolvedValue({ id: 'l-1' });

    await createLead({ funnelId: 'f-1', clientId: 'c-1' });

    const leadCall = mockDb.lead.create.mock.calls[0][0];
    expect(leadCall.data.salesManagerId).toBe('u-sales');
  });

  it('явный salesManagerId перекрывает авто', async () => {
    mockDb.client.findUnique.mockResolvedValue({ id: 'c-1' });
    mockDb.stage.findFirst.mockResolvedValue({ id: 's-1' });
    mockDb.documentTemplate.findMany.mockResolvedValue([]);
    mockDb.lead.create.mockResolvedValue({ id: 'l-1' });

    await createLead({ funnelId: 'f-1', clientId: 'c-1', salesManagerId: 'u-other' });

    const leadCall = mockDb.lead.create.mock.calls[0][0];
    expect(leadCall.data.salesManagerId).toBe('u-other');
  });
});

describe('createLead: audit + LEAD_CREATED', () => {
  beforeEach(() => {
    mockDb.client.findUnique.mockResolvedValue({ id: 'c-1' });
    mockDb.stage.findFirst.mockResolvedValue({ id: 's-1' });
    mockDb.documentTemplate.findMany.mockResolvedValue([]);
    mockDb.lead.create.mockResolvedValue({ id: 'l-new' });
  });

  it('audit вызывается с lead.create', async () => {
    await createLead({ funnelId: 'f-1', clientId: 'c-1' });

    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action:     'lead.create',
        entityType: 'Lead',
        entityId:   'l-new',
      }),
    );
  });

  it('Lead.events.create — LEAD_CREATED', async () => {
    await createLead({ funnelId: 'f-1', clientId: 'c-1' });

    const leadCall = mockDb.lead.create.mock.calls[0][0];
    expect(leadCall.data.events.create).toMatchObject({
      kind: 'LEAD_CREATED',
    });
  });
});
