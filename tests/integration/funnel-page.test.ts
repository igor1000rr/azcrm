// Integration-тесты серверного компонента FunnelPage.
// Проверяем что страница ПРАВИЛЬНО запрашивает данные из БД:
//   - сортировка orderBy: { updatedAt: 'desc' } (БАГ Anna: «не сортирует»)
//   - where строится через buildPrismaLeadFilter (фикс city OR workCity)
//   - decisionStageIds = stages.filter(isFinal && !isLost)
//   - менеджеры запрашиваются только для ADMIN
//   - пустой funnels → заглушка
//   - все фильтры из URL правильно прокидываются

import { describe, it, expect, vi, beforeEach } from 'vitest';

type AnyFn = ReturnType<typeof vi.fn>;

const mockDb = {
  funnel: { findMany: vi.fn() as AnyFn },
  stage:  { findMany: vi.fn() as AnyFn },
  lead:   { findMany: vi.fn() as AnyFn },
  city:   { findMany: vi.fn() as AnyFn },
  user:   { findMany: vi.fn() as AnyFn },
};

const mockRequireUser = vi.fn();

vi.mock('@/lib/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth', () => ({ requireUser: mockRequireUser }));

const FunnelPage = (await import('@/app/(app)/funnel/page')).default;

// ====================== HELPERS ======================

function makeFunnel(over: any = {}) {
  return {
    id: 'f-1', name: 'Karta praca', color: '#0A1A35', position: 1,
    _count: { leads: 5 },
    ...over,
  };
}

function makeStage(over: any = {}) {
  return {
    id: 's-1', name: 'Новый', color: '#3B82F6', position: 1,
    isFinal: false, isLost: false, funnelId: 'f-1',
    ...over,
  };
}

function makeLead(over: any = {}) {
  return {
    id: 'l-1', clientId: 'c-1', funnelId: 'f-1', stageId: 's-1',
    totalAmount: 1000, source: null, fingerprintDate: null,
    updatedAt: new Date('2026-04-28T22:00:00Z'),
    client: { id: 'c-1', fullName: 'Иванов Иван', phone: '+48 731', nationality: 'BY' },
    stage: { id: 's-1', name: 'Новый', color: '#3B82F6' },
    city: null, salesManager: null, legalManager: null, whatsappAccount: null,
    _count: { documents: 0, payments: 0 },
    documents: [], payments: [],
    ...over,
  };
}

const ADMIN_USER = { id: 'a1', email: 'a@x', name: 'A', role: 'ADMIN' };
const SALES_USER = { id: 's1', email: 's@x', name: 'S', role: 'SALES' };

// ====================== СБРОС МОКОВ ======================

beforeEach(() => {
  Object.values(mockDb).forEach((m) => Object.values(m).forEach((fn) => (fn as AnyFn).mockReset()));
  mockRequireUser.mockReset();
  mockRequireUser.mockResolvedValue(ADMIN_USER);

  // Дефолты
  mockDb.funnel.findMany.mockResolvedValue([makeFunnel()]);
  mockDb.stage.findMany.mockResolvedValue([makeStage()]);
  mockDb.lead.findMany.mockResolvedValue([]);
  mockDb.city.findMany.mockResolvedValue([]);
  mockDb.user.findMany.mockResolvedValue([]);
});

// ====================== СОРТИРОВКА (КЛЮЧЕВОЕ) ======================

describe('FunnelPage — сортировка лидов', () => {
  it('БАГ Anna: db.lead.findMany вызван с orderBy: { updatedAt: "desc" }', async () => {
    await FunnelPage({ searchParams: Promise.resolve({}) });

    expect(mockDb.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { updatedAt: 'desc' },
      }),
    );
  });

  it('сортировка остаётся desc даже когда есть фильтры', async () => {
    await FunnelPage({ searchParams: Promise.resolve({ city: 'c1', q: 'Иван' }) });

    expect(mockDb.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { updatedAt: 'desc' } }),
    );
  });
});

// ====================== WHERE-ФИЛЬТРЫ ======================

describe('FunnelPage — построение Prisma where', () => {
  it('базовый where включает funnelId и isArchived: false', async () => {
    await FunnelPage({ searchParams: Promise.resolve({}) });

    const call = mockDb.lead.findMany.mock.calls[0][0];
    const where = call.where as { AND: any[] };
    expect(where.AND).toContainEqual({ funnelId: 'f-1' });
    expect(where.AND).toContainEqual({ isArchived: false });
  });

  it('city → OR по cityId и workCityId (фикс БАГ Anna)', async () => {
    await FunnelPage({ searchParams: Promise.resolve({ city: 'lodz' }) });

    const where = mockDb.lead.findMany.mock.calls[0][0].where as { AND: any[] };
    const cityCondition = where.AND.find((c: any) => 'OR' in c && JSON.stringify(c).includes('cityId'));
    expect(cityCondition).toEqual({
      OR: [{ cityId: 'lodz' }, { workCityId: 'lodz' }],
    });
  });

  it('mgr → OR по salesManagerId и legalManagerId', async () => {
    await FunnelPage({ searchParams: Promise.resolve({ mgr: 'u-2' }) });

    const where = mockDb.lead.findMany.mock.calls[0][0].where as { AND: any[] };
    const mgrCondition = where.AND.find((c: any) => 'OR' in c && JSON.stringify(c).includes('salesManagerId'));
    expect(mgrCondition).toEqual({
      OR: [{ salesManagerId: 'u-2' }, { legalManagerId: 'u-2' }],
    });
  });

  it('SALES юзер → добавляется фильтр видимости', async () => {
    mockRequireUser.mockResolvedValue(SALES_USER);
    await FunnelPage({ searchParams: Promise.resolve({}) });

    const where = mockDb.lead.findMany.mock.calls[0][0].where as { AND: any[] };
    // SALES должен видеть только свои лиды
    const visCondition = where.AND.find(
      (c: any) => 'OR' in c && JSON.stringify(c).includes('salesManagerId'),
    );
    expect(visCondition).toBeDefined();
  });

  it('ADMIN — без фильтра видимости в where', async () => {
    await FunnelPage({ searchParams: Promise.resolve({}) });

    const where = mockDb.lead.findMany.mock.calls[0][0].where as { AND: any[] };
    // У ADMIN только funnelId + isArchived (без mgr и city — их нет в URL)
    expect(where.AND).toHaveLength(2);
  });
});

// ====================== ЗАПРОСЫ К БД ======================

describe('FunnelPage — запросы к БД', () => {
  it('funnels запрашиваются по isActive с сортировкой по position asc', async () => {
    await FunnelPage({ searchParams: Promise.resolve({}) });

    expect(mockDb.funnel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true },
        orderBy: { position: 'asc' },
      }),
    );
  });

  it('stages запрашиваются для текущей воронки', async () => {
    mockDb.funnel.findMany.mockResolvedValue([makeFunnel({ id: 'f-A' }), makeFunnel({ id: 'f-B' })]);
    await FunnelPage({ searchParams: Promise.resolve({ funnel: 'f-B' }) });

    expect(mockDb.stage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where:   { funnelId: 'f-B' },
        orderBy: { position: 'asc' },
      }),
    );
  });

  it('cities запрашиваются с isActive: true и сортировкой по position', async () => {
    await FunnelPage({ searchParams: Promise.resolve({}) });

    expect(mockDb.city.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true },
        orderBy: { position: 'asc' },
      }),
    );
  });

  it('менеджеры запрашиваются ТОЛЬКО для ADMIN', async () => {
    await FunnelPage({ searchParams: Promise.resolve({}) });
    expect(mockDb.user.findMany).toHaveBeenCalled();
  });

  it('менеджеры НЕ запрашиваются для SALES', async () => {
    mockRequireUser.mockResolvedValue(SALES_USER);
    await FunnelPage({ searchParams: Promise.resolve({}) });
    expect(mockDb.user.findMany).not.toHaveBeenCalled();
  });

  it('lead.findMany включает client/stage/city/managers/payments', async () => {
    await FunnelPage({ searchParams: Promise.resolve({}) });

    const call = mockDb.lead.findMany.mock.calls[0][0];
    expect(call.include).toEqual(expect.objectContaining({
      client: expect.any(Object),
      stage: expect.any(Object),
      city: expect.any(Object),
      salesManager: expect.any(Object),
      legalManager: expect.any(Object),
      payments: expect.any(Object),
    }));
  });
});

// ====================== ВЫБОР ТЕКУЩЕЙ ВОРОНКИ ======================

describe('FunnelPage — выбор текущей воронки', () => {
  it('без funnel в URL → берёт первую воронку', async () => {
    mockDb.funnel.findMany.mockResolvedValue([
      makeFunnel({ id: 'f-A' }),
      makeFunnel({ id: 'f-B' }),
    ]);
    await FunnelPage({ searchParams: Promise.resolve({}) });

    expect(mockDb.stage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { funnelId: 'f-A' } }),
    );
  });

  it('с funnel=ID в URL → берёт указанную воронку', async () => {
    mockDb.funnel.findMany.mockResolvedValue([
      makeFunnel({ id: 'f-A' }),
      makeFunnel({ id: 'f-B' }),
    ]);
    await FunnelPage({ searchParams: Promise.resolve({ funnel: 'f-B' }) });

    expect(mockDb.stage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { funnelId: 'f-B' } }),
    );
  });

  it('funnel=несуществующий ID в URL → fallback на первую', async () => {
    mockDb.funnel.findMany.mockResolvedValue([makeFunnel({ id: 'f-A' })]);
    await FunnelPage({ searchParams: Promise.resolve({ funnel: 'f-NOTFOUND' }) });

    expect(mockDb.stage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { funnelId: 'f-A' } }),
    );
  });
});

// ====================== ПУСТЫЕ ВОРОНКИ → ЗАГЛУШКА ======================

describe('FunnelPage — нет воронок', () => {
  it('funnels=[] → ранний return заглушки, не запрашивает leads', async () => {
    mockDb.funnel.findMany.mockResolvedValue([]);
    await FunnelPage({ searchParams: Promise.resolve({}) });

    expect(mockDb.lead.findMany).not.toHaveBeenCalled();
    expect(mockDb.stage.findMany).not.toHaveBeenCalled();
  });
});

// ====================== KPI РАСЧЁТ ======================

describe('FunnelPage — расчёт KPI и обогащение', () => {
  it('KPI считается по фильтрованным лидам (после search и debt)', async () => {
    const leads = [
      makeLead({ id: 'l1', totalAmount: 1000, payments: [{ amount: 500 }], stage: { id: 's-won', name: 'Win', color: null } }),
      makeLead({ id: 'l2', totalAmount: 500, payments: [], stage: { id: 's-1', name: 'New', color: null } }),
    ];
    mockDb.lead.findMany.mockResolvedValue(leads);
    mockDb.stage.findMany.mockResolvedValue([
      makeStage({ id: 's-won', isFinal: true, isLost: false }),
      makeStage({ id: 's-1' }),
    ]);

    const result = await FunnelPage({ searchParams: Promise.resolve({}) });

    // Выгребаем kpi из props FunnelView (это второй child JSX-fragment)
    const kpiProps = (result as any).props.children[1].props.kpi;
    expect(kpiProps.leadsCount).toBe(2);
    expect(kpiProps.totalAmount).toBe(1500);
    expect(kpiProps.totalPaid).toBe(500);
    expect(kpiProps.totalDebt).toBe(1000);
    expect(kpiProps.decisionCount).toBe(1);
    expect(kpiProps.conversion).toBe(50); // 1/2 = 50%
  });

  it('decisionStageIds = только isFinal && !isLost', async () => {
    mockDb.stage.findMany.mockResolvedValue([
      makeStage({ id: 'work',  isFinal: false, isLost: false }),
      makeStage({ id: 'won',   isFinal: true,  isLost: false }),
      makeStage({ id: 'lost',  isFinal: true,  isLost: true  }),
    ]);
    mockDb.lead.findMany.mockResolvedValue([
      makeLead({ id: 'l1', stage: { id: 'won', name: 'W', color: null } }),
      makeLead({ id: 'l2', stage: { id: 'lost', name: 'L', color: null } }),
    ]);

    const result = await FunnelPage({ searchParams: Promise.resolve({}) });

    const kpiProps = (result as any).props.children[1].props.kpi;
    // Только 'won' попал в decision (lost — это слив, не считается)
    expect(kpiProps.decisionCount).toBe(1);
  });

  it('search-фильтр применяется к лидам ДО KPI', async () => {
    mockDb.lead.findMany.mockResolvedValue([
      makeLead({ id: 'l1', client: { id: 'c1', fullName: 'Иванов', phone: '+48 731', nationality: null } }),
      makeLead({ id: 'l2', client: { id: 'c2', fullName: 'Петров', phone: '+48 999', nationality: null } }),
    ]);

    const result = await FunnelPage({ searchParams: Promise.resolve({ q: 'Иванов' }) });

    const leadsProps = (result as any).props.children[1].props.leads;
    expect(leadsProps).toHaveLength(1);
    expect(leadsProps[0].clientName).toBe('Иванов');
  });

  it('debt=1 фильтрует только лидов с долгом', async () => {
    mockDb.lead.findMany.mockResolvedValue([
      makeLead({ id: 'paid', totalAmount: 1000, payments: [{ amount: 1000 }] }),
      makeLead({ id: 'debt', totalAmount: 1000, payments: [{ amount: 500 }] }),
    ]);

    const result = await FunnelPage({ searchParams: Promise.resolve({ debt: '1' }) });

    const leadsProps = (result as any).props.children[1].props.leads;
    expect(leadsProps).toHaveLength(1);
    expect(leadsProps[0].id).toBe('debt');
  });
});

// ====================== ENRICHED ЛИДЫ ======================

describe('FunnelPage — enriched лиды (paid/debt)', () => {
  it('paid и debt считаются на лиде', async () => {
    mockDb.lead.findMany.mockResolvedValue([
      makeLead({ id: 'l1', totalAmount: 1000, payments: [{ amount: 300 }, { amount: 200 }] }),
    ]);

    const result = await FunnelPage({ searchParams: Promise.resolve({}) });

    const leadsProps = (result as any).props.children[1].props.leads;
    expect(leadsProps[0].paid).toBe(500);
    expect(leadsProps[0].debt).toBe(500);
  });

  it('переплата → debt=0 (не отрицательный)', async () => {
    mockDb.lead.findMany.mockResolvedValue([
      makeLead({ id: 'l1', totalAmount: 100, payments: [{ amount: 200 }] }),
    ]);

    const result = await FunnelPage({ searchParams: Promise.resolve({}) });

    const leadsProps = (result as any).props.children[1].props.leads;
    expect(leadsProps[0].debt).toBe(0);
    expect(leadsProps[0].paid).toBe(200);
  });

  it('source: WhatsApp label если нет explicit source', async () => {
    mockDb.lead.findMany.mockResolvedValue([
      makeLead({
        id: 'l1', source: null,
        whatsappAccount: { id: 'w1', label: 'WA Anna' },
      }),
    ]);

    const result = await FunnelPage({ searchParams: Promise.resolve({}) });

    const leadsProps = (result as any).props.children[1].props.leads;
    expect(leadsProps[0].source).toBe('WA Anna');
  });

  it('docsHave = количество документов с isPresent=true', async () => {
    mockDb.lead.findMany.mockResolvedValue([
      makeLead({
        id: 'l1',
        documents: [{ isPresent: true }, { isPresent: false }, { isPresent: true }],
        _count: { documents: 3, payments: 0 },
      }),
    ]);

    const result = await FunnelPage({ searchParams: Promise.resolve({}) });

    const leadsProps = (result as any).props.children[1].props.leads;
    expect(leadsProps[0].docsHave).toBe(2);
    expect(leadsProps[0].docsCount).toBe(3);
  });
});

// ====================== ПОЛНАЯ ЦЕПОЧКА ======================

describe('FunnelPage — полный сценарий Anna', () => {
  it('Anna фильтрует Łódź + только долги + ищет Иванов → правильный результат', async () => {
    mockDb.funnel.findMany.mockResolvedValue([makeFunnel({ id: 'f-1' })]);
    mockDb.stage.findMany.mockResolvedValue([
      makeStage({ id: 's-work', isFinal: false }),
      makeStage({ id: 's-won', isFinal: true, isLost: false }),
    ]);
    // Prisma вернёт только лиды попавшие под city и SALES visibility (моки)
    mockDb.lead.findMany.mockResolvedValue([
      makeLead({ id: 'l1', totalAmount: 1000, payments: [{ amount: 500 }],
                 client: { id: 'c1', fullName: 'Иванов Иван', phone: '+48 731', nationality: null } }),
      makeLead({ id: 'l2', totalAmount: 800, payments: [{ amount: 300 }],
                 client: { id: 'c2', fullName: 'Иванова Анна', phone: '+48 600', nationality: null } }),
      makeLead({ id: 'l3', totalAmount: 500, payments: [{ amount: 500 }],
                 client: { id: 'c3', fullName: 'Иванов Без долга', phone: '+48 700', nationality: null } }),
    ]);

    const result = await FunnelPage({
      searchParams: Promise.resolve({ city: 'lodz', debt: '1', q: 'Иванов' }),
    });

    const leadsProps = (result as any).props.children[1].props.leads;
    // Должны остаться: l1 (долг 500) и l2 (долг 500), но не l3 (нет долга)
    expect(leadsProps).toHaveLength(2);
    expect(leadsProps.map((l: any) => l.id).sort()).toEqual(['l1', 'l2']);

    // KPI пересчитан
    const kpi = (result as any).props.children[1].props.kpi;
    expect(kpi.leadsCount).toBe(2);
    expect(kpi.totalDebt).toBe(1000);
    expect(kpi.debtorsCount).toBe(2);
  });

  it('сортировка orderBy: updatedAt desc применяется И с фильтрами', async () => {
    await FunnelPage({
      searchParams: Promise.resolve({ city: 'lodz', mgr: 'u-1', debt: '1', q: 'test' }),
    });

    expect(mockDb.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { updatedAt: 'desc' } }),
    );
  });
});
