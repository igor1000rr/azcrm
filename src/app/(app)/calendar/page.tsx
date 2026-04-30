// Календарь — сетка месяца со всеми событиями (отпечатки, доп. вызвания,
// внутренние встречи, консультации, пр.). Клик по дню → создание встречи.
//
// Видимость событий (Igor 30.04.2026):
//   ВСЕ пользователи видят ВСЕ события компании. Это рабочий календарь —
//   важно чтобы менеджеры видели когда у коллег встречи, какие отпечатки
//   запланированы и т.д. Раньше SALES/LEGAL видели только свои + общие +
//   куда приглашены — Igor попросил открыть для всех.
//
//   Имя клиента в title видно всем (например «Подача на КП: Иванов»). Если
//   SALES попробует открыть карточку клиента LEGAL'а — там сработает
//   leadVisibilityFilter и вернёт 403. Сами события открыты.
//
// Список лидов для привязки к встрече — только видимые юзеру (leadVisibilityFilter):
// SALES не должен видеть клиентов LEGAL в селекторе — это утечка ПДн.
//
// Резолвинг участников:
//   У CalendarEventParticipant в schema.prisma НЕТ Prisma-relation на User
//   (только колонка userId). Поэтому include: { user: ... } падает в рантайме
//   с PrismaValidationError. Загружаем юзеров отдельным запросом и матчим
//   по userId через Map.
//
// Pending submissions (Anna 30.04.2026):
//   Загружаем список лидов где submittedAt = null И есть firstContactAt.
//   Передаём в CalendarMonthView для предупреждающего баннера сверху.
//   Также обогащаем events флагом submitted (через computeSubmissionStatus) —
//   для подсветки на сетке.

import { Topbar } from '@/components/topbar';
import { CalendarMonthView } from './calendar-view';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { leadVisibilityFilter } from '@/lib/permissions';
import { computeSubmissionStatus } from '@/lib/calendar-helpers';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    month?: string; // формат YYYY-MM
  }>;
}

export default async function CalendarPage({ searchParams }: PageProps) {
  const user = await requireUser();
  const { month } = await searchParams;

  // Парсим параметр месяца, default = текущий
  const today = new Date();
  let year = today.getFullYear();
  let monthIndex = today.getMonth();
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split('-').map(Number);
    if (m >= 1 && m <= 12) {
      year = y;
      monthIndex = m - 1;
    }
  }

  // Сетка с захватом смежных дней (от понедельника до воскресенья)
  const monthStart = new Date(year, monthIndex, 1);
  const monthEnd   = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);

  const dowFirst   = monthStart.getDay();           // 0=вс, 1=пн, ...
  const offsetStart = dowFirst === 0 ? 6 : dowFirst - 1;
  const gridStart  = new Date(year, monthIndex, 1 - offsetStart, 0, 0, 0, 0);

  const dowLast    = monthEnd.getDay();
  const offsetEnd  = dowLast === 0 ? 0 : 7 - dowLast;
  const gridEnd    = new Date(year, monthIndex + 1, offsetEnd, 23, 59, 59, 999);

  // Видимость лидов в селекторе «Привязать к клиенту» — только свои (SALES не
  // должен видеть клиентов LEGAL и наоборот). Админ — видит все.
  const leadVis = leadVisibilityFilter(user);

  // События календаря — без фильтра по ownerId/participants.
  // Все сотрудники видят расписание всей команды.
  const [events, team, leads, pendingLeads] = await Promise.all([
    db.calendarEvent.findMany({
      where: { startsAt: { gte: gridStart, lte: gridEnd } },
      orderBy: { startsAt: 'asc' },
      include: {
        lead: {
          select: {
            id: true,
            submittedAt: true,
            client: { select: { fullName: true } },
          },
        },
        owner: { select: { id: true, name: true } },
        participants: { select: { userId: true } },
      },
    }),
    db.user.findMany({
      where:   { isActive: true },
      select:  { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    }),
    db.lead.findMany({
      where: { ...leadVis, isArchived: false },
      select: {
        id: true,
        client: { select: { fullName: true, phone: true } },
        funnel: { select: { name: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    }),
    db.lead.findMany({
      where: {
        ...leadVis,
        isArchived:     false,
        submittedAt:    null,
        firstContactAt: { not: null },
      },
      select: {
        id:             true,
        firstContactAt: true,
        client:         { select: { fullName: true } },
        funnel:         { select: { name: true } },
      },
      orderBy: { firstContactAt: 'asc' },
      take: 100,
    }),
  ]);

  // Резолвим имена участников. Большинство — активные сотрудники (есть в team),
  // но если юзера деактивировали после создания встречи — его в team нет.
  // Поэтому загружаем по полному списку userId одним запросом (включая неактивных).
  const participantUserIds = [
    ...new Set(events.flatMap((e) => e.participants.map((p) => p.userId))),
  ];

  let participantUsers: { id: string; name: string }[] = [];
  if (participantUserIds.length > 0) {
    participantUsers = await db.user.findMany({
      where:  { id: { in: participantUserIds } },
      select: { id: true, name: true },
    });
  }
  const userById = new Map(participantUsers.map((u) => [u.id, u]));

  return (
    <>
      <Topbar breadcrumbs={[{ label: 'CRM' }, { label: 'Календарь' }]} />
      <CalendarMonthView
        currentUser={{ id: user.id, name: user.name, role: user.role }}
        year={year}
        monthIndex={monthIndex}
        events={events.map((e) => ({
          id:             e.id,
          title:          e.title,
          startsAt:       e.startsAt.toISOString(),
          endsAt:         e.endsAt?.toISOString() ?? null,
          kind:           e.kind,
          location:       e.location,
          description:    e.description,
          ownerId:        e.ownerId,
          ownerName:      e.owner?.name ?? null,
          leadId:         e.leadId,
          leadClientName: e.lead?.client.fullName ?? null,
          submitted:      computeSubmissionStatus(e.lead),
          participants:   e.participants
            .map((p) => userById.get(p.userId))
            .filter((u): u is { id: string; name: string } => Boolean(u)),
        }))}
        team={team}
        leads={leads.map((l) => ({
          id:         l.id,
          name:       l.client.fullName,
          phone:      l.client.phone,
          funnelName: l.funnel.name,
        }))}
        pendingSubmissions={pendingLeads.map((l) => ({
          id:             l.id,
          clientName:     l.client.fullName,
          funnelName:     l.funnel.name,
          firstContactAt: l.firstContactAt?.toISOString() ?? null,
        }))}
      />
    </>
  );
}
