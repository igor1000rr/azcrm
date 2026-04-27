// Список клиентов с поиском и пагинацией
import Link from 'next/link';
import { Topbar } from '@/components/topbar';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { clientVisibilityFilter } from '@/lib/permissions';
import { formatPhone, formatDate, formatMoney } from '@/lib/utils';
import { Search, Plus } from 'lucide-react';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    q?:    string;
    page?: string;
  }>;
}

const PAGE_SIZE = 50;

export default async function ClientsPage({ searchParams }: PageProps) {
  const user = await requireUser();
  const params = await searchParams;
  const q = params.q?.trim() ?? '';
  const page = Math.max(1, Number(params.page ?? 1));

  const where = {
    ...clientVisibilityFilter(user),
    ...(q
      ? {
          OR: [
            { fullName: { contains: q, mode: 'insensitive' as const } },
            { phone:    { contains: q } },
            { email:    { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [clients, total] = await Promise.all([
    db.client.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        city: { select: { name: true } },
        owner: { select: { name: true } },
        leads: {
          where: { isArchived: false },
          select: {
            id: true, totalAmount: true,
            funnel: { select: { name: true } },
            stage: { select: { name: true, color: true } },
            payments: { select: { amount: true } },
          },
        },
        _count: { select: { leads: true } },
      },
    }),
    db.client.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <Topbar
        breadcrumbs={[{ label: 'CRM' }, { label: 'Клиенты' }]}
      />

      <div className="p-4 md:p-5 max-w-[1640px] w-full">
        {/* Toolbar */}
        <div className="bg-paper border border-line rounded-lg mb-3 p-3 flex items-center gap-3 flex-wrap">
          <form action="/clients" method="get" className="flex-1 min-w-[240px] max-w-[420px] relative">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Поиск по ФИО, телефону, email..."
              className="w-full pl-8 pr-3 py-1.5 text-12 bg-paper border border-line rounded-md focus:border-ink-5 focus:outline-none"
            />
          </form>
          <div className="text-[12px] text-ink-3">
            Найдено: <strong className="text-ink">{total}</strong>
          </div>
          <Link href="/clients/new" className="ml-auto">
            <Button variant="primary">
              <Plus size={12} /> Новый клиент
            </Button>
          </Link>
        </div>

        {/* Таблица */}
        <div className="bg-paper border border-line rounded-lg overflow-hidden">
          <div className="overflow-x-auto thin-scroll">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="bg-bg border-b border-line">
                  <Th>Клиент</Th>
                  <Th>Телефон</Th>
                  <Th>Город</Th>
                  <Th>Активные дела</Th>
                  <Th align="right">Общая стоимость</Th>
                  <Th align="right">Долг</Th>
                  <Th>Создан</Th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => {
                  const totalAmount = c.leads.reduce((s, l) => s + Number(l.totalAmount), 0);
                  const totalPaid   = c.leads.reduce(
                    (s, l) => s + l.payments.reduce((ps, p) => ps + Number(p.amount), 0),
                    0,
                  );
                  const debt = Math.max(0, totalAmount - totalPaid);

                  return (
                    <tr key={c.id} className="border-b border-line-2 last:border-0 hover:bg-bg">
                      <td className="px-4 py-2.5">
                        <Link href={c.leads[0] ? `/clients/${c.leads[0].id}` : '#'} className="flex items-center gap-2.5">
                          <Avatar name={c.fullName} size="sm" />
                          <div>
                            <div className="font-semibold text-ink">{c.fullName}</div>
                            {c.email && <div className="text-[11px] text-ink-4">{c.email}</div>}
                          </div>
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-ink-3">{formatPhone(c.phone)}</td>
                      <td className="px-4 py-2.5 text-ink-2">{c.city?.name ?? '—'}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {c.leads.slice(0, 2).map((l) => (
                            <Badge
                              key={l.id}
                              style={{
                                background: (l.stage.color || '#71717A') + '14',
                                color:      l.stage.color || '#71717A',
                                borderColor: (l.stage.color || '#71717A') + '33',
                              }}
                            >
                              {l.funnel.name}
                            </Badge>
                          ))}
                          {c.leads.length > 2 && (
                            <Badge>+{c.leads.length - 2}</Badge>
                          )}
                          {c.leads.length === 0 && (
                            <span className="text-[11px] text-ink-4">нет активных</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold text-ink whitespace-nowrap">
                        {totalAmount > 0 ? `${formatMoney(totalAmount)} zł` : '—'}
                      </td>
                      <td className={`px-4 py-2.5 text-right font-mono whitespace-nowrap ${debt > 0 ? 'text-danger font-semibold' : 'text-ink-4'}`}>
                        {debt > 0 ? `${formatMoney(debt)} zł` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-ink-3 whitespace-nowrap text-[11.5px]">
                        {formatDate(c.createdAt)}
                      </td>
                    </tr>
                  );
                })}
                {clients.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-ink-4">
                      {q ? `По запросу "${q}" клиентов не найдено` : 'Клиентов пока нет'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Пагинация */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-4">
            {page > 1 && (
              <Link
                href={`/clients?${new URLSearchParams({ ...(q && { q }), page: String(page - 1) })}`}
                className="px-3 py-1.5 text-[12px] bg-paper border border-line rounded-md text-ink-2 hover:border-ink-5"
              >
                ← Назад
              </Link>
            )}
            <span className="text-[12px] text-ink-3">
              Страница <strong className="text-ink">{page}</strong> из {totalPages}
            </span>
            {page < totalPages && (
              <Link
                href={`/clients?${new URLSearchParams({ ...(q && { q }), page: String(page + 1) })}`}
                className="px-3 py-1.5 text-[12px] bg-paper border border-line rounded-md text-ink-2 hover:border-ink-5"
              >
                Вперёд →
              </Link>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function Th({
  children, align,
}: { children: React.ReactNode; align?: 'right' | 'left' }) {
  return (
    <th className={`px-4 py-2.5 text-[10.5px] uppercase tracking-[0.05em] text-ink-4 font-semibold ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  );
}
