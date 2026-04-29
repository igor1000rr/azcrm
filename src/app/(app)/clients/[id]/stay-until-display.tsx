// Pure-компонент «Действует до» с подсветкой по близости срока.
// Применяется для legalStayUntil (Anna 29.04.2026 «легальный побыт»).
//
// Диапазоны:
//   days < 0  → «истёк N дней назад» (danger, line-through на дате)
//   days === 0 → «(сегодня)» (danger)
//   1–30 дней → warn «через N дней»
//   31–90 → info
//   > 90 → плейновый вид (дата без выделения)

import { formatDate, daysUntil, plural } from '@/lib/utils';

export function StayUntilDisplay({ until }: { until: string | null }) {
  if (!until) return null;
  const days = daysUntil(until);
  const dateStr = formatDate(until);
  if (days === null) return <>{dateStr}</>;
  if (days < 0) {
    return (
      <span>
        <span className="line-through text-ink-4">{dateStr}</span>{' '}
        <span className="text-danger font-semibold">
          истёк {Math.abs(days)} {plural(Math.abs(days), 'день', 'дня', 'дней')} назад
        </span>
      </span>
    );
  }
  if (days === 0) return <span className="text-danger font-semibold">{dateStr} (сегодня)</span>;
  if (days <= 30) return (
    <span>
      {dateStr} <span className="text-warn font-semibold">через {days} {plural(days, 'день', 'дня', 'дней')}</span>
    </span>
  );
  if (days <= 90) return (
    <span>
      {dateStr} <span className="text-info">через {days} {plural(days, 'день', 'дня', 'дней')}</span>
    </span>
  );
  return <>{dateStr}</>;
}
