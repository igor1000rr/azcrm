// Главная страница — Воронки
// SSR: получаем данные с учётом прав, передаём в клиентский Kanban

import { Topbar } from '@/components/topbar';
import { FunnelView } from './funnel-view';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import {
  buildPrismaLeadFilter,
  applySearchFilter,
  applyDebtFilter,
  calculateKPI,
} from '@/lib/funnel-filter';

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

  // 3. Лиды текущей воронки. Фильтр через pure-функцию (city,mgr,visibility).
  // Поиск и debt применяются JS-фильтром после загрузки — для нормализации
  // телефонов (см. tests/unit/funnel-filter.test.ts).
  const leadFilter = buildPrismaLeadFilter({
    funnelId: currentFunnel.id,
    cityId:   params.city || undefined,
    mgrId:    params.mgr  || undefined,
    user,
  });

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

  // 4. JS-фильтры (поиск + долги) и расчёт долга/оплат на каждом лиде
  const withSearch = applySearchFilter(leads, params.q);
  const filtered = applyDebtFilter(withSearch, params.debt === '1');

  // Расчёт _paid и _debt для UI (отдельно, чтобы передать в FunnelView)
  const enriched = filtered.map((l) => {
    const paid = l.payments.reduce((s, p) => s + Number(p.amount), 0);
    const total = Number(l.totalAmount);
    return { ...l, _paid: paid, _debt: Math.max(0, total - paid) };
  });

  // 5. Города (для фильтра)
  const cities = await db.city.findMany({
    where:   { isActive: true },
    orderBy: { position: 'asc' },
  });

  // 6. Менеджеры (для фильтра, только админ видит селект)
  const managers = user.role === 'ADMIN'
    ? await db.user.findMany({
        where: { isActive: true, role: { in: ['SALES', 'LEGAL'] } },
        select: { id: true, name: true, role: true },
        orderBy: { name: 'asc' },
      })
    : [];

  // 7. KPI — через pure-функцию calculateKPI
  const decisionStageIds = stages.filter((s) => s.isFinal && !s.isLost).map((s) => s.id);
  const kpi = calculateKPI(enriched, decisionStageIds);

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
        leads={enriched.map((l) => ({
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
        kpi={kpi}
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
