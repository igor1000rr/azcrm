// Аналитика — графики и сводки за период
import { Topbar } from '@/components/topbar';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { StatsView } from './stats-view';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ period?: '7d' | '30d' | '90d' | '365d' }>;
}

export default async function StatsPage({ searchParams }: PageProps) {
  await requireAdmin();
  const { period = '30d' } = await searchParams;

  const days = ({ '7d': 7, '30d': 30, '90d': 90, '365d': 365 } as const)[period];
  const since = new Date(Date.now() - days * 86400_000);

  // 1. Сводка по воронкам
  const funnels = await db.funnel.findMany({
    where: { isActive: true },
    include: {
      leads: {
        where: { isArchived: false },
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

  // 2. Платежи по дням (для линейного графика)
  const payments = await db.payment.findMany({
    where: { paidAt: { gte: since } },
    select: { amount: true, paidAt: true, method: true },
    orderBy: { paidAt: 'asc' },
  });

  // Группируем по дням
  const paymentsByDay: Record<string, number> = {};
  for (let i = 0; i < days; i++) {
    const day = new Date(Date.now() - (days - 1 - i) * 86400_000);
    const key = day.toISOString().slice(0, 10);
    paymentsByDay[key] = 0;
  }
  for (const p of payments) {
    const key = p.paidAt.toISOString().slice(0, 10);
    if (paymentsByDay[key] !== undefined) {
      paymentsByDay[key] += Number(p.amount);
    }
  }
  const paymentsChart = Object.entries(paymentsByDay).map(([date, amount]) => ({
    date, amount,
  }));

  // 3. Распределение по способам оплаты (pie)
  const methodTotals: Record<string, number> = { CARD: 0, CASH: 0, TRANSFER: 0, OTHER: 0 };
  for (const p of payments) {
    methodTotals[p.method] += Number(p.amount);
  }
  const paymentMethodsChart = Object.entries(methodTotals)
    .filter(([, v]) => v > 0)
    .map(([method, value]) => ({ method, value }));

  // 4. Лиды созданные по дням
  const newLeads = await db.lead.findMany({
    where: { createdAt: { gte: since } },
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
  const leadsChart = Object.entries(leadsByDay).map(([date, count]) => ({
    date, count,
  }));

  // 5. Производительность менеджеров
  const managers = await db.user.findMany({
    where: { isActive: true, role: { in: ['SALES', 'LEGAL'] } },
    select: {
      id: true, name: true, role: true,
      salesLeads: {
        where: { createdAt: { gte: since } },
        select: { totalAmount: true, payments: { select: { amount: true } } },
      },
      legalLeads: {
        where: {
          createdAt: { gte: since },
          stage: { isFinal: true, isLost: false },
        },
        select: { id: true },
      },
    },
  });

  const managersChart = managers.map((m) => {
    const leads = m.salesLeads.length;
    const total = m.salesLeads.reduce((s, l) => s + Number(l.totalAmount), 0);
    const paid  = m.salesLeads.reduce(
      (s, l) => s + l.payments.reduce((ps, p) => ps + Number(p.amount), 0), 0);
    const closed = m.legalLeads.length;
    return {
      id: m.id, name: m.name, role: m.role,
      leads, total, paid, closed,
    };
  });

  // 6. Топ KPI за период
  const allLeads = await db.lead.count({ where: { createdAt: { gte: since } } });
  const allClosed = await db.lead.count({
    where: {
      createdAt: { gte: since },
      stage: { isFinal: true, isLost: false },
    },
  });
  const allLost = await db.lead.count({
    where: {
      createdAt: { gte: since },
      stage: { isLost: true },
    },
  });

  const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);
  const avgPayment = payments.length > 0 ? totalPaid / payments.length : 0;

  return (
    <>
      <Topbar breadcrumbs={[{ label: 'CRM' }, { label: 'Аналитика' }]} />

      <StatsView
        period={period}
        kpi={{
          allLeads, allClosed, allLost,
          totalPaid, paymentsCount: payments.length, avgPayment,
        }}
        funnelStats={funnelStats}
        paymentsChart={paymentsChart}
        paymentMethodsChart={paymentMethodsChart}
        leadsChart={leadsChart}
        managersChart={managersChart}
      />
    </>
  );
}
