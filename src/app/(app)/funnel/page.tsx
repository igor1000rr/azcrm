// Главная страница — Воронки
// SSR: получаем данные с учётом прав, передаём в клиентский Kanban

import { Topbar } from '@/components/topbar';
import { FunnelView } from './funnel-view';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { leadVisibilityFilter } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    funnel?: string;
    city?:   string;
    mgr?:    string;
    debt?:   string;
    q?:      string;
  }>;
}

export default async function FunnelPage({ searchParams }: PageProps) {
  const user = await requireUser();
  const params = await searchParams;

  // 1. Все воронки + текущая
  const funnels = await db.funnel.findMany({
    where:   { isActive: true },
    orderBy: { position: 'asc' },
    include: {
      _count: { select: { leads: { where: { isArchived: false } } } },
    },
  });

  if (funnels.length === 0) {
    return (
      <>
        <Topbar breadcrumbs={[{ label: 'CRM' }, { label: 'Воронки' }]} />
        <div className="p-10 text-center">
          <h2 className="text-lg font-semibold mb-2">Нет воронок</h2>
          <p className="text-ink-3">
            Воронки ещё не созданы. Запустите сид: <code>npm run db:seed</code>
          </p>
        </div>
      </>
    );
  }

  const currentFunnelId = params.funnel ?? funnels[0].id;
  const currentFunnel   = funnels.find((f) => f.id === currentFunnelId) ?? funnels[0];

  // 2. Этапы текущей воронки
  const stages = await db.stage.findMany({
    where:   { funnelId: currentFunnel.id },
    orderBy: { position: 'asc' },
  });

  // 3. Лиды текущей воронки с учётом прав и фильтров
  const leadFilter = {
    funnelId:   currentFunnel.id,
    isArchived: false,
    ...(params.city ? { cityId: params.city } : {}),
    ...(params.mgr  ? {
      OR: [
        { salesManagerId: params.mgr },
        { legalManagerId: params.mgr },
      ],
    } : {}),
    ...(params.q ? {
      OR: [
        { client: { fullName: { contains: params.q, mode: 'insensitive' as const } } },
        { client: { phone:    { contains: params.q } } },
      ],
    } : {}),
    ...leadVisibilityFilter(user),
  };

  const leads = await db.lead.findMany({
    where:   leadFilter,
    orderBy: { updatedAt: 'desc' },
    include: {
      client: {
        select: { id: true, fullName: true, phone: true, nationality: true },
      },
      stage: { select: { id: true, name: true, color: true } },
      city:  { select: { id: true, name: true } },
      salesManager: { select: { id: true, name: true } },
      legalManager: { select: { id: true, name: true } },
      whatsappAccount: { select: { id: true, label: true } },
      _count: { select: { documents: true, payments: true } },
      documents: { select: { isPresent: true } },
      payments:  { select: { amount: true } },
    },
  });

  // Фильтр "Только долги" — на стороне сервера после подсчёта
  const leadsWithDebt = leads.map((l) => {
    const paid = l.payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const total = Number(l.totalAmount);
    return { ...l, _paid: paid, _debt: Math.max(0, total - paid) };
  });

  const filtered = params.debt === '1'
    ? leadsWithDebt.filter((l) => l._debt > 0)
    : leadsWithDebt;

  // 4. Города (для фильтра)
  const cities = await db.city.findMany({
    where:   { isActive: true },
    orderBy: { position: 'asc' },
  });

  // 5. Менеджеры (для фильтра)
  const managers = user.role === 'ADMIN'
    ? await db.user.findMany({
        where: { isActive: true, role: { in: ['SALES', 'LEGAL'] } },
        select: { id: true, name: true, role: true },
        orderBy: { name: 'asc' },
      })
    : [];

  // 6. KPI — суммы по текущей воронке
  const totalAmount = filtered.reduce((s, l) => s + Number(l.totalAmount), 0);
  const totalPaid   = filtered.reduce((s, l) => s + l._paid, 0);
  const totalDebt   = filtered.reduce((s, l) => s + l._debt, 0);
  const decisionStageIds = stages.filter((s) => s.isFinal && !s.isLost).map((s) => s.id);
  const decisionCount = filtered.filter((l) => decisionStageIds.includes(l.stage.id)).length;
  const conversion = filtered.length > 0
    ? Math.round((decisionCount / filtered.length) * 100)
    : 0;

  return (
    <>
      <Topbar breadcrumbs={[{ label: 'CRM' }, { label: 'Воронки' }]} />

      <FunnelView
        funnels={funnels.map((f) => ({
          id: f.id, name: f.name, color: f.color, count: f._count.leads,
        }))}
        currentFunnelId={currentFunnel.id}
        currentFunnelName={currentFunnel.name}
        stages={stages.map((s) => ({
          id: s.id, name: s.name, color: s.color, position: s.position,
          isFinal: s.isFinal, isLost: s.isLost,
        }))}
        leads={filtered.map((l) => ({
          id:        l.id,
          stageId:   l.stage.id,
          clientName: l.client.fullName,
          phone:     l.client.phone,
          city:      l.city?.name ?? null,
          source:    l.source ?? l.whatsappAccount?.label ?? null,
          sales:     l.salesManager,
          legal:     l.legalManager,
          totalAmount: Number(l.totalAmount),
          paid:      l._paid,
          debt:      l._debt,
          docsCount: l._count.documents,
          docsHave:  l.documents.filter((d) => d.isPresent).length,
          fingerprintDate: l.fingerprintDate?.toISOString() ?? null,
          updatedAt: l.updatedAt.toISOString(),
        }))}
        cities={cities.map((c) => ({ id: c.id, name: c.name }))}
        managers={managers}
        kpi={{
          leadsCount: filtered.length,
          totalAmount,
          totalPaid,
          totalDebt,
          conversion,
          decisionCount,
          debtorsCount: filtered.filter((l) => l._debt > 0).length,
        }}
        currentFilters={{
          city: params.city ?? '',
          mgr:  params.mgr ?? '',
          debt: params.debt === '1',
          q:    params.q ?? '',
        }}
        currentUserRole={user.role}
      />
    </>
  );
}
