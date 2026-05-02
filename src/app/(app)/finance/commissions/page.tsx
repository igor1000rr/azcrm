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
import { CommissionsActions, RecalcUserCommissions } from './actions-view';

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

  // Anna 02.05.2026: «Оно зачем-то вычитывает старые даты — в новые периоды.
  // Оно же должно по месяцам считать». Раньше фильтровали по
  // commission.createdAt (когда комиссия создана в системе) — но Anna вводит
  // платежи задним числом (paidAt 30.04.2025 в мае 2026), и такие комиссии
  // попадали в текущий месяц по createdAt хотя в таблице показывался paidAt.
  // Семантически премия относится к месяцу когда платёж фактически получен,
  // поэтому фильтруем по payment.paidAt — что и видит Anna в столбце «Дата».
  const where = {
    payment: { paidAt: { gte: from, lte: to } },
    ...(userIdFilter ? { userId: userIdFilter } : {}),
    ...(paidFilter !== 'all' ? { paidOut: paidFilter === '1' } : {}),
  };

  const [commissions, allUsers] = await Promise.all([
    db.commission.findMany({
      where,
      // Сортировка тоже по paidAt — чтобы порядок в таблице совпадал
      // с тем по чему мы фильтруем. Внутри одного дня дополнительно
      // сортируем по createdAt чтобы порядок был стабилен.
      orderBy: [{ payment: { paidAt: 'desc' } }, { createdAt: 'desc' }],
      take: 500,
      include: {
        user: { select: { id: true, name: true, role: true, commissionPercent: true } },
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
    currentPct: number | null;     // актуальный User.commissionPercent — для подсказки в сводке
    totalAmount: number; totalCommission: number; count: number;
    paidOut: number; pending: number;
  }>();
  for (const c of commissions) {
    const k = c.user.id;
    if (!byUser.has(k)) {
      byUser.set(k, {
        id: c.user.id, name: c.user.name, role: c.user.role,
        currentPct: c.user.commissionPercent != null ? Number(c.user.commissionPercent) : null,
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

  // Быстрые пресеты периода (Anna 02.05.2026 — чтобы быстро переключаться
  // «этот месяц / прошлый / всё»). Передаём через URL search params.
  const prevMonthFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthTo   = new Date(now.getFullYear(), now.getMonth(), 0);
  const yearStart     = new Date(now.getFullYear(), 0, 1);
  const yearEnd       = new Date(now.getFullYear(), 11, 31);
  const presetParams = (f: Date, t: Date) => {
    const sp = new URLSearchParams();
    sp.set('from', toDateStr(f));
    sp.set('to', toDateStr(t));
    if (params.user) sp.set('user', params.user);
    if (params.paid) sp.set('paid', params.paid);
    return `?${sp.toString()}`;
  };
  const isCurrentMonth = toDateStr(from) === toDateStr(defaultFrom) && toDateStr(to) === toDateStr(defaultTo);
  const isPrevMonth    = toDateStr(from) === toDateStr(prevMonthFrom) && toDateStr(to) === toDateStr(prevMonthTo);
  const isYear         = toDateStr(from) === toDateStr(yearStart) && toDateStr(to) === toDateStr(yearEnd);

  return (
    <>
      <Topbar breadcrumbs={[{ label: 'Финансы' }, { label: 'Премии менеджеров' }]} />

      <div className="p-4 md:p-5 max-w-[1400px] w-full">
        {/* Быстрые пресеты периода */}
        <div className="flex gap-1.5 mb-2 flex-wrap">
          <PresetLink href={presetParams(defaultFrom, defaultTo)} active={isCurrentMonth}>Этот месяц</PresetLink>
          <PresetLink href={presetParams(prevMonthFrom, prevMonthTo)} active={isPrevMonth}>Прошлый месяц</PresetLink>
          <PresetLink href={presetParams(yearStart, yearEnd)} active={isYear}>{now.getFullYear()} год</PresetLink>
        </div>

        {/* Фильтры */}
        <form method="GET" className="bg-paper border border-line rounded-lg p-3 mb-3 flex items-end gap-3 flex-wrap">
          <Field label="С">
            <input type="date" name="from" defaultValue={toDateStr(from)} min="2000-01-01" max="2100-12-31" className="text-[12px] border border-line rounded px-2 py-1 bg-paper" />
          </Field>
          <Field label="По">
            <input type="date" name="to" defaultValue={toDateStr(to)} min="2000-01-01" max="2100-12-31" className="text-[12px] border border-line rounded px-2 py-1 bg-paper" />
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
          <span className="text-[11px] text-ink-4 ml-auto">
            Период считается по дате платежа (когда деньги получены)
          </span>
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
                    <Th align="right">% сейчас</Th>
                    <Th align="right">Привод. сумма</Th>
                    <Th align="right">Премия всего</Th>
                    <Th align="right">Выплачено</Th>
                    <Th align="right">К выплате</Th>
                    <Th align="right">Платежей</Th>
                    {isAdmin && <Th align="right">Действия</Th>}
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
                      <td className="px-4 py-2.5 text-right font-mono">
                        {a.currentPct !== null
                          ? <span className="text-ink">{a.currentPct}%</span>
                          : <span className="text-ink-4" title="% не задан, используется fallback (по услуге или 5%)">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono">{formatMoney(a.totalAmount)} zł</td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold text-success">{formatMoney(a.totalCommission)} zł</td>
                      <td className="px-4 py-2.5 text-right font-mono text-ink-3">{formatMoney(a.paidOut)} zł</td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold text-warn">{formatMoney(a.pending)} zł</td>
                      <td className="px-4 py-2.5 text-right font-mono">{a.count}</td>
                      {isAdmin && (
                        <td className="px-4 py-2.5 text-right">
                          <RecalcUserCommissions userId={a.id} userName={a.name} />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {isAdmin && (
              <div className="px-4 py-2 border-t border-line bg-bg/40 text-[11px] text-ink-3">
                «Пересчитать» применяет актуальный % менеджера ко всем его невыплаченным премиям. Выплаченные не меняются.
              </div>
            )}
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

function PresetLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={`/finance/commissions${href}`}
      className={
        active
          ? 'inline-flex items-center px-2.5 py-1 text-[11.5px] font-semibold rounded bg-navy text-white'
          : 'inline-flex items-center px-2.5 py-1 text-[11.5px] font-medium rounded border border-line bg-paper text-ink-2 hover:border-ink-5'
      }
    >
      {children}
    </Link>
  );
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
