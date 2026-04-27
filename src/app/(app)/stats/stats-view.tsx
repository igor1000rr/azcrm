'use client';

// Аналитика — графики на recharts + KPI + сводки
import Link from 'next/link';
import { Avatar } from '@/components/ui/avatar';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  PieChart, Pie, Cell, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { cn, formatMoney } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { UserRole } from '@prisma/client';

interface FunnelStat {
  id: string; name: string; leads: number;
  total: number; paid: number; closed: number; lost: number; conv: number;
}

interface ManagerStat {
  id: string; name: string; role: UserRole;
  leads: number; total: number; paid: number; closed: number;
}

interface Props {
  period: '7d' | '30d' | '90d' | '365d';
  kpi: {
    allLeads: number; allClosed: number; allLost: number;
    totalPaid: number; paymentsCount: number; avgPayment: number;
  };
  funnelStats: FunnelStat[];
  paymentsChart: Array<{ date: string; amount: number }>;
  paymentMethodsChart: Array<{ method: string; value: number }>;
  leadsChart: Array<{ date: string; count: number }>;
  managersChart: ManagerStat[];
  sourcesChart: Array<{ kind: string; label: string; count: number }>;
}

const FUNNEL_COLORS = ['#0A1A35', '#7C3AED', '#DC2626', '#16A34A', '#CA8A04', '#0891B2'];
const METHOD_COLORS: Record<string, string> = {
  CASH: '#16A34A', CARD: '#2563EB', TRANSFER: '#7C3AED', OTHER: '#71717A',
};
const METHOD_LABELS: Record<string, string> = {
  CASH: 'Наличные', CARD: 'Карта', TRANSFER: 'Перевод', OTHER: 'Другое',
};

export function StatsView({
  period, kpi, funnelStats, paymentsChart, paymentMethodsChart, leadsChart, managersChart, sourcesChart,
}: Props) {
  const conversion = kpi.allLeads > 0 ? Math.round((kpi.allClosed / kpi.allLeads) * 100) : 0;
  const lostRate   = kpi.allLeads > 0 ? Math.round((kpi.allLost / kpi.allLeads) * 100)   : 0;

  return (
    <div className="p-4 md:p-5 max-w-[1400px] w-full">

      {/* Период */}
      <div className="flex border border-line rounded-md p-0.5 bg-paper inline-flex mb-3">
        {(['7d', '30d', '90d', '365d'] as const).map((p) => (
          <Link
            key={p}
            href={`/stats?period=${p}`}
            className={cn(
              'px-3.5 py-1 text-[12px] font-medium rounded',
              period === p ? 'bg-navy text-white' : 'text-ink-3 hover:text-ink',
            )}
          >
            {p === '7d' ? 'Неделя' : p === '30d' ? 'Месяц' : p === '90d' ? 'Квартал' : 'Год'}
          </Link>
        ))}
      </div>

      {/* KPI карточки */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <KpiCard label="Новых лидов" value={kpi.allLeads} subtitle="за период" />
        <KpiCard
          label="Конверсия"
          value={`${conversion}%`}
          subtitle={`${kpi.allClosed} закрыто`}
          highlight={conversion >= 30 ? 'success' : conversion >= 15 ? 'warn' : 'danger'}
        />
        <KpiCard
          label="Получено"
          value={`${formatMoney(kpi.totalPaid)} zł`}
          subtitle={`${kpi.paymentsCount} платежей · средний ${formatMoney(Math.round(kpi.avgPayment))} zł`}
          highlight="success"
        />
        <KpiCard
          label="Отказов"
          value={`${lostRate}%`}
          subtitle={`${kpi.allLost} лидов`}
          highlight={lostRate > 30 ? 'danger' : 'default'}
        />
      </div>

      {/* График платежей по дням */}
      <ChartCard title="Платежи по дням">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={paymentsChart}>
            <CartesianGrid strokeDasharray="3 3" stroke="#ECECEC" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: '#71717A' }}
              tickFormatter={(v) => formatDateShort(v)}
              tickLine={false}
              axisLine={{ stroke: '#ECECEC' }}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#71717A' }}
              tickFormatter={(v) => `${v / 1000}k`}
              tickLine={false}
              axisLine={{ stroke: '#ECECEC' }}
            />
            <Tooltip
              formatter={(v: number) => `${formatMoney(v)} zł`}
              labelFormatter={(v) => formatDateFull(v as string)}
              contentStyle={tooltipStyle}
            />
            <Line type="monotone" dataKey="amount" stroke="#0A1A35" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Источники заявок (WhatsApp / Телефон / Telegram / ...) */}
      <ChartCard title="Источники заявок за период">
        {sourcesChart.length === 0 ? (
          <div className="text-center py-8 text-[12px] text-ink-4">Нет лидов за период</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-2">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={sourcesChart} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#ECECEC" />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#71717A' }} tickLine={false} axisLine={{ stroke: '#ECECEC' }} />
                <YAxis dataKey="label" type="category" width={120} tick={{ fontSize: 11, fill: '#71717A' }} tickLine={false} axisLine={{ stroke: '#ECECEC' }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" fill="#0A1A35" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="space-y-1.5">
              {sourcesChart.map((s) => {
                const total = sourcesChart.reduce((a, b) => a + b.count, 0);
                const pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
                return (
                  <div key={s.kind} className="flex items-center justify-between text-[12.5px] py-1.5 px-2 hover:bg-bg rounded">
                    <span className="text-ink-2 font-medium">{s.label}</span>
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-bold text-ink">{s.count}</span>
                      <span className="font-mono text-ink-3 text-[11px] w-10 text-right">{pct}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </ChartCard>

      {/* Грид: лиды + способы оплаты */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
        <div className="lg:col-span-2">
          <ChartCard title="Новые лиды по дням">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={leadsChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ECECEC" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: '#71717A' }}
                  tickFormatter={(v) => formatDateShort(v)}
                  tickLine={false}
                  axisLine={{ stroke: '#ECECEC' }}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#71717A' }}
                  tickLine={false}
                  axisLine={{ stroke: '#ECECEC' }}
                />
                <Tooltip
                  labelFormatter={(v) => formatDateFull(v as string)}
                  contentStyle={tooltipStyle}
                />
                <Bar dataKey="count" fill="#B8924A" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        <ChartCard title="Способы оплаты">
          {paymentMethodsChart.length === 0 ? (
            <div className="h-[220px] grid place-items-center text-[12px] text-ink-4">
              Платежей за период нет
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={paymentMethodsChart}
                  dataKey="value"
                  nameKey="method"
                  cx="50%"
                  cy="50%"
                  outerRadius={70}
                  innerRadius={40}
                >
                  {paymentMethodsChart.map((p) => (
                    <Cell key={p.method} fill={METHOD_COLORS[p.method]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v: number, name: string) => [`${formatMoney(v)} zł`, METHOD_LABELS[name]]}
                  contentStyle={tooltipStyle}
                />
                <Legend
                  formatter={(value) => METHOD_LABELS[value as string]}
                  wrapperStyle={{ fontSize: 11 }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Сводка по воронкам */}
      <ChartCard title="Сводка по воронкам">
        <div className="overflow-x-auto thin-scroll">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-line">
                <Th>Воронка</Th>
                <Th align="right">Лидов</Th>
                <Th align="right">Стоимость</Th>
                <Th align="right">Получено</Th>
                <Th align="right">Закрыто</Th>
                <Th align="right">Отказано</Th>
                <Th align="right">Конверсия</Th>
              </tr>
            </thead>
            <tbody>
              {funnelStats.map((s, i) => (
                <tr key={s.id} className="border-b border-line-2 last:border-0">
                  <td className="px-4 py-2.5 font-semibold text-ink">
                    <span className="inline-flex items-center gap-2">
                      <span className="w-2 h-2 rounded" style={{ background: FUNNEL_COLORS[i % FUNNEL_COLORS.length] }} />
                      {s.name}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">{s.leads}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{formatMoney(s.total)} zł</td>
                  <td className="px-4 py-2.5 text-right font-mono text-success font-semibold">
                    {formatMoney(s.paid)} zł
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-success">{s.closed}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-danger">{s.lost}</td>
                  <td className="px-4 py-2.5 text-right font-mono font-bold">{s.conv}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>

      {/* Производительность менеджеров */}
      <ChartCard title="Производительность менеджеров (за период)">
        {managersChart.length === 0 ? (
          <div className="text-center py-8 text-[13px] text-ink-4">
            Менеджеров не найдено
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {managersChart
              .sort((a, b) => b.paid - a.paid)
              .map((m) => (
                <div key={m.id} className="p-3 border border-line rounded-md flex items-start gap-3">
                  <Avatar name={m.name} size="md" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-ink truncate">{m.name}</div>
                    <div className="text-[10.5px] text-ink-4 mb-1.5">
                      {m.role === 'SALES' ? 'Менеджер продаж' : 'Менеджер легализации'}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11.5px]">
                      <div>
                        <div className="text-ink-4 text-[10.5px]">Лидов</div>
                        <div className="font-mono font-semibold">{m.leads}</div>
                      </div>
                      <div>
                        <div className="text-ink-4 text-[10.5px]">Закрыл</div>
                        <div className="font-mono font-semibold text-success">{m.closed}</div>
                      </div>
                      <div className="col-span-2 mt-1 pt-1.5 border-t border-line-2">
                        <div className="text-ink-4 text-[10.5px]">Получено</div>
                        <div className="font-mono font-semibold text-success">{formatMoney(m.paid)} zł</div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}
      </ChartCard>
    </div>
  );
}

// ============ КОМПОНЕНТЫ ============

function KpiCard({
  label, value, subtitle, highlight,
}: {
  label: string;
  value: string | number;
  subtitle?: string;
  highlight?: 'success' | 'danger' | 'warn' | 'default';
}) {
  return (
    <div className="bg-paper border border-line rounded-lg p-3.5">
      <div className="text-[10.5px] text-ink-4 uppercase tracking-[0.06em] font-semibold mb-1.5">
        {label}
      </div>
      <div className={cn(
        'text-[22px] font-bold tracking-tight font-mono leading-none',
        highlight === 'success' && 'text-success',
        highlight === 'danger'  && 'text-danger',
        highlight === 'warn'    && 'text-warn',
      )}>
        {value}
      </div>
      {subtitle && (
        <div className="text-[11px] text-ink-4 mt-1.5">{subtitle}</div>
      )}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-paper border border-line rounded-lg overflow-hidden mb-4">
      <div className="px-4 py-3 border-b border-line">
        <h3 className="text-[12.5px] font-bold uppercase tracking-[0.05em] text-ink-2">
          {title}
        </h3>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th className={cn(
      'px-4 py-2.5 text-[10.5px] uppercase tracking-[0.05em] text-ink-4 font-semibold',
      align === 'right' ? 'text-right' : 'text-left',
    )}>{children}</th>
  );
}

const tooltipStyle = {
  background:   '#FFFFFF',
  border:       '1px solid #DDDDDD',
  borderRadius: '6px',
  fontSize:     '12px',
  padding:      '6px 10px',
};

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()}.${(d.getMonth() + 1).toString().padStart(2, '0')}`;
}
function formatDateFull(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}
