// Интеграционные тесты createLead — главный entry для лидов.
//
// Покрываем:
//   - Дедупликация клиента по телефону
//   - Авто-присвоение SALES менеджера если юзер SALES
//   - Авто-выбор первого этапа воронки если stageId не указан
//   - Авто-расчёт totalAmount из service.basePrice (multi-service)
//   - Создание чек-листа документов из documentTemplate (по услуге или воронке)
//   - audit + revalidatePath
//
// ВАЖНО: createLeadSchema содержит totalAmount: z.coerce.number().default(0),
// поэтому в z.infer<...> (output type) totalAmount: number обязательное.
// Помечаем тип входного аргумента через хелпер CreateLeadInput, чтобы не
// дублировать totalAmount: 0 во всех вызовах теста.
import { describe, it, expect, vi, beforeEach } from 'vitest';

type AnyFn = ReturnType<typeof vi.fn>;

const mockDb = {
  client:           { findUnique: vi.fn() as AnyFn, create: vi.fn() as AnyFn },
  stage:            { findFirst:  vi.fn() as AnyFn },
  documentTemplate: { findMany:   vi.fn() as AnyFn },
  service:          { findMany:   vi.fn() as AnyFn },
  lead:             { create:     vi.fn() as AnyFn },
  leadService:      { createMany: vi.fn() as AnyFn },
  $transaction:     vi.fn() as AnyFn,
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

// Тип входа createLead — это z.infer (output zod) с обязательным totalAmount.
type CreateLeadInput = Parameters<typeof createLead>[0];

// Дефолтный $transaction мок: callback-форма вызывается с mockDb как tx,
// аррей-форма резолвит все промисы. createLead использует callback-форму.
function setupTransactionMock() {
  mockDb.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: typeof mockDb) => Promise<unknown>)(mockDb);
    }
    if (Array.isArray(arg)) return Promise.all(arg);
    return arg;
  });
}

beforeEach(() => {
  Object.values(mockDb).forEach((entity) => {
    if (typeof entity === 'function') (entity as AnyFn).mockReset();
    else Object.values(entity).forEach((fn) => (fn as AnyFn).mockReset());
  });
  mockAudit.mockReset();
  setupTransactionMock();
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
    mockDb.service.findMany.mockResolvedValue([]);
    mockDb.lead.create.mockResolvedValue({ id: 'l-1' });

    const res = await createLead({
      funnelId:    'f-1',
      fullName:    'Иван',
      phone:       '+48123',
      totalAmount: 0,
    } as CreateLeadInput);

    expect(res.clientId).toBe('c-existing');
    expect(mockDb.client.create).not.toHaveBeenCalled();
    expect(mockDb.lead.create).toHaveBeenCalled();
  });

  it('новый клиент → client.create с нормализованным телефоном', async () => {
    mockDb.client.findUnique.mockResolvedValue(null);
    mockDb.client.create.mockResolvedValue({ id: 'c-new' });
    mockDb.stage.findFirst.mockResolvedValue({ id: 's-1' });
    mockDb.documentTemplate.findMany.mockResolvedValue([]);
    mockDb.service.findMany.mockResolvedValue([]);
    mockDb.lead.create.mockResolvedValue({ id: 'l-1' });

    await createLead({
      funnelId:    'f-1',
      fullName:    'Петр',
      phone:       '48-123-456',
      totalAmount: 0,
    } as CreateLeadInput);

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
    mockDb.service.findMany.mockResolvedValue([]);
    mockDb.lead.create.mockResolvedValue({ id: 'l-1' });

    await createLead({
      funnelId:    'f-1',
      clientId:    'c-given',
      totalAmount: 0,
    } as CreateLeadInput);

    expect(mockDb.client.findUnique).not.toHaveBeenCalled();
    expect(mockDb.client.create).not.toHaveBeenCalled();
  });
});

describe('createLead: этап воронки', () => {
  it('без stageId → берётся первый этап воронки', async () => {
    mockDb.client.findUnique.mockResolvedValue({ id: 'c-1' });
    mockDb.stage.findFirst.mockResolvedValue({ id: 's-first', position: 0 });
    mockDb.documentTemplate.findMany.mockResolvedValue([]);
    mockDb.service.findMany.mockResolvedValue([]);
    mockDb.lead.create.mockResolvedValue({ id: 'l-1' });

    await createLead({
      funnelId: 'f-1', clientId: 'c-1', totalAmount: 0,
    } as CreateLeadInput);

    expect(mockDb.stage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where:   { funnelId: 'f-1' },
        orderBy: { position: 'asc' },
      }),
    );
    const leadCall = mockDb.lead.create.mock.calls[0][0];
    expect(leadCall.data.stageId).toBe('s-first');
  });

  it('воронка без этапов → throw', async () => {
    mockDb.client.findUnique.mockResolvedValue({ id: 'c-1' });
    mockDb.stage.findFirst.mockResolvedValue(null);

    await expect(createLead({
      funnelId: 'f-empty', clientId: 'c-1', totalAmount: 0,
    } as CreateLeadInput)).rejects.toThrow('этапов');
    expect(mockDb.lead.create).not.toHaveBeenCalled();
  });
});

describe('createLead: авто-расчёт totalAmount (multi-service)', () => {
  it('выбрана услуга + сумма=0 → берётся basePrice из прайса', async () => {
    mockDb.client.findUnique.mockResolvedValue({ id: 'c-1' });
    mockDb.stage.findFirst.mockResolvedValue({ id: 's-1' });
    mockDb.service.findMany.mockResolvedValue([{ id: 'srv-1', basePrice: 2500 }]);
    mockDb.documentTemplate.findMany.mockResolvedValue([]);
    mockDb.lead.create.mockResolvedValue({ id: 'l-1' });

    await createLead({
      funnelId: 'f-1', clientId: 'c-1',
      serviceId: 'srv-1', totalAmount: 0,
    } as CreateLeadInput);

    const leadCall = mockDb.lead.create.mock.calls[0][0];
    expect(leadCall.data.totalAmount).toBe(2500);
    // Примарная услуга тоже пробрасывается в lead.serviceId
    expect(leadCall.data.serviceId).toBe('srv-1');
  });

  it('явно указанная сумма перекрывает basePrice', async () => {
    mockDb.client.findUnique.mockResolvedValue({ id: 'c-1' });
    mockDb.stage.findFirst.mockResolvedValue({ id: 's-1' });
    mockDb.service.findMany.mockResolvedValue([{ id: 'srv-1', basePrice: 2500 }]);
    mockDb.documentTemplate.findMany.mockResolvedValue([]);
    mockDb.lead.create.mockResolvedValue({ id: 'l-1' });

    await createLead({
      funnelId: 'f-1', clientId: 'c-1',
      serviceId: 'srv-1', totalAmount: 5000,
    } as CreateLeadInput);

    const leadCall = mockDb.lead.create.mock.calls[0][0];
    expect(leadCall.data.totalAmount).toBe(5000);
  });

  it('несколько услуг в services[] → суммируются, leadService.createMany вызывается', async () => {
    mockDb.client.findUnique.mockResolvedValue({ id: 'c-1' });
    mockDb.stage.findFirst.mockResolvedValue({ id: 's-1' });
    mockDb.service.findMany.mockResolvedValue([
      { id: 'srv-A', basePrice: 1000 },
      { id: 'srv-B', basePrice: 2000 },
    ]);
    mockDb.documentTemplate.findMany.mockResolvedValue([]);
    mockDb.lead.create.mockResolvedValue({ id: 'l-multi' });

    await createLead({
      funnelId: 'f-1', clientId: 'c-1',
      services: [
        { serviceId: 'srv-A', qty: 1 },
        { serviceId: 'srv-B', qty: 2, amount: 1500 }, // явный amount перекрывает basePrice
      ],
      totalAmount: 0,
    } as CreateLeadInput);

    const leadCall = mockDb.lead.create.mock.calls[0][0];
    // 1*1000 (basePrice srv-A) + 2*1500 (явный srv-B) = 4000
    expect(leadCall.data.totalAmount).toBe(4000);

    expect(mockDb.leadService.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ serviceId: 'srv-A', amount: 1000, qty: 1 }),
          expect.objectContaining({ serviceId: 'srv-B', amount: 1500, qty: 2 }),
        ]),
      }),
    );
  });
});

describe('createLead: документы в чек-листе', () => {
  it('из documentTemplate создаются LeadDocument с isPresent=false', async () => {
    mockDb.client.findUnique.mockResolvedValue({ id: 'c-1' });
    mockDb.stage.findFirst.mockResolvedValue({ id: 's-1' });
    mockDb.service.findMany.mockResolvedValue([]);
    mockDb.documentTemplate.findMany.mockResolvedValue([
      { name: 'Паспорт', position: 1 },
      { name: 'Селфи', position: 2 },
    ]);
    mockDb.lead.create.mockResolvedValue({ id: 'l-1' });

    await createLead({
      funnelId: 'f-1', clientId: 'c-1', totalAmount: 0,
    } as CreateLeadInput);

    const leadCall = mockDb.lead.create.mock.calls[0][0];
    expect(leadCall.data.documents.create).toHaveLength(2);
    expect(leadCall.data.documents.create[0]).toMatchObject({
      name: 'Паспорт', position: 1, isPresent: false,
    });
  });

  it('две услуги требуют одинаковый документ → дедупликация по имени', async () => {
    mockDb.client.findUnique.mockResolvedValue({ id: 'c-1' });
    mockDb.stage.findFirst.mockResolvedValue({ id: 's-1' });
    mockDb.service.findMany.mockResolvedValue([
      { id: 'srv-A', basePrice: 100 },
      { id: 'srv-B', basePrice: 200 },
    ]);
    mockDb.documentTemplate.findMany.mockResolvedValue([
      { name: 'Загранпаспорт', position: 1, serviceId: 'srv-A' },
      { name: 'Загранпаспорт', position: 1, serviceId: 'srv-B' },
      { name: 'Селфи',       position: 2, serviceId: 'srv-A' },
    ]);
    mockDb.lead.create.mockResolvedValue({ id: 'l-dup' });

    await createLead({
      funnelId: 'f-1', clientId: 'c-1',
      services: [{ serviceId: 'srv-A' }, { serviceId: 'srv-B' }],
      totalAmount: 0,
    } as CreateLeadInput);

    const leadCall = mockDb.lead.create.mock.calls[0][0];
    // «Загранпаспорт» должен остаться только один раз
    const docs = leadCall.data.documents.create as Array<{ name: string }>;
    const passport = docs.filter((d) => d.name === 'Загранпаспорт');
    expect(passport).toHaveLength(1);
    expect(docs).toHaveLength(2); // Паспорт + Селфи
  });
});

describe('createLead: SALES присвоение', () => {
  it('если юзер SALES и не указан salesManagerId → автоприсвоение', async () => {
    mockDb.client.findUnique.mockResolvedValue({ id: 'c-1' });
    mockDb.stage.findFirst.mockResolvedValue({ id: 's-1' });
    mockDb.service.findMany.mockResolvedValue([]);
    mockDb.documentTemplate.findMany.mockResolvedValue([]);
    mockDb.lead.create.mockResolvedValue({ id: 'l-1' });

    await createLead({
      funnelId: 'f-1', clientId: 'c-1', totalAmount: 0,
    } as CreateLeadInput);

    const leadCall = mockDb.lead.create.mock.calls[0][0];
    expect(leadCall.data.salesManagerId).toBe('u-sales');
  });

  it('явный salesManagerId перекрывает авто', async () => {
    mockDb.client.findUnique.mockResolvedValue({ id: 'c-1' });
    mockDb.stage.findFirst.mockResolvedValue({ id: 's-1' });
    mockDb.service.findMany.mockResolvedValue([]);
    mockDb.documentTemplate.findMany.mockResolvedValue([]);
    mockDb.lead.create.mockResolvedValue({ id: 'l-1' });

    await createLead({
      funnelId: 'f-1', clientId: 'c-1',
      salesManagerId: 'u-other', totalAmount: 0,
    } as CreateLeadInput);

    const leadCall = mockDb.lead.create.mock.calls[0][0];
    expect(leadCall.data.salesManagerId).toBe('u-other');
  });
});

describe('createLead: работодатель и город работы', () => {
  it('пробрасываются в lead.create', async () => {
    mockDb.client.findUnique.mockResolvedValue({ id: 'c-1' });
    mockDb.stage.findFirst.mockResolvedValue({ id: 's-1' });
    mockDb.service.findMany.mockResolvedValue([]);
    mockDb.documentTemplate.findMany.mockResolvedValue([]);
    mockDb.lead.create.mockResolvedValue({ id: 'l-1' });

    await createLead({
      funnelId: 'f-1', clientId: 'c-1',
      employerName: 'Sp. z o.o. ABC',
      employerPhone: '+48999',
      workCityId: 'city-warsaw',
      totalAmount: 0,
    } as CreateLeadInput);

    const leadCall = mockDb.lead.create.mock.calls[0][0];
    expect(leadCall.data.employerName).toBe('Sp. z o.o. ABC');
    expect(leadCall.data.employerPhone).toBe('+48999');
    expect(leadCall.data.workCityId).toBe('city-warsaw');
  });
});

describe('createLead: audit + LEAD_CREATED', () => {
  beforeEach(() => {
    mockDb.client.findUnique.mockResolvedValue({ id: 'c-1' });
    mockDb.stage.findFirst.mockResolvedValue({ id: 's-1' });
    mockDb.service.findMany.mockResolvedValue([]);
    mockDb.documentTemplate.findMany.mockResolvedValue([]);
    mockDb.lead.create.mockResolvedValue({ id: 'l-new' });
  });

  it('audit вызывается с lead.create', async () => {
    await createLead({
      funnelId: 'f-1', clientId: 'c-1', totalAmount: 0,
    } as CreateLeadInput);

    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action:     'lead.create',
        entityType: 'Lead',
        entityId:   'l-new',
      }),
    );
  });

  it('Lead.events.create — LEAD_CREATED', async () => {
    await createLead({
      funnelId: 'f-1', clientId: 'c-1', totalAmount: 0,
    } as CreateLeadInput);

    const leadCall = mockDb.lead.create.mock.calls[0][0];
    expect(leadCall.data.events.create).toMatchObject({
      kind: 'LEAD_CREATED',
    });
  });
});
