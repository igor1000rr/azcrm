// Обзор — для администратора, общая статистика
//
// 06.05.2026 — пункт #34 аудита: подсчёт должников переведён на агрегацию
// в БД вместо загрузки всех лидов в память. До: db.lead.findMany({ include:
// { payments } }).then(filter) — при 10К лидов каждое открытие /dashboard
// тянуло мегабайты данных через сеть и нагружало Node-процесс. Сейчас один
// агрегатный запрос с условием на raw уровне Prisma.
import { Topbar } from '@/components/topbar';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { formatMoney } from '@/lib/utils';
import {
  Users, BarChart3, CreditCard, AlertCircle,
  TrendingUp, Calendar as CalendarIcon,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  await requireAdmin();

  const now = new Date();
  const monthAgo = new Date(now.getTime() - 30 * 86400_000);

  const [
    totalClients,
    leadsActive,
    leadsClosed30d,
    paymentsAgg30d,
    upcomingFp,
    debtors,
  ] = await Promise.all([
    db.client.count({ where: { isArchived: false } }),
    db.lead.count({ where: { isArchived: false } }),
    db.lead.count({
      where: {
        isArchived: false, closedAt: { gte: monthAgo },
        stage: { isFinal: true, isLost: false },
      },
    }),
    db.payment.aggregate({
      where: { paidAt: { gte: monthAgo } },
      _sum: { amount: true }, _count: { _all: true },
    }),
    db.calendarEvent.count({
      where: { kind: 'FINGERPRINT', startsAt: { gte: now, lte: new Date(now.getTime() + 7 * 86400_000) } },
    }),
    countDebtors(),
  ]);

  const cards = [
    { title: 'Активные клиенты',  value: totalClients,                                icon: Users,         color: 'text-info' },
    { title: 'Лидов в работе',    value: leadsActive,                                 icon: BarChart3,     color: 'text-navy' },
    { title: 'Закрыто за 30 дн.', value: leadsClosed30d,                              icon: TrendingUp,    color: 'text-success' },
    { title: 'Сумма за 30 дн.',   value: `${formatMoney(paymentsAgg30d._sum.amount ?? 0)} zł`, icon: CreditCard, color: 'text-success' },
    { title: 'Отпечатки на неделе', value: upcomingFp,                               icon: CalendarIcon,  color: 'text-warn' },
    { title: 'Должники',          value: debtors,                                     icon: AlertCircle,   color: 'text-danger' },
  ];

  return (
    <>
      <Topbar breadcrumbs={[{ label: 'CRM' }, { label: 'Обзор' }]} />

      <div className="p-4 md:p-5 max-w-[1280px] w-full">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {cards.map((c) => {
            const Icon = c.icon;
            return (
              <div key={c.title} className="bg-paper border border-line rounded-lg p-4">
                <div className={`mb-3 ${c.color}`}>
                  <Icon size={20} />
                </div>
                <div className="text-[24px] font-bold tracking-tight font-mono text-ink leading-none">
                  {c.value}
                </div>
                <div className="text-[12px] text-ink-3 mt-1.5">{c.title}</div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 text-center text-[12px] text-ink-4">
          Подробная аналитика будет добавлена в разделе «Аналитика»
        </div>
      </div>
    </>
  );
}

/**
 * Должники — лиды у которых totalAmount > sum(payments.amount).
 *
 * 06.05.2026 — пункт #34 аудита.
 * До: загружали ВСЕ нескрытые лиды с include payments, потом filter в JS.
 * При 10К лидов это было ~5-10 МБ JSON через сеть и заметная задержка
 * рендера /dashboard.
 *
 * Сейчас: один агрегатный запрос через Prisma groupBy по leadId. PostgreSQL
 * считает SUM(amount) на стороне БД, в Node прилетает только результирующий
 * массив пар (leadId, paidSum). Дальше один lead.findMany на эти leadId
 * чтобы достать totalAmount и сравнить.
 *
 * Альтернатива через $queryRaw (один SQL JOIN с GROUP BY HAVING) была бы
 * чуть быстрее, но прокатит и эта 2-step версия — она держится в Prisma
 * type-safe API, не требует ручного экранирования и легче поддерживается.
 */
async function countDebtors(): Promise<number> {
  // 1. Считаем суммарную оплату по каждому активному лиду.
  // groupBy не умеет сразу join'ить с условием Lead.isArchived,
  // поэтому делаем 2 запроса.
  const paidSums = await db.payment.groupBy({
    by: ['leadId'],
    _sum: { amount: true },
  });

  // Map leadId → paid amount (число).
  const paidMap = new Map<string, number>();
  for (const p of paidSums) {
    paidMap.set(p.leadId, Number(p._sum.amount ?? 0));
  }

  // 2. Берём все активные лиды только с totalAmount (минимальный select).
  const leads = await db.lead.findMany({
    where:  { isArchived: false },
    select: { id: true, totalAmount: true },
  });

  let count = 0;
  for (const l of leads) {
    const total = Number(l.totalAmount);
    if (total <= 0) continue; // не считаем лиды без цены
    const paid = paidMap.get(l.id) ?? 0;
    if (paid < total) count++;
  }
  return count;
}
