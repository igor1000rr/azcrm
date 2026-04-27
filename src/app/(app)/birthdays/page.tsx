// Дни рождения клиентов — список с группировкой по ближайшим датам.
// Помогает Анне поздравлять и поддерживать связь с клиентами.

import Link from 'next/link';
import { Topbar } from '@/components/topbar';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { Cake, Phone } from 'lucide-react';
import { formatPhone } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ month?: string }>;
}

const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

interface ClientWithBirthday {
  id: string;
  fullName: string;
  phone: string;
  birthDate: Date;
  // Связанный лид для перехода в карточку (последний)
  latestLeadId: string | null;
}

export default async function BirthdaysPage({ searchParams }: PageProps) {
  await requireUser();
  const params = await searchParams;
  const filterMonth = params.month ? Number(params.month) : null; // 1..12 или null

  // Все клиенты у которых указан день рождения
  const rawClients = await db.client.findMany({
    where: {
      birthDate: { not: null },
      isArchived: false,
    },
    select: {
      id: true,
      fullName: true,
      phone: true,
      birthDate: true,
      leads: {
        select: { id: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  const clients: ClientWithBirthday[] = rawClients
    .filter((c): c is typeof c & { birthDate: Date } => c.birthDate !== null)
    .map((c) => ({
      id: c.id,
      fullName: c.fullName,
      phone: c.phone,
      birthDate: c.birthDate,
      latestLeadId: c.leads[0]?.id ?? null,
    }));

  // Применяем фильтр по месяцу
  const filtered = filterMonth
    ? clients.filter((c) => c.birthDate.getMonth() + 1 === filterMonth)
    : clients;

  // Группировка по ближайшим
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const todayBirthdays:    ClientWithBirthday[] = [];
  const thisWeek:          ClientWithBirthday[] = [];
  const thisMonth:         ClientWithBirthday[] = [];
  const byMonth: Map<number, ClientWithBirthday[]> = new Map();

  for (const c of filtered) {
    const birth = c.birthDate;
    const isToday =
      birth.getDate() === today.getDate() &&
      birth.getMonth() === today.getMonth();

    if (isToday) {
      todayBirthdays.push(c);
      continue;
    }

    if (!filterMonth) {
      // Сравниваем с ближайшим ДР в текущем году
      const nextBirth = nextBirthday(birth, today);
      const daysDiff = Math.round(
        (nextBirth.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
      );
      if (daysDiff > 0 && daysDiff <= 7) {
        thisWeek.push(c);
        continue;
      }
      if (daysDiff > 7 && nextBirth.getMonth() === today.getMonth()) {
        thisMonth.push(c);
        continue;
      }
    }

    // Раскладываем по месяцам
    const m = birth.getMonth();
    const arr = byMonth.get(m) ?? [];
    arr.push(c);
    byMonth.set(m, arr);
  }

  // Сортируем внутри групп по дате (без года)
  const sortByMonthDay = (a: ClientWithBirthday, b: ClientWithBirthday) => {
    const am = a.birthDate.getMonth();
    const bm = b.birthDate.getMonth();
    if (am !== bm) return am - bm;
    return a.birthDate.getDate() - b.birthDate.getDate();
  };
  thisWeek.sort(sortByMonthDay);
  thisMonth.sort(sortByMonthDay);
  for (const arr of byMonth.values()) {
    arr.sort((a, b) => a.birthDate.getDate() - b.birthDate.getDate());
  }

  // Месяцы по порядку, начиная с текущего
  const orderedMonths: number[] = [];
  if (!filterMonth) {
    for (let i = 0; i < 12; i++) {
      const m = (today.getMonth() + i) % 12;
      if (byMonth.has(m)) orderedMonths.push(m);
    }
  } else {
    if (byMonth.has(filterMonth - 1)) orderedMonths.push(filterMonth - 1);
  }

  const totalCount = filtered.length;

  return (
    <>
      <Topbar breadcrumbs={[{ label: 'CRM' }, { label: 'Дни рождения клиентов' }]} />

      <div className="p-4 md:p-5 max-w-[1200px] w-full mx-auto">
        {/* Шапка с фильтром */}
        <div className="bg-paper border border-line rounded-lg p-4 mb-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Cake size={18} className="text-gold" />
            <h1 className="text-[16px] font-bold text-ink">Дни рождения клиентов</h1>
            <span className="text-[11px] text-ink-3 ml-2">
              {totalCount} {plural(totalCount, 'клиент', 'клиента', 'клиентов')}
            </span>
          </div>

          <form method="GET" className="flex items-center gap-2">
            <select
              name="month"
              defaultValue={filterMonth ?? ''}
              onChange={(e) => e.currentTarget.form?.submit()}
              className="text-[12.5px] border border-line rounded px-2 py-1.5 bg-paper"
            >
              <option value="">Все месяцы (по порядку)</option>
              {MONTH_NAMES.map((name, i) => (
                <option key={i} value={i + 1}>{name}</option>
              ))}
            </select>
          </form>
        </div>

        {totalCount === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex flex-col gap-4">
            {/* Сегодня */}
            {todayBirthdays.length > 0 && (
              <Group title="🎂 Сегодня" tone="gold" clients={todayBirthdays} />
            )}

            {/* На этой неделе */}
            {thisWeek.length > 0 && (
              <Group title="На этой неделе" tone="warn" clients={thisWeek} />
            )}

            {/* В этом месяце (после недели) */}
            {thisMonth.length > 0 && (
              <Group title="В этом месяце" tone="info" clients={thisMonth} />
            )}

            {/* По месяцам */}
            {orderedMonths.map((m) => (
              <Group
                key={m}
                title={MONTH_NAMES[m]}
                tone="default"
                clients={byMonth.get(m) ?? []}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function Group({
  title, tone, clients,
}: {
  title: string;
  tone: 'gold' | 'warn' | 'info' | 'default';
  clients: ClientWithBirthday[];
}) {
  const headerCls = {
    gold:    'bg-gold-pale text-gold border-gold/30',
    warn:    'bg-warn-bg text-warn border-warn/20',
    info:    'bg-info-bg text-info border-info/20',
    default: 'bg-bg text-ink-2 border-line',
  }[tone];

  return (
    <div className="bg-paper border border-line rounded-lg overflow-hidden">
      <div className={`px-4 py-2.5 border-b ${headerCls} flex items-center justify-between`}>
        <h3 className="text-[12.5px] font-bold uppercase tracking-[0.05em]">
          {title}
        </h3>
        <span className="text-[11px] font-semibold opacity-80">
          {clients.length}
        </span>
      </div>
      <div className="divide-y divide-line-2">
        {clients.map((c) => <Row key={c.id} client={c} />)}
      </div>
    </div>
  );
}

function Row({ client }: { client: ClientWithBirthday }) {
  const dateStr = client.birthDate.toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'long',
  });
  const ageWillBe = new Date().getFullYear() - client.birthDate.getFullYear();
  const initials = client.fullName
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0])
    .join('')
    .toUpperCase();

  // /clients принимает параметр `q`, не `search`
  const href = client.latestLeadId
    ? `/clients/${client.latestLeadId}`
    : `/clients?q=${encodeURIComponent(client.phone)}`;

  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg transition-colors"
    >
      <div className="w-8 h-8 rounded-full bg-bg text-ink-2 grid place-items-center text-[11px] font-bold shrink-0">
        {initials || '?'}
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-ink truncate">
          {client.fullName}
        </div>
        <div className="text-[11px] text-ink-4 mt-0.5 flex items-center gap-3">
          <span className="font-mono">
            <Phone size={10} className="inline mr-1" />
            {formatPhone(client.phone)}
          </span>
        </div>
      </div>

      <div className="text-right shrink-0">
        <div className="text-[12.5px] font-semibold text-ink font-mono">
          {dateStr}
        </div>
        <div className="text-[10.5px] text-ink-4">
          исполнится {ageWillBe} {plural(ageWillBe, 'год', 'года', 'лет')}
        </div>
      </div>
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="bg-paper border border-line rounded-lg p-8 text-center">
      <Cake size={32} className="mx-auto text-ink-5 mb-2" />
      <div className="text-[14px] font-semibold text-ink mb-1">
        Нет клиентов с указанным днём рождения
      </div>
      <div className="text-[12px] text-ink-3">
        Добавьте дату рождения в карточке клиента — она появится здесь.
      </div>
    </div>
  );
}

// Ближайший ДР относительно today (этот год или следующий)
function nextBirthday(birth: Date, from: Date): Date {
  const candidate = new Date(from.getFullYear(), birth.getMonth(), birth.getDate());
  if (candidate < from) {
    candidate.setFullYear(from.getFullYear() + 1);
  }
  return candidate;
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
