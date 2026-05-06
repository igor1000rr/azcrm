// Финансы → Сводная по ЗП. Только ADMIN.
// Структура (Anna 28.04.2026):
//   Часы | Ставка/час | Ставка×часы | Премия | ZUS | PIT | Грязными свои | Зп чистая
//   Зп чистая    = ставка × часы + премии
//   Грязными свои = зп чистая + ZUS + PIT
//
// 06.05.2026 — пункт #2 аудита: формулы переведены на calcPayrollRow + sumPayrollTotals
// из @/lib/finance/payroll-calc. До этого формулы были inline'ом и дублировались
// в нескольких местах (сводка, итог, KPI). Теперь всё округление и нормализация
// (Math.max(0, n) || 0 для невалидных значений) централизовано и тестируется юнитами.
import Link from 'next/link';
import { Topbar } from '@/components/topbar';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import {
  formatMoney,
  parseWarsawDateStart, parseWarsawDateEnd,
  warsawCurrentMonthBounds, warsawPrevMonthBounds, warsawCurrentYearBounds,
  toWarsawDateStr,
} from '@/lib/utils';
import { calcPayrollRow, sumPayrollTotals } from '@/lib/finance/payroll-calc';
import { PayrollView } from './payroll-view';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string }>;
}

export default async function PayrollPage({ searchParams }: PageProps) {
  await requireAdmin();
  const params = await searchParams;

  // Период по дефолту — текущий месяц в Warsaw TZ (пункт #3 аудита)
  const { from: defaultFrom, to: defaultTo } = warsawCurrentMonthBounds();
  const from = params.from ? parseWarsawDateStart(params.from) : defaultFrom;
  const to   = params.to   ? parseWarsawDateEnd(params.to)     : defaultTo;

  // Все активные сотрудники + их конфиг ЗП
  const users = await db.user.findMany({
    where: { isActive: true, role: { in: ['SALES', 'LEGAL'] } },
    select: {
      id: true, name: true, role: true,
      payrollConfig: true,
    },
    orderBy: { name: 'asc' },
  });

  // Премии (commission в БД) за период. Фильтр по payment.paidAt — синхронно с /commissions.
  const commissions = await db.commission.findMany({
    where: { payment: { paidAt: { gte: from, lte: to } } },
    select: { userId: true, amount: true, paidOut: true },
  });

  // Часы за период (WorkLog) — фильтр по WorkLog.date.
  const workLogs = await db.workLog.findMany({
    where: { date: { gte: from, lte: to } },
    select: { userId: true, hours: true },
  });

  const rows = users.map((u) => {
    const userComms = commissions.filter((c) => c.userId === u.id);
    const totalCommission = userComms.reduce((s, c) => s + Number(c.amount), 0);
    const paidOut = userComms.filter((c) => c.paidOut).reduce((s, c) => s + Number(c.amount), 0);
    const pending = totalCommission - paidOut;

    const userLogs = workLogs.filter((w) => w.userId === u.id);
    const totalHours = userLogs.reduce((s, w) => s + Number(w.hours), 0);

    const hourlyRate = Number(u.payrollConfig?.hourlyRate ?? 0);
    const zus        = Number(u.payrollConfig?.zus        ?? 0);
    const pit        = Number(u.payrollConfig?.pit        ?? 0);

    // #2 аудита: расчёт через единый calcPayrollRow вместо inline-формулы.
    // Внутри округление до 2 знаков и нормализация невалидных значений.
    const calc = calcPayrollRow({
      hourlyRate, totalHours, totalCommission, zus, pit,
    });

    return {
      id: u.id, name: u.name, role: u.role,
      hourlyRate, zus, pit,
      totalHours,
      ratePart:        calc.ratePart,
      totalCommission, paidOut, pending,
      grossTotal:      calc.grossTotal,
      netTotal:        calc.netTotal,
      hasConfig: !!u.payrollConfig,
    };
  });

  // Итоги — через sumPayrollTotals для рассчитанных полей,
  // остальные суммируем напрямую (commissions/zus/pit/hours/pending —
  // не результат calcPayrollRow, а отдельные источники).
  const calcTotals = sumPayrollTotals(rows);
  const totals = {
    commissions: rows.reduce((s, r) => s + r.totalCommission, 0),
    rate:        calcTotals.ratePart,
    zus:         rows.reduce((s, r) => s + r.zus, 0),
    pit:         rows.reduce((s, r) => s + r.pit, 0),
    gross:       calcTotals.grossTotal,
    net:         calcTotals.netTotal,
    hours:       rows.reduce((s, r) => s + r.totalHours, 0),
    pending:     rows.reduce((s, r) => s + r.pending, 0),
  };

  const prev = warsawPrevMonthBounds();
  const year = warsawCurrentYearBounds();
  const presetParams = (f: Date, t: Date) =>
    `?from=${toWarsawDateStr(f)}&to=${toWarsawDateStr(t)}`;
  const isCurrentMonth = toWarsawDateStr(from) === toWarsawDateStr(defaultFrom) && toWarsawDateStr(to) === toWarsawDateStr(defaultTo);
  const isPrevMonth    = toWarsawDateStr(from) === toWarsawDateStr(prev.from)   && toWarsawDateStr(to) === toWarsawDateStr(prev.to);
  const isYear         = toWarsawDateStr(from) === toWarsawDateStr(year.from)   && toWarsawDateStr(to) === toWarsawDateStr(year.to);

  return (
    <>
      <Topbar breadcrumbs={[{ label: 'Финансы' }, { label: 'Сводная по ЗП' }]} />

      <div className="p-4 md:p-5 max-w-[1400px] w-full">
        <div className="flex gap-1.5 mb-2 flex-wrap">
          <PresetLink href={presetParams(defaultFrom, defaultTo)} active={isCurrentMonth}>Этот месяц</PresetLink>
          <PresetLink href={presetParams(prev.from, prev.to)}    active={isPrevMonth}>Прошлый месяц</PresetLink>
          <PresetLink href={presetParams(year.from, year.to)}    active={isYear}>{new Date().getFullYear()} год</PresetLink>
        </div>

        <form method="GET" className="bg-paper border border-line rounded-lg p-3 mb-3 flex items-end gap-3 flex-wrap">
          <Field label="С">
            <input type="date" name="from" defaultValue={toWarsawDateStr(from)} min="2000-01-01" max="2100-12-31" className="text-[12px] border border-line rounded px-2 py-1 bg-paper" />
          </Field>
          <Field label="По">
            <input type="date" name="to" defaultValue={toWarsawDateStr(to)} min="2000-01-01" max="2100-12-31" className="text-[12px] border border-line rounded px-2 py-1 bg-paper" />
          </Field>
          <button type="submit" className="px-3 py-1.5 text-[12px] font-semibold bg-navy text-white rounded">Применить</button>
          <div className="ml-auto text-[11.5px] text-ink-3">
            Период: <strong className="text-ink">{from.toLocaleDateString('ru-RU', { timeZone: 'Europe/Warsaw' })}</strong> — <strong className="text-ink">{to.toLocaleDateString('ru-RU', { timeZone: 'Europe/Warsaw' })}</strong>
          </div>
        </form>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <KpiCard label="Часов отработано" value={`${totals.hours.toFixed(1)} ч`} />
          <KpiCard label="Премий начислено" value={`${formatMoney(totals.commissions)} zł`} highlight="success" />
          <KpiCard label="К выплате (премии)" value={`${formatMoney(totals.pending)} zł`} highlight={totals.pending > 0 ? 'warn' : 'default'} />
          <KpiCard
            label="Чистая ЗП всем"
            value={`${formatMoney(totals.net)} zł`}
            subtitle={`Грязными ${formatMoney(totals.gross)} zł (ZUS ${formatMoney(totals.zus)} + PIT ${formatMoney(totals.pit)})`}
          />
        </div>

        <PayrollView rows={rows} />

        <div className="mt-3 text-[11px] text-ink-4">
          Премии считаются по дате платежа (когда деньги получены). Часы — по дате работы. Даты — время Варшавы.
        </div>
      </div>
    </>
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
      href={`/finance/payroll${href}`}
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

function KpiCard({ label, value, subtitle, highlight }: { label: string; value: string; subtitle?: string; highlight?: 'success' | 'warn' | 'danger' | 'default' }) {
  return (
    <div className="bg-paper border border-line rounded-lg p-3.5">
      <div className="text-[10.5px] text-ink-4 uppercase tracking-[0.06em] font-semibold mb-1.5">{label}</div>
      <div className={`text-[18px] font-bold tracking-tight font-mono leading-tight ${
        highlight === 'success' ? 'text-success' : highlight === 'warn' ? 'text-warn' : highlight === 'danger' ? 'text-danger' : ''
      }`}>{value}</div>
      {subtitle && <div className="text-[10.5px] text-ink-4 mt-1">{subtitle}</div>}
    </div>
  );
}
