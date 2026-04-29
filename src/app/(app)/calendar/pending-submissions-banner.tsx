'use client';

// Сворачиваемый баннер с лидами без даты подачи внеска — сверху календаря.
// Anna 30.04.2026 «волшебная штучка». Показывает первые 3, остальные — по клику.
//
// Пустой массив → возвращает null (самозащита, хотя родитель тоже проверяет length).
// Сортировка и фильтры — на сервере (calendar/page.tsx). Клиент только рендерит.
//
// Подсветка срока (по дням с первого контакта):
//   > 90 → danger (давно висит — пора подавать)
//   > 30 → warn  (пора обратить внимание)
//   ≤ 30 → ink-3 (в пределах нормы)

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronDown } from 'lucide-react';
import { cn, formatDate, daysUntil, plural } from '@/lib/utils';

export interface PendingSubmission {
  id:             string;
  clientName:     string;
  funnelName:     string;
  firstContactAt: string | null;
}

export function PendingSubmissionsBanner({ items }: { items: PendingSubmission[] }) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;
  const visible = expanded ? items : items.slice(0, 3);

  return (
    <div
      className="bg-danger/[0.04] border border-danger/25 rounded-lg p-3 mb-3"
      data-testid="pending-submissions-banner"
    >
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
          // days отрицательное: первый контакт в прошлом
          const elapsed = days !== null ? Math.abs(days) : null;
          return (
            <Link
              key={l.id}
              href={`/clients/${l.id}`}
              className="flex items-center gap-3 px-2.5 py-1.5 rounded-md bg-paper border border-danger/15 hover:border-danger/40 hover:bg-paper transition-colors group"
              data-testid="pending-submission-row"
            >
              <span className="text-[10.5px] font-bold text-danger uppercase tracking-[0.05em] shrink-0" aria-hidden>⚠</span>
              <div className="flex-1 min-w-0 flex items-baseline gap-2 flex-wrap">
                <span className="text-[12.5px] font-semibold text-ink truncate">{l.clientName}</span>
                <span className="text-[11px] text-ink-4">{l.funnelName}</span>
              </div>
              {l.firstContactAt && (
                <span className="text-[11px] text-ink-3 whitespace-nowrap">
                  {formatDate(l.firstContactAt)}
                  {elapsed !== null && elapsed > 0 && (
                    <span
                      data-testid="elapsed"
                      className={cn(
                        'ml-1.5 font-semibold',
                        elapsed > 90 ? 'text-danger' : elapsed > 30 ? 'text-warn' : 'text-ink-3',
                      )}
                    >
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
