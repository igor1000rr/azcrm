// Pure-логика фильтрации и подсчёта KPI для страницы воронки.
// Зачем вынесено в lib: inline-логика в page.tsx не поддавалась тестированию.

import type { UserRole } from '@prisma/client';
import { leadVisibilityFilter, type SessionUser } from '@/lib/permissions';

// ====================== ТИПЫ ======================

export interface LeadForFilter {
  id:             string;
  totalAmount:    number | { toString(): string };
  client:         { fullName: string; phone: string };
  payments:       Array<{ amount: number | { toString(): string } }>;
  stage:          { id: string };
}

export interface FilterParams {
  funnelId:  string;
  cityId?:   string;
  mgrId?:    string;
  user:      SessionUser;
}

export interface KPI {
  leadsCount:    number;
  totalAmount:   number;
  totalPaid:     number;
  totalDebt:     number;
  conversion:    number;
  decisionCount: number;
  debtorsCount:  number;
}

// ====================== ПОСТРОЕНИЕ PRISMA WHERE ======================

/**
 * Строит where-условие для Prisma запроса лидов воронки.
 *
 * ФИКС бага: фильтр по городу теперь учитывает cityId ИЛИ workCityId
 * (раньше только cityId — Anna не видела лидов работающих в выбранном
 * городе но обратившихся из другого).
 */
export function buildPrismaLeadFilter(params: FilterParams): Record<string, unknown> {
  const conditions: Record<string, unknown>[] = [];

  conditions.push({ funnelId: params.funnelId });
  conditions.push({ isArchived: false });

  if (params.cityId) {
    conditions.push({
      OR: [
        { cityId:     params.cityId },
        { workCityId: params.cityId },
      ],
    });
  }

  if (params.mgrId) {
    conditions.push({
      OR: [
        { salesManagerId: params.mgrId },
        { legalManagerId: params.mgrId },
      ],
    });
  }

  const visibilityFilter = leadVisibilityFilter(params.user);
  if (Object.keys(visibilityFilter).length > 0) {
    conditions.push(visibilityFilter as Record<string, unknown>);
  }

  return { AND: conditions };
}

// ====================== НОРМАЛИЗАЦИЯ ТЕЛЕФОНА ======================

/**
 * Убирает из строки всё кроме цифр.
 * '+48 731 006 935' → '48731006935', '731-006-935' → '731006935'.
 *
 * Решает проблему когда Anna ищет '731006935' а в БД лежит
 * '+48 731 006 935' с пробелами — обычный contains не находит.
 */
export function normalizePhone(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/\D/g, '');
}

/** Эвристика: строка похожа на телефонный поиск (только цифры/+/-/()). */
export function looksLikePhone(q: string): boolean {
  if (!q) return false;
  return /^[\d\s+\-()]+$/.test(q.trim());
}

// ====================== JS-ФИЛЬТРЫ ======================

/**
 * Фильтр по тексту запроса q.
 *   - q пустой         → возвращает входной список без изменений
 *   - q похож на тел   → нормализует обе стороны и ищет substring
 *   - q содержит буквы → ищет в имени клиента case-insensitive
 */
export function applySearchFilter<T extends LeadForFilter>(
  leads: T[],
  q: string | undefined,
): T[] {
  if (!q || !q.trim()) return leads;
  const trimmed = q.trim();

  if (looksLikePhone(trimmed)) {
    const needle = normalizePhone(trimmed);
    if (!needle) return leads;
    return leads.filter((l) => normalizePhone(l.client.phone).includes(needle));
  }

  const needle = trimmed.toLowerCase();
  return leads.filter((l) => l.client.fullName.toLowerCase().includes(needle));
}

/** Фильтр «только долги» (debt > 0 с защитой от плавающей запятой). */
export function applyDebtFilter<T extends LeadForFilter>(
  leads: T[],
  debtOnly: boolean | undefined,
): T[] {
  if (!debtOnly) return leads;
  return leads.filter((l) => calcLeadDebt(l) > 0.01);
}

// ====================== ПОДСЧЁТ KPI ======================

function calcLeadPaid(lead: LeadForFilter): number {
  return lead.payments.reduce((sum, p) => sum + Number(p.amount), 0);
}

export function calcLeadDebt(lead: LeadForFilter): number {
  const total = Number(lead.totalAmount);
  const paid  = calcLeadPaid(lead);
  return Math.max(0, total - paid);
}

/**
 * Подсчёт KPI по списку лидов.
 * decisionStageIds — id этапов которые считаются «успешным закрытием»
 * (isFinal && !isLost — то есть деци́зия).
 */
export function calculateKPI(
  leads:            LeadForFilter[],
  decisionStageIds: string[],
): KPI {
  let totalAmount = 0;
  let totalPaid   = 0;
  let totalDebt   = 0;
  let debtorsCount = 0;

  for (const l of leads) {
    const total = Number(l.totalAmount);
    const paid  = calcLeadPaid(l);
    const debt  = Math.max(0, total - paid);

    totalAmount += total;
    totalPaid   += paid;
    totalDebt   += debt;
    if (debt > 0.01) debtorsCount++;
  }

  const decisionSet = new Set(decisionStageIds);
  const decisionCount = leads.filter((l) => decisionSet.has(l.stage.id)).length;
  const conversion = leads.length > 0
    ? Math.round((decisionCount / leads.length) * 100)
    : 0;

  return {
    leadsCount: leads.length,
    totalAmount,
    totalPaid,
    totalDebt,
    conversion,
    decisionCount,
    debtorsCount,
  };
}

export type { UserRole };
