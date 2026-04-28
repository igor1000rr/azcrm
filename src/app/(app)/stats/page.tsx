// Аналитика — графики и сводки за период
import { Topbar } from '@/components/topbar';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { StatsView } from './stats-view';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    period?: '7d' | '30d' | '90d' | '365d';
    city?:   string;
  }>;
}

export default async function StatsPage({ searchParams }: PageProps) {
  await requireAdmin();
  const { period = '30d', city: cityFilter } = await searchParams;

  const days = ({ '7d': 7, '30d': 30, '90d': 90, '365d': 365 } as const)[period];
  const since = new Date(Date.now() - days * 86400_000);

  // Список городов (для селекта фильтра)
  const cities = await db.city.findMany({
    where: { isActive: true },
    orderBy: { position: 'asc' },
    select: { id: true, name: true },
  });
  const cityName = cityFilter ? cities.find((c) => c.id === cityFilter)?.name ?? null : null;

  // Все запросы, что зависят от лидов, фильтруем по городу обращения
  const cityClause = cityFilter ? { cityId: cityFilter } : {};
  const paymentLeadCityClause = cityFilter ? { lead: { cityId: cityFilter } } : {};

  // 1. Сводка по воронкам (с учётом city-фильтра)
  const funnels = await db.funnel.findMany({
    where: { isActive: true },
    include: {
      leads: {
        where: { isArchived: false, ...cityClause },
        select: {
          totalAmount: true, createdAt: true,
          stage: { select: { isFinal: true, isLost: true } },
          payments: { select: { amount: true, paidAt: true } },
        },
      },
    },
  });

  const funnelStats = funnels.map((f) => {
    const leads = f.leads.length;
    const total = f.leads.reduce((s, l) => s + Number(l.totalAmount), 0);
    const paid  = f.leads.reduce((s, l) =>
      s + l.payments.reduce((ps, p) => ps + Number(p.amount), 0), 0);
    const closed = f.leads.filter((l) => l.stage.isFinal && !l.stage.isLost).length;
    const lost   = f.leads.filter((l) => l.stage.isLost).length;
    const conv = leads > 0 ? Math.round((closed / leads) * 100) : 0;
    return { id: f.id, name: f.name, leads, total, paid, closed, lost, conv };
  });

  // 2. Платежи по дням
  const payments = await db.payment.findMany({
    where: { paidAt: { gte: since }, ...paymentLeadCityClause },
    select: { amount: true, paidAt: true, method: true },
    orderBy: { paidAt: 'asc' },
  });

  const paymentsByDay: Record<string, number> = {};
  for (let i = 0; i < days; i++) {
    const day = new Date(Date.now() - (days - 1 - i) * 86400_000);
    const key = day.toISOString().slice(0, 10);
    paymentsByDay[key] = 0;
  }
  for (const p of payments) {
    const key = p.paidAt.toISOString().slice(0, 10);
    if (paymentsByDay[key] !== undefined) paymentsByDay[key] += Number(p.amount);
  }
  const paymentsChart = Object.entries(paymentsByDay).map(([date, amount]) => ({ date, amount }));

  // 3. Распределение по способам оплаты (pie)
  const methodTotals: Record<string, number> = { CARD: 0, CASH: 0, TRANSFER: 0, OTHER: 0 };
  for (const p of payments) methodTotals[p.method] += Number(p.amount);
  const paymentMethodsChart = Object.entries(methodTotals)
    .filter(([, v]) => v > 0)
    .map(([method, value]) => ({ method, value }));

  // 4. Новые лиды по дням
  const newLeads = await db.lead.findMany({
    where: { createdAt: { gte: since }, ...cityClause },
    select: { createdAt: true, funnelId: true },
  });
  const leadsByDay: Record<string, number> = {};
  for (let i = 0; i < days; i++) {
    const day = new Date(Date.now() - (days - 1 - i) * 86400_000);
    const key = day.toISOString().slice(0, 10);
    leadsByDay[key] = 0;
  }
  for (const l of newLeads) {
    const key = l.createdAt.toISOString().slice(0, 10);
    if (leadsByDay[key] !== undefined) leadsByDay[key]++;
  }
  const leadsChart = Object.entries(leadsByDay).map(([date, count]) => ({ date, count }));

  // 5. Производительность менеджеров
  const managers = await db.user.findMany({
    where: { isActive: true, role: { in: ['SALES', 'LEGAL'] } },
    select: {
      id: true, name: true, role: true,
      salesLeads: {
        where: { createdAt: { gte: since }, ...cityClause },
        select: { totalAmount: true, payments: { select: { amount: true } } },
      },
      legalLeads: {
        where: { createdAt: { gte: since }, ...cityClause, stage: { isFinal: true, isLost: false } },
        select: { id: true },
      },
    },
  });
  const managersChart = managers.map((m) => {
    const leads = m.salesLeads.length;
    const total = m.salesLeads.reduce((s, l) => s + Number(l.totalAmount), 0);
    const paid  = m.salesLeads.reduce((s, l) => s + l.payments.reduce((ps, p) => ps + Number(p.amount), 0), 0);
    const closed = m.legalLeads.length;
    return { id: m.id, name: m.name, role: m.role, leads, total, paid, closed };
  });

  // 6. Топ KPI за период
  const allLeads  = await db.lead.count({ where: { createdAt: { gte: since }, ...cityClause } });
  const allClosed = await db.lead.count({
    where: { createdAt: { gte: since }, ...cityClause, stage: { isFinal: true, isLost: false } },
  });
  const allLost = await db.lead.count({
    where: { createdAt: { gte: since }, ...cityClause, stage: { isLost: true } },
  });
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);
  const avgPayment = payments.length > 0 ? totalPaid / payments.length : 0;

  // 7. Источники заявок (по sourceKind)
  const leadsBySource = await db.lead.groupBy({
    by: ['sourceKind'],
    where: { createdAt: { gte: since }, ...cityClause },
    _count: { _all: true },
  });
  const SOURCE_LABEL: Record<string, string> = {
    WHATSAPP: 'WhatsApp', PHONE: 'Телефон', TELEGRAM: 'Telegram', EMAIL: 'Email',
    WEBSITE: 'Сайт', REFERRAL: 'Рекомендация', WALK_IN: 'Самообращение',
    MANUAL: 'Вручную', IMPORT: 'Импорт', OTHER: 'Другое',
  };
  const sourcesChart = leadsBySource
    .filter((b) => b._count._all > 0)
    .map((b) => ({
      kind: b.sourceKind ?? 'UNKNOWN',
      label: b.sourceKind ? (SOURCE_LABEL[b.sourceKind] ?? b.sourceKind) : 'Не указан',
      count: b._count._all,
    }))
    .sort((a, b) => b.count - a.count);

  // 8. Отпечатки за период — сводка по локациям + по дням + по городам
  const fingerprints = await db.calendarEvent.findMany({
    where: {
      kind: 'FINGERPRINT',
      startsAt: { gte: since },
      lead: cityFilter ? { cityId: cityFilter } : { isNot: null },
    },
    select: {
      id: true, startsAt: true, location: true,
      lead: { select: { id: true, city: { select: { id: true, name: true } } } },
    },
    orderBy: { startsAt: 'asc' },
  });
  const fpTotal = fingerprints.length;

  const fpByDay: Record<string, number> = {};
  for (let i = 0; i < days; i++) {
    const day = new Date(Date.now() - (days - 1 - i) * 86400_000);
    const key = day.toISOString().slice(0, 10);
    fpByDay[key] = 0;
  }
  for (const f of fingerprints) {
    const key = f.startsAt.toISOString().slice(0, 10);
    if (fpByDay[key] !== undefined) fpByDay[key]++;
  }
  const fpByDayChart = Object.entries(fpByDay).map(([date, count]) => ({ date, count }));

  const fpByLocationMap = new Map<string, number>();
  for (const f of fingerprints) {
    const key = (f.location?.trim() || 'Место не указано');
    fpByLocationMap.set(key, (fpByLocationMap.get(key) ?? 0) + 1);
  }
  const fpByLocation = [...fpByLocationMap.entries()]
    .map(([location, count]) => ({ location, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const fpByCityMap = new Map<string, number>();
  for (const f of fingerprints) {
    const key = f.lead?.city?.name ?? 'Город не указан';
    fpByCityMap.set(key, (fpByCityMap.get(key) ?? 0) + 1);
  }
  const fpByCity = [...fpByCityMap.entries()]
    .map(([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count);

  return (
    <>
      <Topbar breadcrumbs={[{ label: 'CRM' }, { label: 'Аналитика' }]} />
      <StatsView
        period={period}
        cityFilter={cityFilter ?? ''}
        cityFilterName={cityName}
        cities={cities}
        kpi={{ allLeads, allClosed, allLost, totalPaid, paymentsCount: payments.length, avgPayment }}
        funnelStats={funnelStats}
        paymentsChart={paymentsChart}
        paymentMethodsChart={paymentMethodsChart}
        leadsChart={leadsChart}
        managersChart={managersChart}
        sourcesChart={sourcesChart}
        fingerprints={{
          total: fpTotal,
          byDay: fpByDayChart,
          byLocation: fpByLocation,
          byCity: fpByCity,
        }}
      />
    </>
  );
}
