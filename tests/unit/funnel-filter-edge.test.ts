// Дополнительные edge-cases на pure-функции воронки.
// Реальные сценарии которые могут случиться на проде у Anna:
//   - лид без телефона (null/пустая строка) при поиске
//   - лид без totalAmount (0)
//   - лид без платежей
//   - смесь Decimal от Prisma и обычных number
//   - поиск с одной цифрой
//   - очень длинный запрос
//   - LEGAL роль (не покрыта основными тестами)
//
// Прогнаны локально 49 тестов (этот файл + funnel-filter.test.ts) — все ✓

import { describe, it, expect } from 'vitest';
import {
  buildPrismaLeadFilter,
  applySearchFilter,
  applyDebtFilter,
  calculateKPI,
  looksLikePhone,
  type LeadForFilter,
} from '@/lib/funnel-filter';
import type { SessionUser } from '@/lib/permissions';

const LEGAL: SessionUser = { id: 'l', email: 'l@x', name: 'L', role: 'LEGAL' };

function makeLead(over: Partial<LeadForFilter> = {}): LeadForFilter {
  return {
    id:          'l',
    totalAmount: 1000,
    client:      { fullName: 'Test', phone: '+48 731 006 935' },
    payments:    [],
    stage:       { id: 's1' },
    ...over,
  };
}

// ====================== РОЛЬ LEGAL ======================

describe('LEGAL роль — visibility filter', () => {
  it('LEGAL получает фильтр видимости как и SALES', () => {
    const w = buildPrismaLeadFilter({ funnelId: 'f1', user: LEGAL });
    const conditions = (w as { AND: Record<string, unknown>[] }).AND;
    expect(conditions.length).toBeGreaterThan(2);
    const visCondition = conditions.find(
      (c) => 'OR' in c && JSON.stringify(c).includes('legalManagerId'),
    );
    expect(visCondition).toBeDefined();
  });

  it('LEGAL видит лидов где он salesMgr ИЛИ legalMgr', () => {
    const w = buildPrismaLeadFilter({ funnelId: 'f1', user: LEGAL });
    const conditions = (w as { AND: Record<string, unknown>[] }).AND;
    const visCondition = conditions.find((c) => 'OR' in c) as { OR: object[] };
    expect(visCondition.OR).toContainEqual({ salesManagerId: 'l' });
    expect(visCondition.OR).toContainEqual({ legalManagerId: 'l' });
  });
});

// ====================== ПОИСК — КРАЙНИЕ СЛУЧАИ ======================

describe('applySearchFilter — крайние случаи', () => {
  const leadsWithEmptyPhone = [
    makeLead({ id: 'normal',  client: { fullName: 'Иван',  phone: '+48 731 006 935' } }),
    makeLead({ id: 'noPhone', client: { fullName: 'Петр',  phone: '' } }),
  ];

  it('поиск тел не падает на пустом телефоне', () => {
    expect(() => applySearchFilter(leadsWithEmptyPhone, '731')).not.toThrow();
    expect(applySearchFilter(leadsWithEmptyPhone, '731').map((l) => l.id)).toEqual(['normal']);
  });

  it('поиск имени не зависит от телефона', () => {
    expect(applySearchFilter(leadsWithEmptyPhone, 'Петр').map((l) => l.id)).toEqual(['noPhone']);
  });

  it('поиск одной цифры — расценивается как телефон', () => {
    expect(looksLikePhone('1')).toBe(true);
    const leads = [
      makeLead({ id: 'l1', client: { fullName: 'A', phone: '+48 100' } }),
      makeLead({ id: 'l2', client: { fullName: 'B', phone: '+48 200' } }),
    ];
    expect(applySearchFilter(leads, '1').map((l) => l.id)).toEqual(['l1']);
  });

  it('поиск с пробелами в начале/конце триммится', () => {
    const leads = [makeLead({ id: 'x', client: { fullName: 'Иван', phone: '+48 100' } })];
    expect(applySearchFilter(leads, '  Иван  ').map((l) => l.id)).toEqual(['x']);
    expect(applySearchFilter(leads, '   100   ').map((l) => l.id)).toEqual(['x']);
  });

  it('поиск тел со скобками и точками', () => {
    const leads = [makeLead({ id: 'x', client: { fullName: 'A', phone: '+48 (731) 006-935' } })];
    expect(applySearchFilter(leads, '(731)').map((l) => l.id)).toEqual(['x']);
    // Точки не входят в looksLikePhone — будет считаться поиск по имени → ничего не найдёт
    expect(applySearchFilter(leads, '731.006').map((l) => l.id)).toEqual([]);
  });

  it('очень длинный поисковый запрос', () => {
    const leads = [makeLead({ id: 'x', client: { fullName: 'Тест', phone: '+48 100' } })];
    const longQuery = 'А'.repeat(1000);
    expect(() => applySearchFilter(leads, longQuery)).not.toThrow();
    expect(applySearchFilter(leads, longQuery)).toEqual([]);
  });
});

// ====================== KPI — КРАЙНИЕ СЛУЧАИ ======================

describe('calculateKPI — крайние случаи', () => {
  it('лид без totalAmount (0) и без payments', () => {
    const leads = [makeLead({ totalAmount: 0, payments: [] })];
    const kpi = calculateKPI(leads, ['decision']);
    expect(kpi.totalAmount).toBe(0);
    expect(kpi.totalPaid).toBe(0);
    expect(kpi.totalDebt).toBe(0);
    expect(kpi.debtorsCount).toBe(0);
  });

  it('много мелких платежей складываются точно', () => {
    const leads = [makeLead({
      totalAmount: 100,
      payments: Array.from({ length: 10 }, () => ({ amount: 10 })),
    })];
    const kpi = calculateKPI(leads, []);
    expect(kpi.totalPaid).toBe(100);
    expect(kpi.totalDebt).toBe(0);
  });

  it('decisionStageIds пустой массив → конверсия 0', () => {
    const leads = [
      makeLead({ stage: { id: 's1' } }),
      makeLead({ stage: { id: 's2' } }),
    ];
    expect(calculateKPI(leads, []).conversion).toBe(0);
    expect(calculateKPI(leads, []).decisionCount).toBe(0);
  });

  it('смесь Decimal и number в одном расчёте', () => {
    const leads = [
      makeLead({
        totalAmount: { toString: () => '500.50' } as unknown as number,
        payments:    [{ amount: 200.25 }, { amount: { toString: () => '100.10' } as unknown as number }],
      }),
    ];
    const kpi = calculateKPI(leads, []);
    expect(kpi.totalAmount).toBeCloseTo(500.50, 2);
    expect(kpi.totalPaid).toBeCloseTo(300.35, 2);
    expect(kpi.totalDebt).toBeCloseTo(200.15, 2);
  });

  it('конверсия округляется правильно (1/3 = 33%, не 33.33%)', () => {
    const leads = [
      makeLead({ stage: { id: 'won' } }),
      makeLead({ stage: { id: 's1' } }),
      makeLead({ stage: { id: 's1' } }),
    ];
    expect(calculateKPI(leads, ['won']).conversion).toBe(33);
  });

  it('конверсия 2/3 = 67%', () => {
    const leads = [
      makeLead({ stage: { id: 'won' } }),
      makeLead({ stage: { id: 'won' } }),
      makeLead({ stage: { id: 's1' } }),
    ];
    expect(calculateKPI(leads, ['won']).conversion).toBe(67);
  });
});

// ====================== INTEGRATION — ПОЛНАЯ ЦЕПОЧКА ======================
// Имитируем точный flow из page.tsx:
//   leads из БД → applySearchFilter → applyDebtFilter → calculateKPI

describe('Полная цепочка фильтров (интеграция)', () => {
  const allLeads: LeadForFilter[] = [
    makeLead({ id: 'l1', totalAmount: 1000, payments: [{ amount: 500 }],   client: { fullName: 'Иванов Иван',  phone: '+48 731 006 935' }, stage: { id: 'work' } }),
    makeLead({ id: 'l2', totalAmount: 2000, payments: [{ amount: 2000 }],  client: { fullName: 'Петров Пётр',  phone: '+48 731 718 830' }, stage: { id: 'won'  } }),
    makeLead({ id: 'l3', totalAmount: 500,  payments: [],                  client: { fullName: 'Sidorov John', phone: '+380 67 123 4567' }, stage: { id: 'work' } }),
    makeLead({ id: 'l4', totalAmount: 800,  payments: [{ amount: 300 }],   client: { fullName: 'Иванова Анна', phone: '+48 600 111 222' }, stage: { id: 'lost' } }),
  ];

  it('сценарий Anna: «Только должники» по имени Иванов', () => {
    let leads = allLeads;
    leads = applySearchFilter(leads, 'Иванов');
    leads = applyDebtFilter(leads, true);
    expect(leads.map((l) => l.id)).toEqual(['l1', 'l4']);
  });

  it('сценарий Anna: поиск по тел 731 → только польские номера', () => {
    const leads = applySearchFilter(allLeads, '731');
    expect(leads.map((l) => l.id)).toEqual(['l1', 'l2']);
  });

  it('сценарий Anna: KPI после фильтра «только долги»', () => {
    const leads = applyDebtFilter(allLeads, true);
    const kpi = calculateKPI(leads, ['won']);
    expect(kpi.leadsCount).toBe(3);   // l1, l3, l4
    expect(kpi.totalDebt).toBe(1500); // 500 + 500 + 500
    expect(kpi.debtorsCount).toBe(3);
    expect(kpi.decisionCount).toBe(0); // победителей среди должников нет
    expect(kpi.conversion).toBe(0);
  });

  it('сценарий Anna: общая конверсия (без фильтров)', () => {
    const kpi = calculateKPI(allLeads, ['won']);
    expect(kpi.leadsCount).toBe(4);
    expect(kpi.decisionCount).toBe(1); // только Петров (won)
    expect(kpi.conversion).toBe(25);   // 1/4 = 25%
    expect(kpi.totalAmount).toBe(4300);
    expect(kpi.totalPaid).toBe(2800);
    expect(kpi.totalDebt).toBe(1500);
  });

  it('пустой поиск + debtOnly + KPI всё работает на прогоне', () => {
    let leads: LeadForFilter[] = allLeads;
    leads = applySearchFilter(leads, '');
    leads = applyDebtFilter(leads, false);
    expect(leads.length).toBe(4);
    const kpi = calculateKPI(leads, ['won']);
    expect(kpi.leadsCount).toBe(4);
  });
});
