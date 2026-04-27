// Дни рождения клиентов: предстоящие ДР сгруппированы по периодам
// /clients/birthdays — общий список (видят все роли)

import Link from 'next/link';
import { Topbar } from '@/components/topbar';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { Cake } from 'lucide-react';
import { formatDate, formatPhone } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface UpcomingClient {
  id: string;
  fullName: string;
  phone: string;
  birthDate: Date;
  // День в текущем году (для сортировки и группировки)
  upcomingDate: Date;
  // Полных лет на день рождения
  ageTurning: number;
  // Сколько дней осталось (0 = сегодня, 1 = завтра)
  daysLeft: number;
  // Есть ли лиды (для ссылки)
  leads: Array<{ id: string }>;
}

export default async function BirthdaysPage() {
  await requireUser();

  // Берём всех неархивных клиентов с заполненной датой рождения
  const clients = await db.client.findMany({
    where: {
      isArchived: false,
      birthDate: { not: null },
    },
    select: {
      id: true,
      fullName: true,
      phone: true,
      birthDate: true,
      leads: {
        where: { isArchived: false },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentYear = today.getFullYear();

  // Считаем upcoming для каждого клиента — следующая годовщина с сегодня
  const upcoming: UpcomingClient[] = clients
    .filter((c) => c.birthDate)
    .map((c) => {
      const bd = c.birthDate!;
      // Дата ДР в этом году
      let upcomingDate = new Date(currentYear, bd.getMonth(), bd.getDate());
      upcomingDate.setHours(0, 0, 0, 0);
      // Если в этом году уже прошло — берём следующий
      if (upcomingDate < today) {
        upcomingDate = new Date(currentYear + 1, bd.getMonth(), bd.getDate());
      }
      const daysLeft = Math.round((upcomingDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const ageTurning = upcomingDate.getFullYear() - bd.getFullYear();
      return {
        id: c.id,
        fullName: c.fullName,
        phone: c.phone,
        birthDate: bd,
        upcomingDate,
        ageTurning,
        daysLeft,
        leads: c.leads,
      };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft);

  // Группируем
  const todayList = upcoming.filter((c) => c.daysLeft === 0);
  const thisWeek  = upcoming.filter((c) => c.daysLeft >= 1 && c.daysLeft <= 7);
  const thisMonth = upcoming.filter((c) => c.daysLeft >= 8 && c.daysLeft <= 31);
  const later     = upcoming.filter((c) => c.daysLeft > 31);

  return (
    <>
      <Topbar
        breadcrumbs={[
          { label: 'CRM' },
          { label: 'Клиенты', href: '/clients' },
          { label: 'Дни рождения' },
        ]}
      />

      <div className="p-4 md:p-6 max-w-[900px] mx-auto w-full flex flex-col gap-4">
        <div className="flex items-center gap-3 mb-2">
          <Cake size={22} className="text-gold" />
          <h1 className="text-[18px] font-bold text-ink">Дни рождения клиентов</h1>
          <span className="text-[12px] text-ink-4">{upcoming.length} с указанной датой</span>
        </div>

        <Group title="Сегодня" subtitle="🎉 Поздравьте клиента!" items={todayList} highlight="danger" />
        <Group title="На этой неделе" items={thisWeek} highlight="warn" />
        <Group title="В этом месяце" items={thisMonth} />
        <Group title="Позднее" items={later} muted />

        {upcoming.length === 0 && (
          <div className="bg-paper border border-line rounded-lg p-8 text-center text-[13px] text-ink-4">
            Ни у одного клиента не указана дата рождения.<br />
            Заполните в карточке клиента — и они появятся здесь.
          </div>
        )}
      </div>
    </>
  );
}

function Group({
  title, subtitle, items, highlight, muted,
}: {
  title: string;
  subtitle?: string;
  items: UpcomingClient[];
  highlight?: 'danger' | 'warn';
  muted?: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <div className="bg-paper border border-line rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 border-b border-line flex items-baseline gap-2">
        <h2 className="text-[13px] font-bold text-ink-2 uppercase tracking-[0.04em]">
          {title}
        </h2>
        <span className="text-[11px] text-ink-4">{items.length}</span>
        {subtitle && <span className="text-[11.5px] text-ink-3 ml-2">{subtitle}</span>}
      </div>

      <ul className="divide-y divide-line-2">
        {items.map((c) => {
          const link = c.leads[0]?.id ? `/clients/${c.leads[0].id}` : null;
          const RowWrap = link ? Link : 'div';
          return (
            <RowWrap
              key={c.id}
              {...(link ? { href: link } : {})}
              className={`flex items-center gap-3 px-4 py-3 ${link ? 'hover:bg-bg cursor-pointer transition-colors' : ''} ${muted ? 'opacity-70' : ''}`}
            >
              {/* Дата */}
              <div className={`text-center min-w-[44px] ${
                highlight === 'danger' ? 'text-danger' :
                highlight === 'warn' ? 'text-warn' :
                'text-ink-2'
              }`}>
                <div className="text-[18px] font-bold leading-none">
                  {c.upcomingDate.getDate()}
                </div>
                <div className="text-[10px] uppercase tracking-[0.05em] font-semibold mt-0.5">
                  {c.upcomingDate.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '')}
                </div>
              </div>

              {/* Имя + детали */}
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-semibold text-ink truncate">{c.fullName}</div>
                <div className="text-[11.5px] text-ink-3 mt-0.5 flex flex-wrap gap-x-3">
                  <span className="font-mono">{formatPhone(c.phone)}</span>
                  <span>исполнится <strong>{c.ageTurning}</strong></span>
                  <span>род. {formatDate(c.birthDate.toISOString())}</span>
                </div>
              </div>

              {/* Дней осталось */}
              <div className={`text-right text-[12px] whitespace-nowrap ${
                highlight === 'danger' ? 'text-danger font-bold' :
                highlight === 'warn' ? 'text-warn font-semibold' :
                'text-ink-3'
              }`}>
                {c.daysLeft === 0 ? 'сегодня' :
                 c.daysLeft === 1 ? 'завтра' :
                 `через ${c.daysLeft} дн.`}
              </div>
            </RowWrap>
          );
        })}
      </ul>
    </div>
  );
}
