// Юнит-тесты pure-функций фильтров и KPI воронки.
// Anna заметила что фильтры работают странно — покрываем тестами.

import { describe, it, expect } from 'vitest';
import {
  buildPrismaLeadFilter,
  normalizePhone,
  looksLikePhone,
  applySearchFilter,
  applyDebtFilter,
  calcLeadDebt,
  calculateKPI,
  type LeadForFilter,
} from '@/lib/funnel-filter';
import type { SessionUser } from '@/lib/permissions';

// ====================== HELPERS ======================

const ADMIN: SessionUser = { id: 'admin-1', email: 'a@x', name: 'A', role: 'ADMIN' };
const SALES: SessionUser = { id: 'sales-1', email: 's@x', name: 'S', role: 'SALES' };

function makeLead(over: Partial<LeadForFilter> = {}): LeadForFilter {
  return {
    id:          'lead-' + Math.random().toString(36).slice(2, 8),
    totalAmount: 1000,
    client:      { fullName: 'Иванов Иван', phone: '+48 731 006 935' },
    payments:    [{ amount: 500 }],
    stage:       { id: 'stage-1' },
    ...over,
  };
}

// ====================== buildPrismaLeadFilter ======================

describe('buildPrismaLeadFilter', () => {
  it('минимальный фильтр — только воронка + не архив', () => {
    const w = buildPrismaLeadFilter({ funnelId: 'f1', user: ADMIN });
    expect(w).toEqual({
      AND: [
        { funnelId: 'f1' },
        { isArchived: false },
      ],
    });
  });

  it('city фильтр — учитывает cityId ИЛИ workCityId (фикс бага)', () => {
    const w = buildPrismaLeadFilter({ funnelId: 'f1', cityId: 'lodz', user: ADMIN });
    const conditions = (w as { AND: Record<string, unknown>[] }).AND;
    const cityCondition = conditions.find((c) => 'OR' in c);
    expect(cityCondition).toEqual({
      OR: [
        { cityId:     'lodz' },
        { workCityId: 'lodz' },
      ],
    });
  });

  it('mgr фильтр — sales ИЛИ legal с этим id', () => {
    const w = buildPrismaLeadFilter({ funnelId: 'f1', mgrId: 'mgr-2', user: ADMIN });
    const conditions = (w as { AND: Record<string, unknown>[] }).AND;
    const mgrCondition = conditions.find((c) => 'OR' in c);
    expect(mgrCondition).toEqual({
      OR: [
        { salesManagerId: 'mgr-2' },
        { legalManagerId: 'mgr-2' },
      ],
    });
  });

  it('ADMIN — без фильтра видимости', () => {
    const w = buildPrismaLeadFilter({ funnelId: 'f1', user: ADMIN });
    const conditions = (w as { AND: Record<string, unknown>[] }).AND;
    // Нет фильтра видимости → должно быть только 2 условия
    expect(conditions).toHaveLength(2);
  });

  it('SALES — добавляется фильтр видимости (свои лиды)', () => {
    const w = buildPrismaLeadFilter({ funnelId: 'f1', user: SALES });
    const conditions = (w as { AND: Record<string, unknown>[] }).AND;
    // Должен появиться третий конд — visibilityFilter
    expect(conditions.length).toBeGreaterThan(2);
    const visCondition = conditions.find(
      (c) => 'OR' in c && JSON.stringify(c).includes('salesManagerId'),
    );
    expect(visCondition).toBeDefined();
  });

  it('всё вместе: city + mgr + visibility', () => {
    const w = buildPrismaLeadFilter({
      funnelId: 'f1', cityId: 'lodz', mgrId: 'mgr-2', user: SALES,
    });
    const conditions = (w as { AND: Record<string, unknown>[] }).AND;
    // funnelId + isArchived + city OR + mgr OR + visibility OR = 5
    expect(conditions).toHaveLength(5);
  });
});

// ====================== normalizePhone ======================

describe('normalizePhone', () => {
  it('убирает + пробелы и дефисы', () => {
    expect(normalizePhone('+48 731 006 935')).toBe('48731006935');
    expect(normalizePhone('731-006-935')).toBe('731006935');
    expect(normalizePhone('(731) 006-935')).toBe('731006935');
  });

  it('пустые/null/undefined возвращают пустую строку', () => {
    expect(normalizePhone(null)).toBe('');
    expect(normalizePhone(undefined)).toBe('');
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone('   ')).toBe('');
  });

  it('строка из букв возвращает пустую строку', () => {
    expect(normalizePhone('abc')).toBe('');
    expect(normalizePhone('Иванов')).toBe('');
  });
});

// ====================== looksLikePhone ======================

describe('looksLikePhone', () => {
  it('распознаёт номер телефона разных форматов', () => {
    expect(looksLikePhone('731006935')).toBe(true);
    expect(looksLikePhone('+48 731 006 935')).toBe(true);
    expect(looksLikePhone('(731) 006-935')).toBe(true);
    expect(looksLikePhone('+48-731')).toBe(true);
  });

  it('строки с буквами — не телефон', () => {
    expect(looksLikePhone('Иванов')).toBe(false);
    expect(looksLikePhone('john')).toBe(false);
    expect(looksLikePhone('731-abc')).toBe(false);
  });

  it('пустая строка — не телефон', () => {
    expect(looksLikePhone('')).toBe(false);
    expect(looksLikePhone('   ')).toBe(false);
  });
});

// ====================== applySearchFilter ======================

describe('applySearchFilter', () => {
  const leads = [
    makeLead({ id: 'l1', client: { fullName: 'Иванов Иван', phone: '+48 731 006 935' } }),
    makeLead({ id: 'l2', client: { fullName: 'Петров Пётр', phone: '+48 731 718 830' } }),
    makeLead({ id: 'l3', client: { fullName: 'Sidorov John', phone: '+380 67 123 4567' } }),
  ];

  it('пустой запрос возвращает всех', () => {
    expect(applySearchFilter(leads, '').map((l) => l.id)).toEqual(['l1', 'l2', 'l3']);
    expect(applySearchFilter(leads, undefined).map((l) => l.id)).toEqual(['l1', 'l2', 'l3']);
    expect(applySearchFilter(leads, '   ').map((l) => l.id)).toEqual(['l1', 'l2', 'l3']);
  });

  it('поиск по имени — case-insensitive', () => {
    expect(applySearchFilter(leads, 'Иван').map((l) => l.id)).toEqual(['l1']);
    expect(applySearchFilter(leads, 'иван').map((l) => l.id)).toEqual(['l1']);
    expect(applySearchFilter(leads, 'john').map((l) => l.id)).toEqual(['l3']);
    expect(applySearchFilter(leads, 'JOHN').map((l) => l.id)).toEqual(['l3']);
  });

  it('поиск по части имени', () => {
    expect(applySearchFilter(leads, 'Пет').map((l) => l.id)).toEqual(['l2']);
    expect(applySearchFilter(leads, 'ров').map((l) => l.id)).toEqual(['l1', 'l2', 'l3']);
  });

  it('ФИКС: поиск по телефону игнорирует пробелы и +/дефисы (БАГ Anna)', () => {
    // В БД лежит '+48 731 006 935', Anna ищет '731006935' — должно найти
    expect(applySearchFilter(leads, '731006935').map((l) => l.id)).toEqual(['l1']);
    // С пробелами как ввела бы Anna
    expect(applySearchFilter(leads, '731 006').map((l) => l.id)).toEqual(['l1']);
    // С +
    expect(applySearchFilter(leads, '+48 731').map((l) => l.id)).toEqual(['l1', 'l2']);
    // По части номера
    expect(applySearchFilter(leads, '718').map((l) => l.id)).toEqual(['l2']);
  });

  it('украинский номер тоже находится по последним цифрам', () => {
    expect(applySearchFilter(leads, '4567').map((l) => l.id)).toEqual(['l3']);
    expect(applySearchFilter(leads, '380').map((l) => l.id)).toEqual(['l3']);
  });

  it('ничего не найдено — пустой массив', () => {
    expect(applySearchFilter(leads, 'НЕСУЩЕСТВУЕТ').map((l) => l.id)).toEqual([]);
    expect(applySearchFilter(leads, '999999').map((l) => l.id)).toEqual([]);
  });
});

// ====================== applyDebtFilter ======================

describe('applyDebtFilter', () => {
  const leads = [
    makeLead({ id: 'paid', totalAmount: 1000, payments: [{ amount: 1000 }] }),  // 0 долг
    makeLead({ id: 'half', totalAmount: 1000, payments: [{ amount: 500 }] }),   // 500 долг
    makeLead({ id: 'none', totalAmount: 500, payments: [] }),                    // 500 долг
    makeLead({ id: 'over', totalAmount: 100, payments: [{ amount: 200 }] }),    // переплата → 0
  ];

  it('debtOnly=false возвращает всех', () => {
    expect(applyDebtFilter(leads, false).map((l) => l.id)).toEqual(['paid', 'half', 'none', 'over']);
  });

  it('debtOnly=true возвращает только должников', () => {
    expect(applyDebtFilter(leads, true).map((l) => l.id)).toEqual(['half', 'none']);
  });

  it('защита от плавающей запятой — мелкий долг 0.005 не считается', () => {
    const withTinyDebt = makeLead({ id: 'tiny', totalAmount: 1000, payments: [{ amount: 999.995 }] });
    expect(applyDebtFilter([withTinyDebt], true).map((l) => l.id)).toEqual([]);
  });
});

// ====================== calcLeadDebt ======================

describe('calcLeadDebt', () => {
  it('обычный случай', () => {
    expect(calcLeadDebt(makeLead({ totalAmount: 1000, payments: [{ amount: 300 }] }))).toBe(700);
  });

  it('переплата → 0', () => {
    expect(calcLeadDebt(makeLead({ totalAmount: 100, payments: [{ amount: 200 }] }))).toBe(0);
  });

  it('сумма платежей — корректно складывается', () => {
    expect(calcLeadDebt(makeLead({
      totalAmount: 1000,
      payments: [{ amount: 100 }, { amount: 200 }, { amount: 300 }],
    }))).toBe(400);
  });

  it('Decimal от Prisma (через toString)', () => {
    expect(calcLeadDebt(makeLead({
      totalAmount: { toString: () => '1000' } as unknown as number,
      payments:    [{ amount: { toString: () => '350' } as unknown as number }],
    }))).toBe(650);
  });
});

// ====================== calculateKPI ======================

describe('calculateKPI', () => {
  const decisionIds = ['stage-decision'];

  it('пустой список — все нули', () => {
    expect(calculateKPI([], decisionIds)).toEqual({
      leadsCount: 0,
      totalAmount: 0,
      totalPaid:   0,
      totalDebt:   0,
      conversion:  0,
      decisionCount: 0,
      debtorsCount:  0,
    });
  });

  it('базовый сценарий — корректная агрегация', () => {
    const leads = [
      makeLead({ totalAmount: 1000, payments: [{ amount: 1000 }], stage: { id: 'stage-decision' } }),
      makeLead({ totalAmount: 500,  payments: [{ amount: 200 }],  stage: { id: 'stage-1' } }),
      makeLead({ totalAmount: 300,  payments: [],                  stage: { id: 'stage-1' } }),
    ];
    const kpi = calculateKPI(leads, decisionIds);
    expect(kpi.leadsCount).toBe(3);
    expect(kpi.totalAmount).toBe(1800);
    expect(kpi.totalPaid).toBe(1200);
    expect(kpi.totalDebt).toBe(600); // 0 + 300 + 300
    expect(kpi.debtorsCount).toBe(2);
    expect(kpi.decisionCount).toBe(1);
    expect(kpi.conversion).toBe(33); // 1/3 = 33%
  });

  it('100% конверсия', () => {
    const leads = [
      makeLead({ totalAmount: 1000, stage: { id: 'stage-decision' } }),
      makeLead({ totalAmount: 500,  stage: { id: 'stage-decision' } }),
    ];
    expect(calculateKPI(leads, decisionIds).conversion).toBe(100);
  });

  it('переплата не уходит в минус по долгу', () => {
    const leads = [
      makeLead({ totalAmount: 100, payments: [{ amount: 500 }], stage: { id: 's1' } }),
    ];
    expect(calculateKPI(leads, decisionIds).totalDebt).toBe(0);
  });

  it('полная оплата не считается должником', () => {
    const leads = [
      makeLead({ totalAmount: 1000, payments: [{ amount: 1000 }], stage: { id: 's1' } }),
    ];
    expect(calculateKPI(leads, decisionIds).debtorsCount).toBe(0);
  });
});
