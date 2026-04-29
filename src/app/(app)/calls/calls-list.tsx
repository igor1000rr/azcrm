'use client';

// Anna идея №12: список звонков с раскрытием транскрипта и sentiment-бейджем.
// Server-component передаёт обработанные данные, здесь только UI и
// клиентская логика (toggle expanded). Бейдж sentiment + summary всегда
// видны в строке если транскрипция готова — без раскрытия.

import { useState } from 'react';
import Link from 'next/link';
import {
  PhoneIncoming, PhoneOutgoing, PhoneMissed, Play,
  ChevronDown, ChevronUp, Sparkles, Loader2,
} from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { formatDateTime, formatPhone, cn } from '@/lib/utils';
import type { CallSentiment, CallDirection, TranscriptStatus } from '@prisma/client';

export interface CallListItem {
  id:                string;
  direction:         CallDirection;
  fromNumber:        string;
  toNumber:          string;
  startedAt:         string;          // ISO
  durationSec:       number | null;
  recordUrl:         string | null;
  recordLocalUrl:    string | null;
  client:            { id: string; fullName: string } | null;
  lead:              { id: string } | null;
  // Транскрипция (Anna идея №12)
  transcript:        string | null;
  transcriptStatus:  TranscriptStatus;
  sentiment:         CallSentiment | null;
  sentimentScore:    number | null;
  analysisSummary:   string | null;
  analysisTags:      string[];
}

interface Props {
  calls:           CallListItem[];
  highlightQuery?: string;            // подсветка поискового запроса в транскрипте
}

const SENTIMENT_META: Record<CallSentiment, { label: string; className: string; emoji: string }> = {
  POSITIVE:       { label: 'Доволен',          emoji: '😊', className: 'bg-success-bg text-success border-success/30' },
  NEUTRAL:        { label: 'Нейтрально',       emoji: '😐', className: 'bg-bg text-ink-3 border-line' },
  NEGATIVE:       { label: 'Раздражён',        emoji: '😡', className: 'bg-danger-bg text-danger border-danger/30' },
  PRICE_QUESTION: { label: 'Спрашивает цену',  emoji: '💰', className: 'bg-gold-pale text-gold border-gold/30' },
};

export function CallsList({ calls, highlightQuery }: Props) {
  if (calls.length === 0) {
    return (
      <div className="p-10 text-center">
        <PhoneIncoming size={36} className="mx-auto text-ink-5 mb-3" />
        <h3 className="text-[14px] font-semibold mb-1">Звонков не найдено</h3>
        <p className="text-[12px] text-ink-3">Попробуйте изменить фильтры или поисковый запрос</p>
      </div>
    );
  }
  return (
    <div className="divide-y divide-line">
      {calls.map((c) => <CallRow key={c.id} call={c} highlightQuery={highlightQuery} />)}
    </div>
  );
}

function CallRow({ call, highlightQuery }: { call: CallListItem; highlightQuery?: string }) {
  const [expanded, setExpanded] = useState(false);

  const Icon = call.direction === 'IN' ? PhoneIncoming
              : call.direction === 'OUT' ? PhoneOutgoing
              : PhoneMissed;
  const color = call.direction === 'MISSED' ? 'text-danger'
               : call.direction === 'IN'    ? 'text-success'
               : 'text-info';
  const otherNumber = call.direction === 'IN' ? call.fromNumber : call.toNumber;
  const sentimentMeta = call.sentiment ? SENTIMENT_META[call.sentiment] : null;
  const hasTranscript = !!call.transcript;

  return (
    <div className="hover:bg-bg/50">
      <div className="px-5 py-3 flex items-center gap-3 flex-wrap">
        <div className={cn('w-9 h-9 rounded-md grid place-items-center shrink-0 bg-bg', color)}>
          <Icon size={14} />
        </div>

        {call.client ? (
          <Link href={`/clients/${call.lead?.id ?? call.client.id}`} className="flex items-center gap-2 min-w-0 flex-1 hover:opacity-80">
            <Avatar name={call.client.fullName} size="sm" />
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-ink truncate">{call.client.fullName}</div>
              <div className="text-[11px] text-ink-3 font-mono">{formatPhone(otherNumber)}</div>
            </div>
          </Link>
        ) : (
          <div className="flex-1 min-w-0">
            <div className="text-[13px] text-ink font-mono">{formatPhone(otherNumber)}</div>
            <div className="text-[11px] text-ink-4">Неизвестный номер</div>
          </div>
        )}

        {/* Sentiment бейдж — главный визуальный сигнал */}
        {sentimentMeta && (
          <span
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap',
              sentimentMeta.className,
            )}
            title={call.analysisSummary || sentimentMeta.label}
          >
            <span>{sentimentMeta.emoji}</span>{sentimentMeta.label}
          </span>
        )}

        {/* Лоадер пока обрабатывается */}
        {call.transcriptStatus === 'PENDING' && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] text-ink-4 border-line whitespace-nowrap">
            <Loader2 size={10} className="animate-spin" /> в очереди
          </span>
        )}
        {call.transcriptStatus === 'PROCESSING' && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] text-info border-info/30 bg-info-bg whitespace-nowrap">
            <Sparkles size={10} className="animate-pulse" /> анализируется
          </span>
        )}

        <div className="text-[11.5px] text-ink-3 text-right whitespace-nowrap">
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

        {hasTranscript && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="w-8 h-8 rounded-md border border-line bg-paper text-ink-3 grid place-items-center hover:border-ink-5"
            title={expanded ? 'Свернуть транскрипт' : 'Показать транскрипт'}
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
      </div>

      {/* Краткое резюме всегда видно если есть */}
      {call.analysisSummary && !expanded && (
        <div className="px-5 pb-3 -mt-1 text-[12px] text-ink-3 italic ml-12 line-clamp-2">
          {call.analysisSummary}
        </div>
      )}

      {/* Раскрытый транскрипт + теги */}
      {expanded && hasTranscript && (
        <div className="px-5 pb-4 ml-12 flex flex-col gap-2.5">
          {call.analysisSummary && (
            <div className="text-[12px] text-ink-3 italic">
              <span className="text-[10.5px] uppercase tracking-[0.05em] text-ink-4 font-semibold mr-2">Резюме</span>
              {call.analysisSummary}
            </div>
          )}
          {call.analysisTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {call.analysisTags.map((t) => (
                <span key={t} className="text-[10.5px] px-1.5 py-0.5 rounded bg-bg text-ink-3 border border-line font-mono">
                  {t}
                </span>
              ))}
            </div>
          )}
          <div className="bg-bg/60 border border-line rounded-md p-3 text-[12.5px] text-ink-2 leading-relaxed whitespace-pre-wrap">
            {highlightQuery
              ? <HighlightedText text={call.transcript!} query={highlightQuery} />
              : call.transcript}
          </div>
        </div>
      )}
    </div>
  );
}

/** Простая подсветка поискового запроса в тексте. Регистронезависимая,
 *  без regex-injection (escape метасимволов). */
function HighlightedText({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;

  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));

  return (
    <>
      {parts.map((part, i) => (
        part.toLowerCase() === q.toLowerCase()
          ? <mark key={i} className="bg-gold-pale text-gold font-semibold rounded px-0.5">{part}</mark>
          : <span key={i}>{part}</span>
      ))}
    </>
  );
}
