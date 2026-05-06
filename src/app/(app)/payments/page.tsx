// Страница "Оплаты" — все платежи с фильтрами
import Link from 'next/link';
import { Topbar } from '@/components/topbar';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { leadVisibilityFilter } from '@/lib/permissions';
import { formatDate, formatMoney } from '@/lib/utils';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    period?: '7d' | '30d' | '90d' | 'all';
  }>;
}

export default async function PaymentsPage({ searchParams }: PageProps) {
  const user = await requireUser();
  const { period = '30d' } = await searchParams;

  const since = period === 'all'
    ? null
    : new Date(Date.now() - ({ '7d': 7, '30d': 30, '90d': 90 } as const)[period] * 86400_000);

  // Только платежи по видимым лидам
  const where = {
    lead: leadVisibilityFilter(user),
    ...(since ? { paidAt: { gte: since } } : {}),
  };

  const [payments, agg] = await Promise.all([
    db.payment.findMany({
      where,
      orderBy: { paidAt: 'desc' },
      take: 200,
      include: {
        lead: {
          include: {
            client: { select: { fullName: true } },
            funnel: { select: { name: true } },
          },
        },
        createdBy: { select: { name: true } },
      },
    }),
    db.payment.aggregate({
      where,
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);

  // Экспорт в CSV — только для ADMIN и LEGAL.
  // SALES (менеджер продаж) не должен иметь возможность массово выгружать
  // финансовую информацию.
  const canExport = user.role === 'ADMIN' || user.role === 'LEGAL';

  return (
    <>
      <Topbar breadcrumbs={[{ label: 'CRM' }, { label: 'Оплаты' }]} />

      <div className="p-4 md:p-5 max-w-[1280px] w-full">
        {/* Toolbar */}
        <div className="bg-paper border border-line rounded-lg mb-3 p-3 flex items-center gap-3 flex-wrap">
          <div className="flex border border-line rounded-md p-0.5 bg-paper">
            {(['7d', '30d', '90d', 'all'] as const).map((p) => (
              <Link
                key={p}
                href={`/payments?period=${p}`}
                className={`px-3 py-1 text-[12px] font-medium rounded ${
                  period === p ? 'bg-navy text-white' : 'text-ink-3 hover:text-ink'
                }`}
              >
                {p === '7d' ? '7 дней' : p === '30d' ? '30 дней' : p === '90d' ? '90 дней' : 'всё время'}
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-4 text-[12px] ml-auto">
            <div>
              <span className="text-ink-3">Платежей:</span>{' '}
              <strong className="text-ink">{agg._count._all}</strong>
            </div>
            <div>
              <span className="text-ink-3">Сумма:</span>{' '}
              <strong className="text-success font-mono">{formatMoney(agg._sum.amount ?? 0)} zl</strong>
            </div>
            {canExport && (
              <Link href={`/api/payments/export?period=${period}`}>
                <Button>
                  <Download size={12} /> CSV
                </Button>
              </Link>
            )}
          </div>
        </div>

        {/* Таблица */}
        <div className="bg-paper border border-line rounded-lg overflow-hidden">
          <div className="overflow-x-auto thin-scroll">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="bg-bg border-b border-line">
                  <Th>Дата</Th>
                  <Th>Клиент</Th>
                  <Th>Услуга</Th>
                  <Th>Способ</Th>
                  <Th>Менеджер</Th>
                  <Th align="right">Сумма</Th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-b border-line-2 last:border-0 hover:bg-bg">
                    <td className="px-4 py-2.5 font-mono text-ink-3 whitespace-nowrap">
                      {formatDate(p.paidAt)}
                    </td>
                    <td className="px-4 py-2.5">
                      <Link href={`/clients/${p.lead.id}`} className="flex items-center gap-2.5">
                        <Avatar name={p.lead.client.fullName} size="sm" />
                        <span className="font-semibold text-ink">{p.lead.client.fullName}</span>
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-ink-2">{p.lead.funnel.name}</td>
                    <td className="px-4 py-2.5">
                      <Badge>
                        {({CARD: 'Карта', CASH: 'Наличные', TRANSFER: 'Перевод', OTHER: 'Другое'} as Record<string,string>)[p.method]}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-ink-3">{p.createdBy?.name ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold text-success whitespace-nowrap">
                      +{formatMoney(p.amount)} zl
                    </td>
                  </tr>
                ))}
                {payments.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-ink-4">
                      Платежей за выбранный период не было
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th className={`px-4 py-2.5 text-[10.5px] uppercase tracking-[0.05em] text-ink-4 font-semibold ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  );
}
