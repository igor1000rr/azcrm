// Аудит-лог для администратора
import { Topbar } from '@/components/topbar';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';
import { Search } from 'lucide-react';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ q?: string; page?: string }>;
}

const PAGE_SIZE = 100;

export default async function AuditPage({ searchParams }: PageProps) {
  await requireAdmin();
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? 1));

  const where = params.q
    ? {
        OR: [
          { action: { contains: params.q } },
          { entityType: { contains: params.q } },
          { user: { name: { contains: params.q, mode: 'insensitive' as const } } },
        ],
      }
    : {};

  const [logs, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      include: { user: { select: { name: true, role: true } } },
    }),
    db.auditLog.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <Topbar
        breadcrumbs={[{ label: 'CRM' }, { label: 'Настройки' }, { label: 'Аудит' }]}
      />

      <div className="p-4 md:p-5 max-w-[1280px] w-full">
        <div className="bg-paper border border-line rounded-lg mb-3 p-3 flex items-center gap-3 flex-wrap">
          <form action="/settings/audit" method="get" className="flex-1 max-w-[420px] relative">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
            <input
              type="text"
              name="q"
              defaultValue={params.q ?? ''}
              placeholder="Поиск по action, типу сущности, пользователю..."
              className="w-full pl-8 pr-3 py-1.5 text-12 bg-paper border border-line rounded-md focus:border-ink-5 focus:outline-none"
            />
          </form>
          <div className="text-[12px] text-ink-3 ml-auto">
            Записей: <strong className="text-ink">{total}</strong>
          </div>
        </div>

        <div className="bg-paper border border-line rounded-lg overflow-hidden">
          <div className="overflow-x-auto thin-scroll">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-bg border-b border-line">
                  <Th>Время</Th>
                  <Th>Кто</Th>
                  <Th>Действие</Th>
                  <Th>Сущность</Th>
                  <Th>IP</Th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-b border-line-2 last:border-0 hover:bg-bg">
                    <td className="px-3 py-2 text-ink-3 font-mono whitespace-nowrap text-[11.5px]">
                      {formatDateTime(l.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      {l.user ? (
                        <div className="flex items-center gap-2">
                          <Avatar name={l.user.name} size="xs" />
                          <span className="text-ink">{l.user.name}</span>
                        </div>
                      ) : (
                        <span className="text-ink-4">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <code className="font-mono text-[11.5px] px-1.5 py-px bg-bg rounded text-ink-2">
                        {l.action}
                      </code>
                    </td>
                    <td className="px-3 py-2 text-[11.5px]">
                      {l.entityType && (
                        <Link
                          href={l.entityType === 'Lead' ? `/clients/${l.entityId}` : '#'}
                          className="text-info hover:underline font-mono"
                        >
                          {l.entityType}
                          {l.entityId && <span className="text-ink-4"> · {l.entityId.slice(-8)}</span>}
                        </Link>
                      )}
                    </td>
                    <td className="px-3 py-2 text-ink-4 font-mono text-[11px]">
                      {l.ipAddress ?? '—'}
                    </td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-ink-4">
                      Записей не найдено
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-4 text-[12px]">
            {page > 1 && (
              <Link
                href={`/settings/audit?page=${page - 1}${params.q ? `&q=${params.q}` : ''}`}
                className="px-3 py-1.5 bg-paper border border-line rounded-md text-ink-2 hover:border-ink-5"
              >
                ← Назад
              </Link>
            )}
            <span className="text-ink-3">
              Страница <strong className="text-ink">{page}</strong> из {totalPages}
            </span>
            {page < totalPages && (
              <Link
                href={`/settings/audit?page=${page + 1}${params.q ? `&q=${params.q}` : ''}`}
                className="px-3 py-1.5 bg-paper border border-line rounded-md text-ink-2 hover:border-ink-5"
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

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-[10.5px] uppercase tracking-[0.05em] text-ink-4 font-semibold text-left">
      {children}
    </th>
  );
}
