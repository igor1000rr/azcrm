// Обзор — для администратора, общая статистика
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
    db.lead.findMany({
      where: { isArchived: false },
      include: { payments: { select: { amount: true } } },
    }).then((leads) =>
      leads.filter((l) => Number(l.totalAmount) > l.payments.reduce((s, p) => s + Number(p.amount), 0))
        .length
    ),
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
