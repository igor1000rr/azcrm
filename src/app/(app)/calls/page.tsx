// Звонки — журнал входящих/исходящих/пропущенных
// + Anna идея №12: поиск по транскрипту, фильтр по sentiment, раскрытие текста
import Link from 'next/link';
import { Topbar } from '@/components/topbar';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { leadVisibilityFilter } from '@/lib/permissions';
import { CallsList, type CallListItem } from './calls-list';
import { Search, Sparkles } from 'lucide-react';
import type { CallSentiment, Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    direction?: 'IN' | 'OUT' | 'MISSED' | 'all';
    sentiment?: CallSentiment | 'all' | 'unanalyzed';
    q?:         string;
  }>;
}

const SENTIMENT_FILTERS: Array<{ key: CallSentiment | 'all' | 'unanalyzed'; label: string; emoji: string }> = [
  { key: 'all',            label: 'Все',          emoji: '' },
  { key: 'NEGATIVE',       label: 'Раздражён',    emoji: '😡' },
  { key: 'PRICE_QUESTION', label: 'Спросил цену', emoji: '💰' },
  { key: 'POSITIVE',       label: 'Доволен',      emoji: '😊' },
  { key: 'NEUTRAL',        label: 'Нейтрально',   emoji: '😐' },
  { key: 'unanalyzed',     label: 'Без анализа',  emoji: '' },
];

export default async function CallsPage({ searchParams }: PageProps) {
  const user = await requireUser();
  const params = await searchParams;
  const direction = params.direction ?? 'all';
  const sentiment = params.sentiment ?? 'all';
  const q = (params.q ?? '').trim();

  // Видимость: для не-админа — только звонки видимых лидов
  const where: Prisma.CallWhereInput = {
    ...(user.role === 'ADMIN' ? {} : { lead: leadVisibilityFilter(user) }),
    ...(direction !== 'all' ? { direction } : {}),
    ...(sentiment === 'unanalyzed' ? { sentiment: null }
       : sentiment !== 'all'       ? { sentiment } : {}),
    ...(q ? { transcript: { contains: q, mode: 'insensitive' as const } } : {}),
  };

  const calls = await db.call.findMany({
    where,
    orderBy: { startedAt: 'desc' },
    take:    200,
    include: {
      client: { select: { id: true, fullName: true } },
      lead:   { select: { id: true } },
    },
  });

  // Счётчик «проблемных» — для бейджа на фильтре
  const negativeCount = await db.call.count({
    where: {
      ...(user.role === 'ADMIN' ? {} : { lead: leadVisibilityFilter(user) }),
      sentiment: 'NEGATIVE',
    },
  });

  const items: CallListItem[] = calls.map((c) => ({
    id:               c.id,
    direction:        c.direction,
    fromNumber:       c.fromNumber,
    toNumber:         c.toNumber,
    startedAt:        c.startedAt.toISOString(),
    durationSec:      c.durationSec,
    recordUrl:        c.recordUrl,
    recordLocalUrl:   c.recordLocalUrl,
    client:           c.client,
    lead:             c.lead,
    transcript:       c.transcript,
    transcriptStatus: c.transcriptStatus,
    sentiment:        c.sentiment,
    sentimentScore:   c.sentimentScore,
    analysisSummary:  c.analysisSummary,
    analysisTags:     c.analysisTags,
  }));

  // Helper для формирования URL с сохранением остальных параметров
  function buildUrl(patch: Partial<{ direction: string; sentiment: string; q: string }>) {
    const next = new URLSearchParams();
    const dir = patch.direction ?? direction;
    const sen = patch.sentiment ?? sentiment;
    const qq  = patch.q         ?? q;
    if (dir !== 'all') next.set('direction', dir);
    if (sen !== 'all') next.set('sentiment', sen);
    if (qq)            next.set('q', qq);
    const s = next.toString();
    return s ? `/calls?${s}` : '/calls';
  }

  return (
    <>
      <Topbar breadcrumbs={[{ label: 'CRM' }, { label: 'Звонки' }]} />

      <div className="p-4 md:p-5 max-w-[1280px] w-full">
        {/* Поиск по транскрипту */}
        <form action="/calls" method="GET" className="mb-3 flex items-center gap-2">
          <div className="flex-1 relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
            <input
              name="q"
              defaultValue={q}
              placeholder="Поиск по тексту разговоров..."
              className="w-full pl-9 pr-3 py-2 rounded-md border border-line bg-paper text-[13px] focus:outline-none focus:border-gold"
            />
          </div>
          {/* Сохраняем direction и sentiment при поиске */}
          {direction !== 'all' && <input type="hidden" name="direction" value={direction} />}
          {sentiment !== 'all' && <input type="hidden" name="sentiment" value={sentiment} />}
          <button type="submit" className="px-4 py-2 rounded-md bg-navy text-gold text-[12px] font-semibold hover:opacity-90">
            Найти
          </button>
          {q && (
            <Link href={buildUrl({ q: '' })} className="text-[12px] text-ink-4 hover:text-ink underline">
              сбросить
            </Link>
          )}
        </form>

        {/* Фильтр по направлению */}
        <div className="bg-paper border border-line rounded-lg mb-2 p-2 flex items-center gap-1 flex-wrap">
          <span className="text-[10.5px] uppercase tracking-[0.05em] text-ink-4 font-semibold px-2">Направление:</span>
          {(['all', 'IN', 'OUT', 'MISSED'] as const).map((d) => (
            <Link
              key={d}
              href={buildUrl({ direction: d })}
              className={`px-3 py-1.5 text-[12px] font-medium rounded ${
                direction === d ? 'bg-navy text-white' : 'text-ink-3 hover:text-ink hover:bg-bg'
              }`}
            >
              {d === 'all' ? 'Все' : d === 'IN' ? 'Входящие' : d === 'OUT' ? 'Исходящие' : 'Пропущенные'}
            </Link>
          ))}
        </div>

        {/* Фильтр по sentiment — главная новая фишка */}
        <div className="bg-paper border border-line rounded-lg mb-3 p-2 flex items-center gap-1 flex-wrap">
          <span className="inline-flex items-center gap-1 text-[10.5px] uppercase tracking-[0.05em] text-ink-4 font-semibold px-2">
            <Sparkles size={11} /> Настроение:
          </span>
          {SENTIMENT_FILTERS.map((s) => {
            const active = sentiment === s.key;
            const isNegativeFilter = s.key === 'NEGATIVE';
            return (
              <Link
                key={s.key}
                href={buildUrl({ sentiment: s.key })}
                className={`px-3 py-1.5 text-[12px] font-medium rounded inline-flex items-center gap-1 ${
                  active
                    ? isNegativeFilter ? 'bg-danger text-white' : 'bg-navy text-white'
                    : 'text-ink-3 hover:text-ink hover:bg-bg'
                }`}
              >
                {s.emoji && <span>{s.emoji}</span>}
                {s.label}
                {isNegativeFilter && negativeCount > 0 && !active && (
                  <span className="ml-1 px-1.5 py-px rounded-full bg-danger text-white text-[10px] font-bold">
                    {negativeCount}
                  </span>
                )}
              </Link>
            );
          })}
        </div>

        {q && (
          <div className="mb-3 text-[12px] text-ink-3">
            Найдено <strong className="text-ink">{calls.length}</strong> звонков по запросу «<strong className="text-ink">{q}</strong>»
            {calls.length === 200 && ' (показаны первые 200)'}
          </div>
        )}

        <div className="bg-paper border border-line rounded-lg overflow-hidden">
          <CallsList calls={items} highlightQuery={q || undefined} />
        </div>
      </div>
    </>
  );
}
