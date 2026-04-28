// Финансы → Премии: таблица премий по приведённым клиентам.
// ADMIN видит всех, менеджер — только свои (без сводок чужих).
import Link from 'next/link';
import { Topbar } from '@/components/topbar';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { canViewFinance, canMarkCommissionPaid } from '@/lib/permissions';
import { formatDate, formatMoney } from '@/lib/utils';
import { CommissionsActions } from './actions-view';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    from?: string; to?: string; user?: string; paid?: '0' | '1' | 'all';
  }>;
}

export default async function CommissionsPage({ searchParams }: PageProps) {
  const user = await requireUser();
  const params = await searchParams;
  const isAdmin = canViewFinance(user);

  // Период: по дефолту текущий месяц
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  const defaultTo = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  const from = params.from ? new Date(params.from) : defaultFrom;
  const to = params.to ? new Date(params.to + 'T23:59:59') : defaultTo;
  const paidFilter = params.paid ?? 'all';

  // Менеджер видит только свои; админ может фильтровать по конкретному
  const userIdFilter = isAdmin ? (params.user || undefined) : user.id;

  const where = {
    createdAt: { gte: from, lte: to },
    ...(userIdFilter ? { userId: userIdFilter } : {}),
    ...(paidFilter !== 'all' ? { paidOut: paidFilter === '1' } : {}),
  };

  const [commissions, allUsers] = await Promise.all([
    db.commission.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        user: { select: { id: true, name: true, role: true } },
        payment: {
          select: {
            id: true, amount: true, paidAt: true, sequence: true,
            lead: {
              select: {
                id: true, totalAmount: true,
                client: { select: { id: true, fullName: true } },
                service: { select: { name: true } },
                funnel: { select: { name: true } },
              },
            },
          },
        },
      },
    }),
    isAdmin
      ? db.user.findMany({
          where: { isActive: true, role: { in: ['SALES', 'LEGAL'] } },
          select: { id: true, name: true, role: true },
          orderBy: { name: 'asc' },
        })
      : [],
  ]);

  // Свод: группировка по менеджеру
  const byUser = new Map<string, {
    id: string; name: string; role: string;
    totalAmount: number; totalCommission: number; count: number;
    paidOut: number; pending: number;
  }>();
  for (const c of commissions) {
    const k = c.user.id;
    if (!byUser.has(k)) {
      byUser.set(k, {
        id: c.user.id, name: c.user.name, role: c.user.role,
        totalAmount: 0, totalCommission: 0, count: 0, paidOut: 0, pending: 0,
      });
    }
    const agg = byUser.get(k)!;
    agg.count += 1;
    agg.totalAmount += Number(c.basePayment);
    agg.totalCommission += Number(c.amount);
    if (c.paidOut) agg.paidOut += Number(c.amount); else agg.pending += Number(c.amount);
  }
  const aggregated = [...byUser.values()].sort((a, b) => b.totalCommission - a.totalCommission);

  return (
    <>
      <Topbar breadcrumbs={[{ label: 'Финансы' }, { label: 'Премии менеджеров' }]} />

      <div className="p-4 md:p-5 max-w-[1400px] w-full">
        {/* Фильтры */}
        <form method="GET" className="bg-paper border border-line rounded-lg p-3 mb-3 flex items-end gap-3 flex-wrap">
          <Field label="С">
            <input type="date" name="from" defaultValue={toDateStr(from)} className="text-[12px] border border-line rounded px-2 py-1 bg-paper" />
          </Field>
          <Field label="По">
            <input type="date" name="to" defaultValue={toDateStr(to)} className="text-[12px] border border-line rounded px-2 py-1 bg-paper" />
          </Field>
          {isAdmin && (
            <Field label="Менеджер">
              <select name="user" defaultValue={params.user ?? ''} className="text-[12px] border border-line rounded px-2 py-1 bg-paper min-w-[180px]">
                <option value="">— все —</option>
                {allUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.name} ({u.role === 'SALES' ? 'продажи' : 'легализация'})</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Статус">
            <select name="paid" defaultValue={paidFilter} className="text-[12px] border border-line rounded px-2 py-1 bg-paper">
              <option value="all">все</option>
              <option value="0">не выплачены</option>
              <option value="1">выплачены</option>
            </select>
          </Field>
          <button type="submit" className="px-3 py-1.5 text-[12px] font-semibold bg-navy text-white rounded">Применить</button>
        </form>

        {/* Сводка по менеджерам */}
        {aggregated.length > 0 && (
          <div className="bg-paper border border-line rounded-lg overflow-hidden mb-4">
            <div className="px-4 py-3 border-b border-line">
              <h3 className="text-[12.5px] font-bold uppercase tracking-[0.05em] text-ink-2">
                Сводка за период
              </h3>
            </div>
            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-line bg-bg">
                    <Th>Менеджер</Th>
                    <Th>Роль</Th>
                    <Th align="right">Привод. сумма</Th>
                    <Th align="right">Премия всего</Th>
                    <Th align="right">Выплачено</Th>
                    <Th align="right">К выплате</Th>
                    <Th align="right">Платежей</Th>
                  </tr>
                </thead>
                <tbody>
                  {aggregated.map((a) => (
                    <tr key={a.id} className="border-b border-line-2 last:border-0">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={a.name} size="sm" />
                          <span className="font-semibold text-ink">{a.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-ink-3">
                        {a.role === 'SALES' ? 'Продажи' : a.role === 'LEGAL' ? 'Легализация' : 'Админ'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono">{formatMoney(a.totalAmount)} zł</td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold text-success">{formatMoney(a.totalCommission)} zł</td>
                      <td className="px-4 py-2.5 text-right font-mono text-ink-3">{formatMoney(a.paidOut)} zł</td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold text-warn">{formatMoney(a.pending)} zł</td>
                      <td className="px-4 py-2.5 text-right font-mono">{a.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Детальная таблица */}
        <div className="bg-paper border border-line rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-line">
            <h3 className="text-[12.5px] font-bold uppercase tracking-[0.05em] text-ink-2">
              Детальная таблица ({commissions.length})
            </h3>
          </div>
          <div className="overflow-x-auto thin-scroll">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="bg-bg border-b border-line">
                  <Th>Дата</Th>
                  <Th>Клиент</Th>
                  <Th>Услуга</Th>
                  <Th>Менеджер</Th>
                  <Th>Роль</Th>
                  <Th align="right">Платёж</Th>
                  <Th align="right">%</Th>
                  <Th align="right">Премия</Th>
                  <Th>Статус</Th>
                  {canMarkCommissionPaid(user) && <Th />}
                </tr>
              </thead>
              <tbody>
                {commissions.map((c) => (
                  <tr key={c.id} className="border-b border-line-2 last:border-0 hover:bg-bg">
                    <td className="px-4 py-2.5 font-mono text-ink-3 whitespace-nowrap">
                      {formatDate(c.payment.paidAt)}
                    </td>
                    <td className="px-4 py-2.5">
                      <Link href={`/clients/${c.payment.lead.id}`} className="font-semibold text-ink hover:text-navy">
                        {c.payment.lead.client.fullName}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-ink-3">
                      {c.payment.lead.service?.name ?? c.payment.lead.funnel.name}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Avatar name={c.user.name} size="sm" />
                        <span className="text-ink">{c.user.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge>{c.role === 'SALES' ? 'Продажи' : 'Легализация'}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">
                      {formatMoney(c.payment.amount)} zł
                      <span className="text-ink-4 text-[10.5px] ml-1">#{c.payment.sequence}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">{Number(c.percent)}%</td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold text-success">
                      +{formatMoney(c.amount)} zł
                    </td>
                    <td className="px-4 py-2.5">
                      {c.paidOut ? (
                        <Badge>выплачено</Badge>
                      ) : (
                        <span className="text-warn font-semibold text-[11.5px]">к выплате</span>
                      )}
                    </td>
                    {canMarkCommissionPaid(user) && (
                      <td className="px-4 py-2.5 text-right">
                        <CommissionsActions id={c.id} paidOut={c.paidOut} />
                      </td>
                    )}
                  </tr>
                ))}
                {commissions.length === 0 && (
                  <tr>
                    <td colSpan={canMarkCommissionPaid(user) ? 10 : 9} className="px-4 py-12 text-center text-ink-4">
                      Премий за выбранный период нет
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

function Th({ children, align }: { children?: React.ReactNode; align?: 'right' }) {
  return (
    <th className={`px-4 py-2.5 text-[10.5px] uppercase tracking-[0.05em] text-ink-4 font-semibold ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px] uppercase tracking-[0.05em] text-ink-4 font-semibold">{label}</span>
      {children}
    </label>
  );
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
