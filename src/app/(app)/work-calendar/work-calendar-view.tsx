'use client';

// Месячный календарь с возможностью кликнуть по дню и проставить часы.
import { useState, useTransition } from 'react';
import { ChevronLeft, ChevronRight, Save, Trash2, X } from 'lucide-react';
import { upsertWorkLog, deleteWorkLog } from './actions';
import type { UserRole } from '@prisma/client';

interface Log {
  date: string;       // YYYY-MM-DD
  startTime: string;  // "09:00"
  endTime: string;    // "18:00"
  hours: number;
  notes: string | null;
}

interface Props {
  year: number;
  month: number; // 0..11
  targetUser: { id: string; name: string; role: UserRole } | null;
  canPickUser: boolean;
  allUsers: Array<{ id: string; name: string; role: UserRole }>;
  canEdit: boolean;
  logs: Log[];
  totals: { totalHours: number; workDays: number };
}

const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

// Дефолт рабочего времени в офисе AZ Group (Анна: «у нас рабочее время с 8 до 16»)
const DEFAULT_START = '08:00';
const DEFAULT_END   = '16:00';

export function WorkCalendarView({ year, month, targetUser, canPickUser, allUsers, canEdit, logs, totals }: Props) {
  const [editing, setEditing] = useState<string | null>(null);

  const logByDate = new Map(logs.map((l) => [l.date, l]));

  // Сетка месяца: 6 недель × 7 дней
  const firstOfMonth = new Date(year, month, 1);
  const dayOfWeek = (firstOfMonth.getDay() + 6) % 7; // 0 = пн
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<{ date: string; day: number; inMonth: boolean; isToday: boolean }> = [];

  // Дни предыдущего месяца
  const prevMonthDays = new Date(year, month, 0).getDate();
  for (let i = dayOfWeek - 1; i >= 0; i--) {
    const d = new Date(year, month - 1, prevMonthDays - i);
    cells.push({ date: dateToStr(d), day: d.getDate(), inMonth: false, isToday: false });
  }
  // Дни этого месяца
  const today = new Date();
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(year, month, d);
    const isToday = dt.toDateString() === today.toDateString();
    cells.push({ date: dateToStr(dt), day: d, inMonth: true, isToday });
  }
  // Дополнить до 42 ячеек
  while (cells.length < 42) {
    const last = new Date(cells[cells.length - 1].date);
    last.setDate(last.getDate() + 1);
    cells.push({ date: dateToStr(last), day: last.getDate(), inMonth: false, isToday: false });
  }

  const prevMonth = month === 0 ? { y: year - 1, m: 12 } : { y: year, m: month };
  const nextMonth = month === 11 ? { y: year + 1, m: 1 } : { y: year, m: month + 2 };
  const userQS = targetUser ? `&user=${targetUser.id}` : '';

  return (
    <div className="p-4 md:p-5 max-w-[1200px] w-full">
      {/* Шапка с навигацией и выбором сотрудника */}
      <div className="bg-paper border border-line rounded-lg p-3 mb-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <a href={`/work-calendar?year=${prevMonth.y}&month=${prevMonth.m}${userQS}`}
            className="p-1.5 border border-line rounded hover:bg-bg" aria-label="Предыдущий">
            <ChevronLeft size={16} />
          </a>
          <div className="text-[16px] font-bold text-ink">
            {MONTH_NAMES[month]} {year}
          </div>
          <a href={`/work-calendar?year=${nextMonth.y}&month=${nextMonth.m}${userQS}`}
            className="p-1.5 border border-line rounded hover:bg-bg" aria-label="Следующий">
            <ChevronRight size={16} />
          </a>
        </div>

        {canPickUser && (
          <form method="GET" className="flex items-center gap-2">
            <input type="hidden" name="year" value={year} />
            <input type="hidden" name="month" value={month + 1} />
            <select name="user" defaultValue={targetUser?.id ?? ''} onChange={(e) => e.currentTarget.form?.submit()}
              className="text-[12.5px] border border-line rounded px-2 py-1.5 bg-paper">
              {allUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.role === 'SALES' ? 'продажи' : u.role === 'LEGAL' ? 'легализация' : 'админ'})
                </option>
              ))}
            </select>
          </form>
        )}

        <div className="flex items-center gap-4 text-[12px]">
          <div>
            <span className="text-ink-3">Дней:</span>{' '}
            <strong className="text-ink">{totals.workDays}</strong>
          </div>
          <div>
            <span className="text-ink-3">Часов:</span>{' '}
            <strong className="text-success font-mono">{totals.totalHours.toFixed(1)}</strong>
          </div>
        </div>
      </div>

      {/* Сетка календаря */}
      <div className="bg-paper border border-line rounded-lg overflow-hidden">
        <div className="grid grid-cols-7 border-b border-line bg-bg">
          {WEEKDAYS.map((w, i) => (
            <div key={w} className={`px-3 py-2 text-[10.5px] uppercase tracking-[0.05em] font-semibold text-center ${i >= 5 ? 'text-danger/70' : 'text-ink-4'}`}>
              {w}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {cells.map((cell, i) => {
            const log = logByDate.get(cell.date);
            const isWeekend = i % 7 >= 5;
            return (
              <button
                key={cell.date + '-' + i}
                disabled={!canEdit || !cell.inMonth}
                onClick={() => setEditing(cell.date)}
                className={`relative min-h-[80px] border-r border-b border-line-2 p-2 text-left flex flex-col gap-1 ${
                  !cell.inMonth ? 'bg-bg/40 text-ink-4' : 'hover:bg-bg cursor-pointer'
                } ${cell.isToday ? 'ring-2 ring-navy/50 ring-inset' : ''} ${(i + 1) % 7 === 0 ? 'border-r-0' : ''}`}
              >
                <div className={`text-[11px] font-semibold ${isWeekend && cell.inMonth ? 'text-danger' : ''}`}>
                  {cell.day}
                </div>
                {log && (
                  <div className="bg-success/15 text-success rounded px-1.5 py-0.5 text-[10.5px] font-mono leading-tight">
                    {log.startTime}–{log.endTime}
                    <div className="font-bold">{log.hours.toFixed(1)} ч</div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Модалка редактирования */}
      {editing && canEdit && (
        <DayEditor
          date={editing}
          existing={logByDate.get(editing) ?? null}
          targetUserId={targetUser?.id ?? null}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function DayEditor({ date, existing, targetUserId, onClose }: {
  date: string;
  existing: Log | null;
  targetUserId: string | null;
  onClose: () => void;
}) {
  const [start, setStart] = useState(existing?.startTime ?? DEFAULT_START);
  const [end, setEnd] = useState(existing?.endTime ?? DEFAULT_END);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [pending, startTransition] = useTransition();

  const save = () => {
    startTransition(async () => {
      try {
        await upsertWorkLog({
          userId: targetUserId ?? undefined,
          date, startTime: start, endTime: end, notes,
        });
        onClose();
        location.reload();
      } catch (e) {
        alert(e instanceof Error ? e.message : 'Ошибка');
      }
    });
  };

  const remove = () => {
    if (!confirm('Удалить запись?')) return;
    startTransition(async () => {
      await deleteWorkLog(date, targetUserId ?? undefined);
      onClose();
      location.reload();
    });
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-[100] grid place-items-center p-4" onClick={onClose}>
      <div className="bg-paper rounded-lg shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-line flex items-center justify-between">
          <h3 className="font-bold text-ink text-[14px]">
            {new Date(date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'long' })}
          </h3>
          <button onClick={onClose} className="p-1.5 text-ink-3 hover:text-ink">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Начало">
              <input type="time" value={start} onChange={(e) => setStart(e.target.value)}
                className="w-full text-[14px] border border-line rounded px-2 py-1.5 bg-paper font-mono" />
            </Field>
            <Field label="Конец">
              <input type="time" value={end} onChange={(e) => setEnd(e.target.value)}
                className="w-full text-[14px] border border-line rounded px-2 py-1.5 bg-paper font-mono" />
            </Field>
          </div>
          <Field label="Заметка (опц.)">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full text-[12.5px] border border-line rounded px-2 py-1.5 bg-paper" />
          </Field>
        </div>

        <div className="px-4 py-3 border-t border-line flex justify-between">
          {existing ? (
            <button onClick={remove} disabled={pending}
              className="px-3 py-1.5 text-[12px] text-danger border border-danger rounded hover:bg-danger hover:text-white disabled:opacity-50 inline-flex items-center gap-1.5">
              <Trash2 size={13} /> Удалить
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-[12px] text-ink-3 border border-line rounded hover:bg-bg">
              Отмена
            </button>
            <button onClick={save} disabled={pending}
              className="px-3 py-1.5 text-[12px] font-semibold bg-navy text-white rounded inline-flex items-center gap-1.5 disabled:opacity-50">
              <Save size={13} /> Сохранить
            </button>
          </div>
        </div>
      </div>
    </div>
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

function dateToStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}
