'use client';

// Календарь — клиентская сетка месяца с возможностью создавать встречи.
//
// Структура:
//   - Шапка: ← / → / Сегодня / название месяца / кнопка "Новая встреча"
//   - Баннер pending submissions (Anna 30.04.2026) — лиды без даты подачи в уженд
//   - Сетка 7×N: дни недели + ячейки дней с событиями
//   - Модалка создания встречи (по клику на день или на кнопку)
//   - Модалка деталей события (по клику на событие в ячейке)
//
// Подсветка «волшебная штучка» (Anna 30.04.2026):
//   - event.submitted === false → красная пунктирная рамка + ⚠ маркер
//     в начале строки события. Это значит у привязанного лида не
//     поставлена дата подачи внеска (submittedAt = null).
//   - event.submitted === null → событие без привязки к лиду (внутр. встреча),
//     никакой подсветки.
//   - event.submitted === true → внесок уже подан, штатный вид.

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft, ChevronRight, Plus,
  MapPin, Users, Trash2, AlertTriangle,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Input, Textarea, Select, FormField } from '@/components/ui/input';
import { Avatar } from '@/components/ui/avatar';
import { cn, formatTime, formatDate, daysUntil } from '@/lib/utils';
import { createCalendarMeeting } from './actions';
import { deleteCalendarEvent } from '../actions';
import type { UserRole, CalendarKind } from '@prisma/client';

// Типы которые модалка может СОЗДАВАТЬ (FINGERPRINT и EXTRA_CALL создаются
// внутри карточки лида через setFingerprintDate/addExtraCall — у них своя
// логика). Должны совпадать с z.enum в createCalendarMeeting (calendar/actions.ts).
type MeetingKind = 'INTERNAL_MEETING' | 'CONSULTATION' | 'CUSTOM';

interface EventLite {
  id:             string;
  title:          string;
  startsAt:       string;
  endsAt:         string | null;
  kind:           CalendarKind;
  location:       string | null;
  description:    string | null;
  ownerId:        string | null;
  ownerName:      string | null;
  leadId:         string | null;
  leadClientName: string | null;
  // Anna 30.04.2026: false = у лида нет даты подачи внеска (подсветка красным),
  // true = подан, null = событие без привязки к лиду.
  submitted:      boolean | null;
  participants:   { id: string; name: string }[];
}

interface PendingSubmission {
  id:             string;
  clientName:     string;
  funnelName:     string;
  firstContactAt: string | null;
}

interface TeamMember { id: string; name: string; role: UserRole }
interface LeadOption  { id: string; name: string; phone: string; funnelName: string }

interface Props {
  currentUser: { id: string; name: string; role: UserRole };
  year:        number;
  monthIndex:  number; // 0-11
  events:      EventLite[];
  team:        TeamMember[];
  leads:       LeadOption[];
  pendingSubmissions: PendingSubmission[];
}

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

const KIND_STYLES: Record<CalendarKind, { bg: string; text: string; border: string; label: string }> = {
  FINGERPRINT:      { bg: 'bg-warn-bg',    text: 'text-warn',    border: 'border-warn/30',    label: 'Отпечатки' },
  EXTRA_CALL:       { bg: 'bg-danger-bg',  text: 'text-danger',  border: 'border-danger/30',  label: 'Доп. вызвание' },
  CONSULTATION:     { bg: 'bg-success-bg', text: 'text-success', border: 'border-success/30', label: 'Консультация' },
  INTERNAL_MEETING: { bg: 'bg-navy/[0.06]', text: 'text-navy',   border: 'border-navy/30',    label: 'Встреча' },
  CUSTOM:           { bg: 'bg-info-bg',    text: 'text-info',    border: 'border-info/30',    label: 'Событие' },
};

function toDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function CalendarMonthView({ currentUser, year, monthIndex, events, team, leads, pendingSubmissions }: Props) {
  const router = useRouter();

  const today = new Date();
  const todayKey = toDayKey(today);

  // Сетка дней (6 рядов × 7 дней = 42)
  const gridDays = useMemo(() => {
    const firstDay = new Date(year, monthIndex, 1);
    const lastDay  = new Date(year, monthIndex + 1, 0);
    const dow      = firstDay.getDay();
    const offset   = dow === 0 ? 6 : dow - 1;
    const cells: Date[] = [];
    const totalCells = Math.ceil((offset + lastDay.getDate()) / 7) * 7;
    for (let i = 0; i < totalCells; i++) {
      cells.push(new Date(year, monthIndex, 1 - offset + i));
    }
    return cells;
  }, [year, monthIndex]);

  // События сгруппированные по дню (формат YYYY-MM-DD локальной даты)
  const eventsByDay = useMemo(() => {
    const map: Record<string, EventLite[]> = {};
    for (const e of events) {
      const key = toDayKey(new Date(e.startsAt));
      if (!map[key]) map[key] = [];
      map[key].push(e);
    }
    return map;
  }, [events]);

  // Сколько событий в текущем месяце с непоставленной датой подачи
  const eventsWithoutSubmission = useMemo(
    () => events.filter((e) => e.submitted === false).length,
    [events],
  );

  const [createOpen, setCreateOpen]   = useState(false);
  const [createDate, setCreateDate]   = useState<string | null>(null);
  const [detailEvent, setDetailEvent] = useState<EventLite | null>(null);

  function navMonth(delta: number) {
    const newDate = new Date(year, monthIndex + delta, 1);
    const param = `${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}`;
    router.push(`/calendar?month=${param}`);
  }

  function goToday() {
    const param = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    router.push(`/calendar?month=${param}`);
  }

  function openCreate(dayKey: string) {
    setCreateDate(dayKey);
    setCreateOpen(true);
  }

  return (
    <div className="p-4 md:p-5 max-w-[1380px] w-full">
      {/* Шапка с навигацией месяцев */}
      <div className="bg-paper border border-line rounded-lg p-3 mb-3 flex items-center gap-2 flex-wrap">
        <button onClick={() => navMonth(-1)}
          className="w-8 h-8 grid place-items-center rounded-md hover:bg-bg text-ink-3 hover:text-navy transition-colors"
          aria-label="Предыдущий месяц">
          <ChevronLeft size={16} />
        </button>
        <button onClick={() => navMonth(1)}
          className="w-8 h-8 grid place-items-center rounded-md hover:bg-bg text-ink-3 hover:text-navy transition-colors"
          aria-label="Следующий месяц">
          <ChevronRight size={16} />
        </button>
        <Button size="sm" onClick={goToday}>Сегодня</Button>
        <h1 className="text-[17px] font-bold tracking-tight text-navy ml-1">
          {MONTHS[monthIndex]} {year}
        </h1>
        <span className="text-[12px] text-ink-4">
          {events.length} {plural(events.length, 'событие', 'события', 'событий')}
          {eventsWithoutSubmission > 0 && (
            <span className="text-danger font-semibold ml-1.5">
              · {eventsWithoutSubmission} без поданного внеска
            </span>
          )}
        </span>
        <div className="ml-auto">
          <Button variant="primary" onClick={() => openCreate(todayKey)}>
            <Plus size={12} /> Новая встреча
          </Button>
        </div>
      </div>

      {/* Баннер: лиды без даты подачи внеска */}
      {pendingSubmissions.length > 0 && (
        <PendingSubmissionsBanner items={pendingSubmissions} />
      )}

      {/* Сетка календаря */}
      <div className="bg-paper border border-line rounded-lg overflow-hidden">
        {/* Заголовки дней недели */}
        <div className="grid grid-cols-7 border-b border-line bg-bg">
          {WEEKDAYS.map((d, i) => (
            <div key={d} className={cn(
              'px-2 py-2 text-[10.5px] font-bold uppercase tracking-[0.06em] text-center',
              i >= 5 ? 'text-ink-4' : 'text-navy/70',
            )}>{d}</div>
          ))}
        </div>
        {/* Дни */}
        <div className="grid grid-cols-7">
          {gridDays.map((day, idx) => {
            const dayKey = toDayKey(day);
            const inMonth = day.getMonth() === monthIndex;
            const isToday = dayKey === todayKey;
            const isWeekend = day.getDay() === 0 || day.getDay() === 6;
            const dayEvents = eventsByDay[dayKey] || [];
            const visible   = dayEvents.slice(0, 3);
            const overflow  = dayEvents.length - visible.length;
            const isLastCol = (idx + 1) % 7 === 0;

            return (
              <div
                key={idx}
                className={cn(
                  'min-h-[100px] md:min-h-[112px] border-b p-1.5 flex flex-col gap-0.5 transition-colors',
                  !isLastCol && 'border-r border-line',
                  inMonth ? 'bg-paper' : 'bg-bg/40',
                  isToday && 'bg-navy/[0.04]',
                )}
              >
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => openCreate(dayKey)}
                    className={cn(
                      'text-[12px] font-semibold inline-flex items-center justify-center min-w-[20px] h-[20px] rounded-full transition-colors',
                      !inMonth && 'text-ink-5',
                      inMonth && isToday  && 'bg-navy text-white px-1.5 font-bold',
                      inMonth && !isToday && isWeekend  && 'text-ink-4 hover:bg-bg',
                      inMonth && !isToday && !isWeekend && 'text-ink-2 hover:bg-bg',
                    )}
                    title="Создать встречу на этот день"
                  >
                    {day.getDate()}
                  </button>
                  {dayEvents.length === 0 && inMonth && (
                    <button
                      type="button"
                      onClick={() => openCreate(dayKey)}
                      className="opacity-0 hover:opacity-100 group-hover:opacity-100 text-ink-4 hover:text-navy w-5 h-5 grid place-items-center rounded-md"
                      aria-label="Создать встречу"
                    >
                      <Plus size={11} />
                    </button>
                  )}
                </div>
                <div className="flex flex-col gap-0.5 flex-1">
                  {visible.map((e) => {
                    const c = KIND_STYLES[e.kind];
                    const noSubmission = e.submitted === false;
                    return (
                      <button
                        type="button"
                        key={e.id}
                        onClick={() => setDetailEvent(e)}
                        className={cn(
                          'w-full text-left px-1.5 py-px rounded text-[10.5px] font-medium truncate border transition-colors',
                          c.bg, c.text, c.border,
                          'hover:brightness-95',
                          // Подсветка «внесок не подан»: красная пунктирная рамка
                          // поверх обычного стиля + ring чтобы отличалось даже
                          // в одинаковых по типу событиях.
                          noSubmission && 'border-dashed border-danger ring-1 ring-danger/40',
                        )}
                        title={
                          noSubmission
                            ? `⚠ Внесок не подан · ${formatTime(e.startsAt)} ${e.title}`
                            : `${formatTime(e.startsAt)} ${e.title}`
                        }
                      >
                        {noSubmission && (
                          <span className="font-bold text-danger mr-1" aria-hidden>⚠</span>
                        )}
                        <span className="font-mono mr-1 opacity-80">{formatTime(e.startsAt)}</span>
                        {e.title}
                      </button>
                    );
                  })}
                  {overflow > 0 && (
                    <button
                      type="button"
                      onClick={() => setDetailEvent(dayEvents[3] ?? null)}
                      className="text-[10px] text-ink-4 hover:text-navy px-1 text-left"
                    >
                      +{overflow} ещё
                    </button>
                  )}
                  {dayEvents.length === 0 && inMonth && (
                    <button
                      type="button"
                      onClick={() => openCreate(dayKey)}
                      className="flex-1 min-h-[16px] rounded text-[10.5px] text-ink-5 hover:bg-bg/50 hover:text-navy transition-colors"
                    >
                      &nbsp;
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Подсказка снизу */}
      <div className="text-[11.5px] text-ink-4 mt-3 px-1">
        Нажмите на любой день чтобы создать встречу. На событие — чтобы увидеть детали.
        {eventsWithoutSubmission > 0 && (
          <> События с <span className="text-danger font-semibold">красной пунктирной рамкой</span> — клиент без даты подачи внеска.</>
        )}
      </div>

      {/* Модалки */}
      {createOpen && (
        <CreateMeetingModal
          initialDate={createDate}
          team={team}
          leads={leads}
          currentUserId={currentUser.id}
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); router.refresh(); }}
        />
      )}
      {detailEvent && (
        <EventDetailModal
          event={detailEvent}
          currentUserId={currentUser.id}
          isAdmin={currentUser.role === 'ADMIN'}
          onClose={() => setDetailEvent(null)}
          onDeleted={() => { setDetailEvent(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

// ====================== БАННЕР: ЛИДЫ БЕЗ ДАТЫ ПОДАЧИ ======================

/** Сворачиваемый баннер со списком лидов которым нужно поставить
 *  дату подачи внеска. Показывает первые 3, остальные раскрываются по клику.
 *  Anna 30.04.2026 — «волшебная штучка». */
function PendingSubmissionsBanner({ items }: { items: PendingSubmission[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, 3);

  return (
    <div className="bg-danger/[0.04] border border-danger/25 rounded-lg p-3 mb-3">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle size={14} className="text-danger shrink-0" />
        <h2 className="text-[13px] font-bold text-danger uppercase tracking-[0.04em]">
          Без поданного внеска
        </h2>
        <span className="text-[11px] text-danger font-semibold">{items.length}</span>
        <span className="text-[11.5px] text-ink-3 ml-auto">сортировка по дате обращения, старые первыми</span>
      </div>
      <div className="flex flex-col gap-1">
        {visible.map((l) => {
          const days = daysUntil(l.firstContactAt);
          // days отрицательное: первый контакт был в прошлом
          const elapsed = days !== null ? Math.abs(days) : null;
          return (
            <Link
              key={l.id}
              href={`/clients/${l.id}`}
              className="flex items-center gap-3 px-2.5 py-1.5 rounded-md bg-paper border border-danger/15 hover:border-danger/40 hover:bg-paper transition-colors group"
            >
              <span className="text-[10.5px] font-bold text-danger uppercase tracking-[0.05em] shrink-0">⚠</span>
              <div className="flex-1 min-w-0 flex items-baseline gap-2 flex-wrap">
                <span className="text-[12.5px] font-semibold text-ink truncate">{l.clientName}</span>
                <span className="text-[11px] text-ink-4">{l.funnelName}</span>
              </div>
              {l.firstContactAt && (
                <span className="text-[11px] text-ink-3 whitespace-nowrap">
                  {formatDate(l.firstContactAt)}
                  {elapsed !== null && elapsed > 0 && (
                    <span className={cn(
                      'ml-1.5 font-semibold',
                      elapsed > 90 ? 'text-danger' : elapsed > 30 ? 'text-warn' : 'text-ink-3',
                    )}>
                      {elapsed} {plural(elapsed, 'день', 'дня', 'дней')} назад
                    </span>
                  )}
                </span>
              )}
            </Link>
          );
        })}
      </div>
      {items.length > 3 && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-2 inline-flex items-center gap-1 text-[11.5px] text-danger hover:underline font-medium"
        >
          <ChevronDown size={11} className={cn('transition-transform', expanded && 'rotate-180')} />
          {expanded ? 'Свернуть' : `Показать ещё ${items.length - 3}`}
        </button>
      )}
    </div>
  );
}

// ====================== МОДАЛКА: создать встречу ======================

function CreateMeetingModal({
  initialDate, team, leads, currentUserId, onClose, onCreated,
}: {
  initialDate: string | null;
  team: TeamMember[];
  leads: LeadOption[];
  currentUserId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const today = toDayKey(new Date());
  const initial = initialDate || today;

  const [title, setTitle]                 = useState('');
  // Узкий тип — модалка создаёт только эти 3 типа встреч (FINGERPRINT и
  // EXTRA_CALL — отдельные actions внутри карточки лида). Совпадает с zod
  // схемой createCalendarMeeting в calendar/actions.ts.
  const [kind, setKind]                   = useState<MeetingKind>('INTERNAL_MEETING');
  const [date, setDate]                   = useState(initial);
  const [time, setTime]                   = useState('10:00');
  const [duration, setDuration]           = useState(30);
  const [location, setLocation]           = useState('');
  const [description, setDescription]     = useState('');
  const [leadId, setLeadId]               = useState<string>('');
  const [leadSearch, setLeadSearch]       = useState('');
  const [participantIds, setParticipants] = useState<string[]>([]);
  const [busy, setBusy]                   = useState(false);
  const [error, setError]                 = useState<string | null>(null);

  const filteredLeads = useMemo(() => {
    const q = leadSearch.trim().toLowerCase();
    if (!q) return leads.slice(0, 30);
    return leads.filter((l) =>
      l.name.toLowerCase().includes(q) ||
      l.phone.replace(/\D/g, '').includes(q.replace(/\D/g, '')),
    ).slice(0, 30);
  }, [leadSearch, leads]);

  const selectedLead = leadId ? leads.find((l) => l.id === leadId) : null;

  function toggleParticipant(id: string) {
    setParticipants((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  }

  async function save() {
    setError(null);
    if (!title.trim()) { setError('Укажите название'); return; }
    setBusy(true);
    try {
      // Локальная дата+время → ISO. new Date(`YYYY-MM-DDTHH:MM:00`)
      // парсится как локальное время и конвертируется в UTC при toISOString().
      const startsAt = new Date(`${date}T${time}:00`);
      if (isNaN(startsAt.getTime())) {
        setError('Некорректная дата или время');
        setBusy(false);
        return;
      }
      await createCalendarMeeting({
        title:          title.trim(),
        kind,
        startsAt:       startsAt.toISOString(),
        durationMin:    duration,
        location:       location.trim() || undefined,
        description:    description.trim() || undefined,
        leadId:         leadId || undefined,
        participantIds,
      });
      onCreated();
    } catch (e) {
      setError((e as Error).message || 'Ошибка');
      setBusy(false);
    }
  }

  return (
    <Modal open={true} onClose={onClose} title="Новая встреча" size="lg"
      footer={<>
        <Button onClick={onClose}>Отмена</Button>
        <Button variant="primary" onClick={save} disabled={busy || !title.trim()}>
          {busy ? 'Сохранение...' : 'Создать встречу'}
        </Button>
      </>}>
      <div className="flex flex-col gap-3">
        <FormField label="Название" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Встреча с клиентом / Планёрка / ..." autoFocus />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Тип">
            <Select value={kind} onChange={(e) => setKind(e.target.value as MeetingKind)}>
              <option value="INTERNAL_MEETING">Внутренняя встреча</option>
              <option value="CONSULTATION">Консультация с клиентом</option>
              <option value="CUSTOM">Прочее</option>
            </Select>
          </FormField>
          <FormField label="Длительность">
            <Select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              <option value={15}>15 мин</option>
              <option value={30}>30 мин</option>
              <option value={45}>45 мин</option>
              <option value={60}>1 час</option>
              <option value={90}>1.5 часа</option>
              <option value={120}>2 часа</option>
            </Select>
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Дата" required>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </FormField>
          <FormField label="Время" required>
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </FormField>
        </div>
        <FormField label="Место" hint="Адрес офиса, ссылка на Zoom/Meet, и т.п.">
          <Input value={location} onChange={(e) => setLocation(e.target.value)}
            placeholder="Офис / Zoom / Google Meet" />
        </FormField>
        <FormField label="Привязать к клиенту" hint="Опционально — если встреча по конкретному делу">
          {selectedLead ? (
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-navy/[0.04] border border-navy/20 rounded-md text-[12.5px]">
              <Avatar name={selectedLead.name} size="xs" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-navy truncate">{selectedLead.name}</div>
                <div className="text-[10.5px] text-ink-4 font-mono">{selectedLead.phone} · {selectedLead.funnelName}</div>
              </div>
              <button type="button" onClick={() => { setLeadId(''); setLeadSearch(''); }}
                className="text-[11px] text-danger hover:underline">убрать</button>
            </div>
          ) : (
            <>
              <Input value={leadSearch} onChange={(e) => setLeadSearch(e.target.value)}
                placeholder="Поиск по имени или телефону" />
              {leadSearch.trim() && (
                <div className="mt-1.5 max-h-[180px] overflow-y-auto thin-scroll border border-line rounded-md">
                  {filteredLeads.length === 0 ? (
                    <div className="px-3 py-2 text-[12px] text-ink-4">Ничего не найдено</div>
                  ) : filteredLeads.map((l) => (
                    <button key={l.id} type="button"
                      onClick={() => { setLeadId(l.id); setLeadSearch(''); }}
                      className="w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-bg border-b border-line-2 last:border-0">
                      <div className="font-semibold text-ink">{l.name}</div>
                      <div className="text-[10.5px] text-ink-4 font-mono">{l.phone} · {l.funnelName}</div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </FormField>
        <FormField label="Пригласить участников"
          hint={participantIds.length > 0 ? `Будут уведомлены: ${participantIds.length}` : 'Им придёт уведомление'}>
          <div className="flex flex-wrap gap-1.5 max-h-[160px] overflow-y-auto thin-scroll p-1.5 border border-line rounded-md bg-bg/30">
            {team.filter((t) => t.id !== currentUserId).length === 0 ? (
              <div className="text-[12px] text-ink-4 px-1 py-0.5">В команде нет других участников</div>
            ) : team.filter((t) => t.id !== currentUserId).map((m) => {
              const checked = participantIds.includes(m.id);
              return (
                <button key={m.id} type="button" onClick={() => toggleParticipant(m.id)}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[12px] transition-colors',
                    checked
                      ? 'bg-navy text-white border-navy font-semibold'
                      : 'bg-paper text-ink-2 border-line hover:border-navy/40',
                  )}>
                  <Avatar name={m.name} size="xs" variant={checked ? 'navy' : 'light'} />
                  {m.name}
                </button>
              );
            })}
          </div>
        </FormField>
        <FormField label="Описание" hint="Повестка, детали, ссылки">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)}
            rows={2} placeholder="О чём встреча" />
        </FormField>
        {error && (
          <div className="bg-danger-bg border border-danger/20 text-danger text-[12.5px] p-2.5 rounded-md">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ====================== МОДАЛКА: детали события ======================

function EventDetailModal({
  event, currentUserId, isAdmin, onClose, onDeleted,
}: {
  event: EventLite;
  currentUserId: string;
  isAdmin: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const canDelete = isAdmin || event.ownerId === currentUserId;
  const start = new Date(event.startsAt);
  const c = KIND_STYLES[event.kind];
  const noSubmission = event.submitted === false;

  async function onDelete() {
    if (!confirm('Удалить событие?')) return;
    setBusy(true);
    try {
      await deleteCalendarEvent(event.id);
      onDeleted();
    } catch (e) {
      alert((e as Error).message || 'Не удалось удалить');
      setBusy(false);
    }
  }

  return (
    <Modal open={true} onClose={onClose} title={event.title}
      footer={<>
        <Button onClick={onClose}>Закрыть</Button>
        {canDelete && (
          <Button variant="danger" onClick={onDelete} disabled={busy}>
            <Trash2 size={12} /> {busy ? 'Удаление...' : 'Удалить'}
          </Button>
        )}
      </>}>
      <div className="flex flex-col gap-3">
        {/* Предупреждение о неподанном внеске — самое верхнее, чтобы Anna
            сразу видела причину красной рамки. */}
        {noSubmission && event.leadId && (
          <Link
            href={`/clients/${event.leadId}`}
            className="flex items-start gap-2.5 p-2.5 rounded-md bg-danger/[0.06] border border-danger/30 hover:bg-danger/[0.1] transition-colors"
          >
            <AlertTriangle size={14} className="text-danger mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-bold text-danger">Внесок не подан в уженд</div>
              <div className="text-[11.5px] text-ink-2 mt-0.5">
                Откройте карточку клиента → секция «Сделка» → поставьте дату подачи
              </div>
            </div>
          </Link>
        )}
        <div>
          <span className={cn(
            'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border',
            c.bg, c.text, c.border,
          )}>{c.label}</span>
        </div>
        <div>
          <div className="text-[14px] font-bold text-ink">
            {start.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
          <div className="text-[13px] text-ink-3 font-mono mt-0.5">
            {formatTime(event.startsAt)}
            {event.endsAt && ` — ${formatTime(event.endsAt)}`}
          </div>
        </div>
        {event.location && (
          <div className="flex items-start gap-2 text-[12.5px] text-ink-2">
            <MapPin size={13} className="mt-0.5 text-ink-4 shrink-0" />
            <span>{event.location}</span>
          </div>
        )}
        {event.ownerName && (
          <div className="text-[12px] text-ink-3">
            Организатор: <span className="font-semibold text-ink-2">{event.ownerName}</span>
          </div>
        )}
        {event.participants.length > 0 && (
          <div className="flex items-start gap-2">
            <Users size={13} className="mt-1 text-ink-4 shrink-0" />
            <div className="flex flex-wrap gap-1">
              {event.participants.map((p) => (
                <span key={p.id}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-bg border border-line rounded text-[11.5px] text-ink-2">
                  <Avatar name={p.name} size="xs" />
                  {p.name}
                </span>
              ))}
            </div>
          </div>
        )}
        {event.leadId && event.leadClientName && (
          <Link href={`/clients/${event.leadId}`}
            className="text-[12.5px] text-info hover:underline inline-flex items-center gap-1">
            → Карточка клиента: {event.leadClientName}
          </Link>
        )}
        {event.description && (
          <div className="bg-bg/50 border border-line rounded-md p-2.5 text-[12.5px] text-ink-2 whitespace-pre-wrap">
            {event.description}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ====================== МЕЛОЧИ ======================

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
