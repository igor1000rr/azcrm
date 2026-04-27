// Финансы → Сводная по ЗП (премии + ставка × часы − налоги). Только ADMIN.
import { Topbar } from '@/components/topbar';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { formatMoney } from '@/lib/utils';
import { PayrollView } from './payroll-view';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string }>;
}

export default async function PayrollPage({ searchParams }: PageProps) {
  await requireAdmin();
  const params = await searchParams;

  // Период по дефолту — текущий месяц
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  const defaultTo = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  const from = params.from ? new Date(params.from) : defaultFrom;
  const to = params.to ? new Date(params.to + 'T23:59:59') : defaultTo;

  // Все активные сотрудники + их конфиг ЗП
  const users = await db.user.findMany({
    where: { isActive: true, role: { in: ['SALES', 'LEGAL'] } },
    select: {
      id: true, name: true, role: true,
      payrollConfig: true,
    },
    orderBy: { name: 'asc' },
  });

  // Комиссии за период по каждому
  const commissions = await db.commission.findMany({
    where: { createdAt: { gte: from, lte: to } },
    select: { userId: true, amount: true, paidOut: true },
  });

  // Часы за период (WorkLog)
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
    const fixedSalary = Number(u.payrollConfig?.fixedSalary ?? 0);
    const taxAmount = Number(u.payrollConfig?.taxAmount ?? 0);

    const ratePart = hourlyRate * totalHours;
    const grossTotal = totalCommission + ratePart + fixedSalary;
    const netTotal = Math.max(0, grossTotal - taxAmount);

    return {
      id: u.id, name: u.name, role: u.role,
      hourlyRate, fixedSalary, taxAmount,
      totalHours, ratePart,
      totalCommission, paidOut, pending,
      grossTotal, netTotal,
      hasConfig: !!u.payrollConfig,
    };
  });

  // Итоги
  const totals = {
    commissions: rows.reduce((s, r) => s + r.totalCommission, 0),
    rate:        rows.reduce((s, r) => s + r.ratePart, 0),
    fixed:       rows.reduce((s, r) => s + r.fixedSalary, 0),
    tax:         rows.reduce((s, r) => s + r.taxAmount, 0),
    gross:       rows.reduce((s, r) => s + r.grossTotal, 0),
    net:         rows.reduce((s, r) => s + r.netTotal, 0),
    hours:       rows.reduce((s, r) => s + r.totalHours, 0),
    pending:     rows.reduce((s, r) => s + r.pending, 0),
  };

  return (
    <>
      <Topbar breadcrumbs={[{ label: 'Финансы' }, { label: 'Сводная по ЗП' }]} />

      <div className="p-4 md:p-5 max-w-[1400px] w-full">
        {/* Фильтры */}
        <form method="GET" className="bg-paper border border-line rounded-lg p-3 mb-3 flex items-end gap-3 flex-wrap">
          <Field label="С">
            <input type="date" name="from" defaultValue={from.toISOString().slice(0,10)} className="text-[12px] border border-line rounded px-2 py-1 bg-paper" />
          </Field>
          <Field label="По">
            <input type="date" name="to" defaultValue={to.toISOString().slice(0,10)} className="text-[12px] border border-line rounded px-2 py-1 bg-paper" />
          </Field>
          <button type="submit" className="px-3 py-1.5 text-[12px] font-semibold bg-navy text-white rounded">Применить</button>
          <div className="ml-auto text-[11.5px] text-ink-3">
            Период: <strong className="text-ink">{from.toLocaleDateString('ru-RU')}</strong> — <strong className="text-ink">{to.toLocaleDateString('ru-RU')}</strong>
          </div>
        </form>

        {/* Сводные KPI */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <KpiCard label="Часов отработано" value={`${totals.hours.toFixed(1)} ч`} />
          <KpiCard label="Комиссий начислено" value={`${formatMoney(totals.commissions)} zł`} highlight="success" />
          <KpiCard label="К выплате (комиссии)" value={`${formatMoney(totals.pending)} zł`} highlight={totals.pending > 0 ? 'warn' : 'default'} />
          <KpiCard label="Чистый ФОТ" value={`${formatMoney(totals.net)} zł`} subtitle={`Грязный ${formatMoney(totals.gross)} − налоги ${formatMoney(totals.tax)}`} />
        </div>

        <PayrollView rows={rows} />
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
