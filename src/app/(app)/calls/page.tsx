// Звонки — журнал входящих/исходящих/пропущенных
import Link from 'next/link';
import { Topbar } from '@/components/topbar';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { leadVisibilityFilter } from '@/lib/permissions';
import { formatDateTime, formatPhone } from '@/lib/utils';
import {
  PhoneIncoming, PhoneOutgoing, PhoneMissed, Play,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ direction?: 'IN' | 'OUT' | 'MISSED' | 'all' }>;
}

export default async function CallsPage({ searchParams }: PageProps) {
  const user = await requireUser();
  const params = await searchParams;
  const direction = params.direction ?? 'all';

  // Видимость: для не-админа — только звонки видимых лидов
  const where = {
    ...(user.role === 'ADMIN'
      ? {}
      : { lead: leadVisibilityFilter(user) }),
    ...(direction !== 'all' ? { direction } : {}),
  };

  const calls = await db.call.findMany({
    where,
    orderBy: { startedAt: 'desc' },
    take: 100,
    include: {
      client: { select: { id: true, fullName: true } },
      lead:   { select: { id: true } },
    },
  });

  return (
    <>
      <Topbar breadcrumbs={[{ label: 'CRM' }, { label: 'Звонки' }]} />

      <div className="p-4 md:p-5 max-w-[1280px] w-full">
        {/* Фильтр */}
        <div className="bg-paper border border-line rounded-lg mb-3 p-2 flex items-center gap-1">
          {(['all', 'IN', 'OUT', 'MISSED'] as const).map((d) => (
            <Link
              key={d}
              href={`/calls?direction=${d}`}
              className={`px-3 py-1.5 text-[12px] font-medium rounded ${
                direction === d ? 'bg-navy text-white' : 'text-ink-3 hover:text-ink hover:bg-bg'
              }`}
            >
              {d === 'all' ? 'Все' : d === 'IN' ? 'Входящие' : d === 'OUT' ? 'Исходящие' : 'Пропущенные'}
            </Link>
          ))}
        </div>

        <div className="bg-paper border border-line rounded-lg overflow-hidden">
          {calls.length === 0 ? (
            <div className="p-10 text-center">
              <PhoneIncoming size={36} className="mx-auto text-ink-5 mb-3" />
              <h3 className="text-[14px] font-semibold mb-1">Звонков пока нет</h3>
              <p className="text-[12px] text-ink-3">
                Звонки будут импортироваться автоматически из Play API после настройки
              </p>
            </div>
          ) : (
            <div className="divide-y divide-line">
              {calls.map((c) => (
                <CallRow key={c.id} call={c} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

type CallLite = {
  id: string;
  direction: 'IN' | 'OUT' | 'MISSED';
  fromNumber: string;
  toNumber: string;
  startedAt: Date;
  durationSec: number | null;
  recordUrl: string | null;
  recordLocalUrl: string | null;
  client: { id: string; fullName: string } | null;
  lead: { id: string } | null;
};

function CallRow({ call }: { call: CallLite }) {
  const Icon = call.direction === 'IN' ? PhoneIncoming
              : call.direction === 'OUT' ? PhoneOutgoing
              : PhoneMissed;
  const color = call.direction === 'MISSED' ? 'text-danger'
               : call.direction === 'IN'    ? 'text-success'
               : 'text-info';
  const otherNumber = call.direction === 'IN' ? call.fromNumber : call.toNumber;

  const Wrapper = call.lead
    ? ({ children }: { children: React.ReactNode }) => (
        <Link href={`/clients/${call.lead!.id}`} className="block hover:bg-bg">{children}</Link>
      )
    : ({ children }: { children: React.ReactNode }) => <div>{children}</div>;

  return (
    <Wrapper>
      <div className="px-5 py-3 flex items-center gap-3 flex-wrap">
        <div className={`w-9 h-9 rounded-md grid place-items-center shrink-0 bg-bg ${color}`}>
          <Icon size={14} />
        </div>

        {call.client ? (
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Avatar name={call.client.fullName} size="sm" />
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-ink truncate">{call.client.fullName}</div>
              <div className="text-[11px] text-ink-3 font-mono">{formatPhone(otherNumber)}</div>
            </div>
          </div>
        ) : (
          <div className="flex-1">
            <div className="text-[13px] text-ink font-mono">{formatPhone(otherNumber)}</div>
            <div className="text-[11px] text-ink-4">Неизвестный номер</div>
          </div>
        )}

        <div className="text-[11.5px] text-ink-3 text-right">
          <div>{formatDateTime(call.startedAt)}</div>
          {call.durationSec ? (
            <div className="font-mono mt-0.5">
              {Math.floor(call.durationSec / 60)}:{(call.durationSec % 60).toString().padStart(2, '0')}
            </div>
          ) : null}
        </div>

        {(call.recordUrl || call.recordLocalUrl) && (
          <a
            href={call.recordLocalUrl ?? call.recordUrl!}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="w-8 h-8 rounded-md border border-line bg-paper text-ink-3 grid place-items-center hover:border-info hover:text-info"
            title="Прослушать запись"
          >
            <Play size={12} />
          </a>
        )}
      </div>
    </Wrapper>
  );
}
