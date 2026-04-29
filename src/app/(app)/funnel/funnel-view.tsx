'use client';

import { useState, useEffect, useTransition, type DragEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  RefreshCw, Download, Plus, Search,
  X as XIcon, LayoutGrid, List,
  AlertCircle, Calendar as CalendarIcon, FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { cn, formatMoney, formatDate, daysUntil } from '@/lib/utils';
import { changeLeadStage } from '../actions';
import type { UserRole } from '@prisma/client';

interface FunnelLite { id: string; name: string; color: string | null; count: number; }
interface StageLite { id: string; name: string; color: string | null; position: number; isFinal: boolean; isLost: boolean; }
interface LeadLite {
  id: string; stageId: string; clientName: string; phone: string;
  city: string | null; source: string | null;
  sales: { id: string; name: string } | null;
  legal: { id: string; name: string } | null;
  totalAmount: number; paid: number; debt: number;
  docsCount: number; docsHave: number;
  fingerprintDate: string | null; updatedAt: string;
}
interface KPI { leadsCount: number; totalAmount: number; totalPaid: number; totalDebt: number; conversion: number; decisionCount: number; debtorsCount: number; }
interface Filters { city: string; mgr: string; debt: boolean; q: string; }

interface FunnelViewProps {
  funnels: FunnelLite[]; currentFunnelId: string; currentFunnelName: string;
  stages: StageLite[]; leads: LeadLite[];
  cities: { id: string; name: string }[];
  managers: { id: string; name: string; role: UserRole }[];
  kpi: KPI; currentFilters: Filters; currentUserRole: UserRole;
}

export function FunnelView({
  funnels, currentFunnelId, currentFunnelName, stages, leads,
  cities, managers, kpi, currentFilters, currentUserRole,
}: FunnelViewProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban');
  const [searchValue, setSearchValue] = useState(currentFilters.q);
  const [localLeads, setLocalLeads] = useState(leads);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  // Синхронизация локального состояния с пропсами при смене фильтров.
  // useState(leads) инициализируется один раз — без useEffect новые
  // отфильтрованные данные с сервера не попадают в UI и канбан рендерится
  // из устаревшего localLeads. Anna жаловалась: меняешь город — ничего
  // не меняется. Причина была здесь.
  // localLeads нужен только для оптимистичного drag-n-drop (мгновенно
  // переставить карточку до ответа сервера); во всех остальных случаях
  // должен совпадать с props.leads.
  useEffect(() => { setLocalLeads(leads); }, [leads]);
  useEffect(() => { setSearchValue(currentFilters.q); }, [currentFilters.q]);

  function updateUrl(patch: Partial<Filters & { funnel: string }>) {
    const params = new URLSearchParams(window.location.search);
    const merged = { funnel: currentFunnelId, ...currentFilters, ...patch };
    Object.entries(merged).forEach(([k, v]) => {
      if (v === '' || v === false || v === undefined || v === null) params.delete(k);
      else if (v === true) params.set(k, '1');
      else params.set(k, String(v));
    });
    startTransition(() => { router.push(`/funnel?${params.toString()}`); });
  }

  function handleDragStart(e: DragEvent, leadId: string) {
    e.dataTransfer.setData('text/plain', leadId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingId(leadId);
  }
  function handleDragEnd() { setDraggingId(null); setDragOverStage(null); }
  function handleDragOver(e: DragEvent, stageId: string) {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverStage(stageId);
  }
  function handleDragLeave() { setDragOverStage(null); }
  async function handleDrop(e: DragEvent, newStageId: string) {
    e.preventDefault();
    setDragOverStage(null);
    const leadId = e.dataTransfer.getData('text/plain');
    if (!leadId) return;
    const lead = localLeads.find((l) => l.id === leadId);
    if (!lead || lead.stageId === newStageId) return;
    setLocalLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, stageId: newStageId } : l)));
    try {
      await changeLeadStage(leadId, newStageId);
      router.refresh();
    } catch (err) {
      setLocalLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, stageId: lead.stageId } : l)));
      console.error(err);
      alert('Не удалось изменить этап');
    }
  }
  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    updateUrl({ q: searchValue });
  }

  return (
    <div className="p-4 md:p-5 max-w-[1640px] w-full">
      <div className="bg-paper border border-line rounded-lg mb-3 p-1 flex gap-0 overflow-x-auto no-scroll" data-testid="funnel-switcher">
        {funnels.map((f) => (
          <button key={f.id} type="button" onClick={() => updateUrl({ funnel: f.id })}
            data-testid={`funnel-btn-${f.id}`}
            className={cn(
              'px-3.5 py-1.5 rounded-md text-[12.5px] font-medium transition-colors whitespace-nowrap shrink-0',
              'flex items-center gap-2',
              f.id === currentFunnelId ? 'bg-navy text-white font-semibold' : 'text-ink-3 hover:bg-navy/[0.04] hover:text-navy',
            )}>
            <span>{f.name}</span>
            <span className={cn(
                'text-[10.5px] font-bold px-1.5 py-px rounded-full min-w-[22px] text-center',
                f.id === currentFunnelId ? 'bg-gold text-navy' : 'bg-bg text-ink-3',
              )}>
              {f.count}
            </span>
          </button>
        ))}
      </div>

      <div className="bg-paper border border-line rounded-lg mb-3 overflow-hidden">
        <div className="h-[3px] bg-gradient-to-r from-navy via-navy/60 to-gold/40" />
        <div className="px-4 md:px-5 py-3.5 border-b border-line flex items-center gap-3 flex-wrap">
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-[17px] font-bold text-navy tracking-tight">{currentFunnelName}</h1>
            <span className="text-12 text-navy/60 font-semibold">{kpi.leadsCount} активных</span>
          </div>
          <div className="ml-auto flex items-center gap-1.5 flex-wrap">
            <Button onClick={() => router.refresh()} className="hidden md:inline-flex">
              <RefreshCw size={12} /> Обновить
            </Button>
            <Link href="/clients/new">
              <Button variant="primary"><Plus size={12} /> Новый лид</Button>
            </Link>
          </div>
        </div>
        <div className={cn(
          'grid gap-px bg-line',
          // Менеджерам (SALES/LEGAL) показываем только "Всего лидов" —
          // финансы (стоимость/получено/долг/конверсия) видны только админу.
          currentUserRole === 'ADMIN'
            ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-5'
            : 'grid-cols-1',
        )}>
          <KpiCell label="Всего лидов" value={kpi.leadsCount} foot={`${kpi.decisionCount} закрыто`} />
          {currentUserRole === 'ADMIN' && (
            <>
              <KpiCell label="Стоимость" value={formatMoney(kpi.totalAmount)} unit="zł" foot={`средний ${formatMoney(kpi.leadsCount ? Math.round(kpi.totalAmount / kpi.leadsCount) : 0)} zł`} />
              <KpiCell label="Получено" value={formatMoney(kpi.totalPaid)} unit="zł" foot={`${Math.round((kpi.totalPaid / Math.max(kpi.totalAmount, 1)) * 100)}% от суммы`} highlight={kpi.totalPaid > 0 ? 'success' : undefined} />
              <KpiCell label="Долг" value={formatMoney(kpi.totalDebt)} unit="zł" foot={`${kpi.debtorsCount} ${plural(kpi.debtorsCount, 'клиент', 'клиента', 'клиентов')}`} highlight={kpi.totalDebt > 0 ? 'danger' : undefined} />
              <KpiCell label="Конверсия" value={kpi.conversion} unit="%" foot={`${kpi.decisionCount} децизий`} />
            </>
          )}
        </div>
      </div>

      <div className="flex gap-2 mb-3 items-center flex-wrap">
        <form onSubmit={handleSearchSubmit} className="flex-1 min-w-[200px] max-w-[320px] relative" data-testid="search-form">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy/40" />
          <input type="text" value={searchValue} onChange={(e) => setSearchValue(e.target.value)}
            placeholder="Поиск по имени, телефону..."
            className="w-full pl-8 pr-3 py-1.5 text-12 bg-paper border border-line rounded-md focus:border-navy focus:outline-none" />
        </form>

        {cities.length > 0 && (
          <select value={currentFilters.city} onChange={(e) => updateUrl({ city: e.target.value })}
            data-testid="city-filter"
            className="hidden md:block px-2.5 py-1.5 text-12 bg-paper border border-line rounded-md text-ink-2 font-medium cursor-pointer hover:border-navy/40">
            <option value="">Все города</option>
            {cities.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
        )}

        {managers.length > 0 && (
          <select value={currentFilters.mgr} onChange={(e) => updateUrl({ mgr: e.target.value })}
            data-testid="mgr-filter"
            className="hidden md:block px-2.5 py-1.5 text-12 bg-paper border border-line rounded-md text-ink-2 font-medium cursor-pointer hover:border-navy/40">
            <option value="">Все менеджеры</option>
            {managers.map((m) => (<option key={m.id} value={m.id}>{m.name}</option>))}
          </select>
        )}

        <button type="button" onClick={() => updateUrl({ debt: !currentFilters.debt })}
          data-testid="debt-toggle"
          className={cn(
            'px-2.5 py-1.5 rounded-md text-12 font-medium border inline-flex items-center gap-1.5 transition-colors',
            currentFilters.debt ? 'bg-navy text-white border-navy' : 'bg-paper text-ink-2 border-line hover:border-navy/40 hover:text-navy',
          )}>
          <AlertCircle size={11} />
          Только долги
          {currentFilters.debt && (<span className="w-3.5 h-3.5 rounded-full bg-white/20 grid place-items-center"><XIcon size={8} /></span>)}
        </button>

        <div className="ml-auto hidden md:flex items-center gap-2">
          {currentUserRole === 'ADMIN' && (
            <a href={`/api/leads/export?funnel=${currentFunnelId}${currentFilters.city ? `&city=${currentFilters.city}` : ''}`}
              data-testid="export-link"
              className="px-2.5 py-1 rounded text-[11.5px] font-medium inline-flex items-center gap-1 border border-line bg-paper text-ink-2 hover:text-navy hover:bg-navy/[0.03] hover:border-navy/30"
              title="Экспорт всех лидов воронки в CSV">
              <Download size={11} /> Экспорт
            </a>
          )}
          <div className="flex border border-line rounded-md p-0.5 bg-paper">
            <button type="button" onClick={() => setViewMode('kanban')} data-testid="view-kanban"
              className={cn('px-2.5 py-1 rounded text-[11.5px] font-medium inline-flex items-center gap-1', viewMode === 'kanban' ? 'bg-navy text-white' : 'text-ink-3 hover:text-navy')}>
              <LayoutGrid size={11} /> Канбан
            </button>
            <button type="button" onClick={() => setViewMode('list')} data-testid="view-list"
              className={cn('px-2.5 py-1 rounded text-[11.5px] font-medium inline-flex items-center gap-1', viewMode === 'list' ? 'bg-navy text-white' : 'text-ink-3 hover:text-navy')}>
              <List size={11} /> Список
            </button>
          </div>
        </div>
      </div>

      {viewMode === 'kanban' && (
        <div className="grid gap-2.5 overflow-x-auto pb-3" data-testid="kanban-view"
             style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(260px, 1fr))` }}>
          {stages.map((stage) => {
            const stageLeads = localLeads.filter((l) => l.stageId === stage.id);
            const stageSum = stageLeads.reduce((s, l) => s + l.totalAmount, 0);
            return (
              <div key={stage.id}
                onDragOver={(e) => handleDragOver(e, stage.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, stage.id)}
                data-testid={`stage-${stage.id}`}
                className={cn('bg-bg-alt border rounded-lg min-w-[260px] min-h-[460px] flex flex-col', dragOverStage === stage.id ? 'border-gold bg-gold-pale' : 'border-line')}>
                <div className="px-3.5 py-2.5 flex items-center justify-between border-b border-line bg-paper rounded-t-lg sticky top-0 z-10"
                  style={{ borderTopWidth: 2, borderTopStyle: 'solid', borderTopColor: stage.color || '#0A1A35' }}>
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-navy flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: stage.color || '#0A1A35' }} />
                      {stage.name}
                    </div>
                    <div className="text-[11px] text-ink-3 mt-0.5 flex items-center gap-2">
                      <span><strong className="text-navy">{stageLeads.length}</strong> {plural(stageLeads.length, 'лид', 'лида', 'лидов')}</span>
                      {stageSum > 0 && <><span>·</span><span className="font-mono"><strong className="text-ink">{formatMoney(stageSum)}</strong> zł</span></>}
                    </div>
                  </div>
                  <button type="button" aria-label="Добавить лида в этап"
                    onClick={() => router.push(`/clients/new?funnel=${currentFunnelId}&stage=${stage.id}`)}
                    className="w-6 h-6 rounded border border-dashed border-navy/30 text-navy/50 grid place-items-center hover:border-navy hover:bg-navy hover:text-white transition-colors">
                    <Plus size={11} />
                  </button>
                </div>
                <div className="p-2 flex-1 flex flex-col gap-1.5 overflow-y-auto thin-scroll">
                  {stageLeads.length === 0 ? (
                    <div className="text-center p-4 border border-dashed border-navy/15 rounded-md text-navy/40 text-[11.5px] my-1 bg-paper/40">
                      Перетащите лида сюда
                    </div>
                  ) : (
                    stageLeads.map((lead) => (
                      <LeadCard key={lead.id} lead={lead} dragging={draggingId === lead.id}
                        onDragStart={(e) => handleDragStart(e, lead.id)} onDragEnd={handleDragEnd} />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {viewMode === 'list' && (<LeadListView leads={localLeads} stages={stages} />)}
    </div>
  );
}

function KpiCell({ label, value, unit, foot, highlight }: {
  label: string; value: string | number; unit?: string; foot?: string;
  highlight?: 'danger' | 'success';
}) {
  return (
    <div className="bg-paper px-4 py-3" data-testid={`kpi-${label}`}>
      <div className="text-[10.5px] text-navy/60 uppercase tracking-[0.06em] font-bold mb-1">{label}</div>
      <div className={cn(
          'text-[19px] font-bold tracking-tight leading-none flex items-baseline gap-1 font-mono',
          !highlight && 'text-navy',
          highlight === 'danger' && 'text-danger',
          highlight === 'success' && 'text-success',
        )}>
        {value}
        {unit && <span className="text-[11px] text-ink-4 font-medium">{unit}</span>}
      </div>
      {foot && <div className="text-[11px] text-ink-4 mt-1">{foot}</div>}
    </div>
  );
}

function LeadCard({ lead, dragging, onDragStart, onDragEnd }: {
  lead: LeadLite; dragging: boolean;
  onDragStart: (e: DragEvent) => void; onDragEnd: () => void;
}) {
  const isUrgent = lead.debt > 0;
  const fpDays = lead.fingerprintDate ? daysUntil(lead.fingerprintDate) : null;
  const isWarm = fpDays !== null && fpDays >= 0 && fpDays <= 7;
  const docsPct = lead.docsCount > 0 ? Math.round((lead.docsHave / lead.docsCount) * 100) : 0;
  return (
    <Link href={`/clients/${lead.id}`} draggable
      onDragStart={onDragStart} onDragEnd={onDragEnd}
      data-testid={`lead-card-${lead.id}`}
      className={cn(
        'group block bg-paper border border-line rounded-md p-2.5 cursor-grab active:cursor-grabbing',
        'hover:border-navy/40 hover:shadow-md transition-all',
        'flex flex-col gap-2',
        isUrgent ? 'border-l-2 border-l-danger' : isWarm ? 'border-l-2 border-l-warn' : '',
        dragging && 'opacity-40',
      )}>
      <div className="flex items-center gap-2.5">
        <Avatar name={lead.clientName} size="md" />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-navy truncate leading-tight group-hover:text-navy">
            {lead.clientName}
          </div>
          <div className="text-[11px] text-ink-3 truncate mt-px">
            {[lead.city, lead.source].filter(Boolean).join(' · ') || 'Без источника'}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {lead.fingerprintDate && fpDays !== null && (
          <span className="inline-flex items-center gap-1 text-[10.5px] px-1.5 py-px rounded font-medium border bg-warn-bg text-warn border-warn/20" data-testid="fp-badge">
            <CalendarIcon size={9} />
            {formatDate(lead.fingerprintDate)}
          </span>
        )}
        {lead.docsCount > 0 && (
          <span className="inline-flex items-center gap-1 text-[10.5px] px-1.5 py-px rounded bg-info-bg text-info border border-info/20 font-medium" data-testid="docs-badge">
            <FileText size={9} />
            {lead.docsHave}/{lead.docsCount}
          </span>
        )}
        {lead.debt > 0 && (
          <span className="inline-flex items-center gap-1 text-[10.5px] px-1.5 py-px rounded bg-danger-bg text-danger border border-danger/20 font-medium" data-testid="debt-badge">
            <AlertCircle size={9} />
            долг
          </span>
        )}
      </div>
      {lead.docsCount > 0 && (
        <div className="h-[3px] bg-bg rounded-full overflow-hidden" data-testid="docs-progress">
          <div className={cn('h-full rounded-full', docsPct < 50 ? 'bg-danger' : docsPct < 80 ? 'bg-warn' : 'bg-success')}
            style={{ width: `${docsPct}%` }} />
        </div>
      )}
      <div className="flex items-center justify-between pt-1.5 border-t border-line-2 gap-2">
        <div className="font-mono">
          {lead.debt > 0 ? (
            <>
              <div className="text-[12.5px] font-bold text-danger leading-none">{formatMoney(lead.debt)} zł</div>
              <div className="text-[10px] text-ink-4 mt-0.5">из {formatMoney(lead.totalAmount)}</div>
            </>
          ) : lead.totalAmount > 0 ? (
            <>
              <div className="text-[12.5px] font-bold text-success leading-none">{formatMoney(lead.paid)} zł</div>
              <div className="text-[10px] text-ink-4 mt-0.5">оплачено</div>
            </>
          ) : (
            <div className="text-[10.5px] text-ink-4">сумма не задана</div>
          )}
        </div>
        <div className="flex items-center">
          {lead.sales && (<Avatar name={lead.sales.name} size="xs" variant="navy" className="ring-2 ring-paper" />)}
          {lead.legal && (<Avatar name={lead.legal.name} size="xs" className="ring-2 ring-paper -ml-1.5" />)}
        </div>
      </div>
    </Link>
  );
}

function LeadListView({ leads, stages }: { leads: LeadLite[]; stages: StageLite[]; }) {
  return (
    <div className="bg-paper border border-line rounded-lg overflow-hidden" data-testid="list-view">
      <div className="overflow-x-auto thin-scroll">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="bg-navy/[0.04] border-b border-navy/10">
              <th className="text-left px-4 py-2.5 text-[10.5px] uppercase tracking-[0.05em] text-navy/70 font-bold">Клиент</th>
              <th className="text-left px-4 py-2.5 text-[10.5px] uppercase tracking-[0.05em] text-navy/70 font-bold">Этап</th>
              <th className="text-left px-4 py-2.5 text-[10.5px] uppercase tracking-[0.05em] text-navy/70 font-bold">Город</th>
              <th className="text-left px-4 py-2.5 text-[10.5px] uppercase tracking-[0.05em] text-navy/70 font-bold">Менеджеры</th>
              <th className="text-right px-4 py-2.5 text-[10.5px] uppercase tracking-[0.05em] text-navy/70 font-bold">Сумма</th>
              <th className="text-right px-4 py-2.5 text-[10.5px] uppercase tracking-[0.05em] text-navy/70 font-bold">Долг</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => {
              const st = stages.find((s) => s.id === l.stageId);
              return (
                <tr key={l.id} className="border-b border-line-2 hover:bg-navy/[0.02] cursor-pointer transition-colors">
                  <td className="px-4 py-2.5">
                    <Link href={`/clients/${l.id}`} className="flex items-center gap-2.5">
                      <Avatar name={l.clientName} size="sm" />
                      <div>
                        <div className="font-semibold text-navy">{l.clientName}</div>
                        <div className="text-[11px] text-ink-4 font-mono">{l.phone}</div>
                      </div>
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium border"
                      style={{ background: (st?.color || '#71717A') + '14', color: st?.color || '#71717A', borderColor: (st?.color || '#71717A') + '33' }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: st?.color || '#71717A' }} />
                      {st?.name}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-ink-2">{l.city || '—'}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center">
                      {l.sales && <Avatar name={l.sales.name} size="xs" variant="navy" className="ring-2 ring-paper" />}
                      {l.legal && <Avatar name={l.legal.name} size="xs" className="ring-2 ring-paper -ml-1" />}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold text-navy">{formatMoney(l.totalAmount)} zł</td>
                  <td className={cn('px-4 py-2.5 text-right font-mono font-semibold', l.debt > 0 ? 'text-danger' : 'text-success')}>
                    {l.debt > 0 ? `${formatMoney(l.debt)} zł` : 'оплачено'}
                  </td>
                </tr>
              );
            })}
            {leads.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-ink-4">Лидов не найдено</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
