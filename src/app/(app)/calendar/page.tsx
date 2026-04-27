// Календарь — список ближайших и прошедших событий
import Link from 'next/link';
import { Topbar } from '@/components/topbar';
import { Badge } from '@/components/ui/badge';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { formatDate, formatTime, daysUntil } from '@/lib/utils';
import { Calendar as CalendarIcon, MapPin } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function CalendarPage() {
  const user = await requireUser();

  // Менеджер видит только свои события + общие (без owner)
  const where = user.role === 'ADMIN'
    ? {}
    : {
        OR: [
          { ownerId: user.id },
          { ownerId: null },
          { participants: { some: { userId: user.id } } },
        ],
      };

  const now = new Date();

  const [upcoming, past] = await Promise.all([
    db.calendarEvent.findMany({
      where: { ...where, startsAt: { gte: now } },
      orderBy: { startsAt: 'asc' },
      take: 50,
      include: {
        lead: {
          select: {
            id: true,
            client: { select: { fullName: true } },
            funnel: { select: { name: true } },
          },
        },
        owner: { select: { name: true } },
      },
    }),
    db.calendarEvent.findMany({
      where: { ...where, startsAt: { lt: now } },
      orderBy: { startsAt: 'desc' },
      take: 20,
      include: {
        lead: {
          select: {
            id: true,
            client: { select: { fullName: true } },
            funnel: { select: { name: true } },
          },
        },
        owner: { select: { name: true } },
      },
    }),
  ]);

  // Группируем upcoming по датам
  const grouped: Record<string, EventLite[]> = {};
  for (const item of upcoming) {
    const key = item.startsAt.toISOString().slice(0, 10);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(item as unknown as EventLite);
  }

  return (
    <>
      <Topbar breadcrumbs={[{ label: 'CRM' }, { label: 'Календарь' }]} />

      <div className="p-4 md:p-5 max-w-[920px] w-full">
        {/* Будущие */}
        <div className="bg-paper border border-line rounded-lg p-4 md:p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[15px] font-bold tracking-tight">Ближайшие события</h2>
            <span className="text-[12px] text-ink-3">{upcoming.length}</span>
          </div>

          {Object.keys(grouped).length === 0 ? (
            <div className="text-center py-8 text-[13px] text-ink-4">
              <CalendarIcon size={32} className="mx-auto mb-2 text-ink-5" />
              На ближайшее время событий нет
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {Object.entries(grouped).map(([dayKey, items]) => {
                const date = new Date(items[0].startsAt);
                const days = daysUntil(date);
                const dayLabel = days === 0 ? 'Сегодня' : days === 1 ? 'Завтра' : formatDate(date);

                return (
                  <div key={dayKey}>
                    <div className="flex items-baseline gap-2 mb-2 pb-1 border-b border-line">
                      <h3 className="text-[12px] font-bold uppercase tracking-[0.06em] text-ink-2">
                        {dayLabel}
                      </h3>
                      <span className="text-[11px] text-ink-4">
                        {date.toLocaleDateString('ru-RU', { weekday: 'long' })}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {items.map((e) => <EventRow key={e.id} event={e} />)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Прошедшие */}
        {past.length > 0 && (
          <div className="bg-paper border border-line rounded-lg p-4 md:p-5">
            <h2 className="text-[15px] font-bold tracking-tight mb-3">Прошедшие</h2>
            <div className="flex flex-col gap-1.5">
              {past.map((e) => <EventRow key={e.id} event={e} past />)}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

type EventLite = {
  id: string;
  title: string;
  startsAt: Date;
  location: string | null;
  kind: string;
  lead: {
    id: string;
    client: { fullName: string };
    funnel: { name: string };
  } | null;
  owner: { name: string } | null;
};

function EventRow({ event, past }: { event: EventLite; past?: boolean }) {
  const accent = ({
    FINGERPRINT:      'border-l-warn',
    EXTRA_CALL:       'border-l-danger',
    CONSULTATION:     'border-l-success',
    INTERNAL_MEETING: 'border-l-navy',
    CUSTOM:           'border-l-info',
  } as Record<string, string>)[event.kind] ?? 'border-l-info';

  const kindLabel = ({
    FINGERPRINT:      'Отпечатки',
    EXTRA_CALL:       'Доп. вызвание',
    CONSULTATION:     'Консультация',
    INTERNAL_MEETING: 'Встреча',
    CUSTOM:           'Событие',
  } as Record<string, string>)[event.kind] ?? 'Событие';

  const Wrapper = event.lead
    ? ({ children }: { children: React.ReactNode }) => (
        <Link href={`/clients/${event.lead!.id}`} className="block">{children}</Link>
      )
    : ({ children }: { children: React.ReactNode }) => <>{children}</>;

  return (
    <Wrapper>
      <div className={`flex items-center gap-3 p-3 rounded-md border bg-paper border-l-2 ${accent} border-y-line border-r-line ${past ? 'opacity-60' : 'hover:bg-bg'} transition-colors`}>
        <div className="text-center min-w-[44px]">
          <div className="text-[18px] font-bold tracking-tight font-mono text-ink leading-none">
            {formatTime(event.startsAt)}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[13px] font-semibold text-ink">{event.title}</span>
            <Badge variant="default">{kindLabel}</Badge>
          </div>
          <div className="text-[11.5px] text-ink-3 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
            {event.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin size={10} /> {event.location}
              </span>
            )}
            {event.owner && <span>{event.owner.name}</span>}
            {event.lead && (
              <span>{event.lead.funnel.name} · {event.lead.client.fullName}</span>
            )}
          </div>
        </div>
      </div>
    </Wrapper>
  );
}
