'use client';

// Anna идея №12 «Расшифровка и анализ телефонных разговоров».
// Компактный список звонков по конкретному лиду — на карточке лида.
// Полный список со всеми фильтрами и поиском — на /calls.
//
// Что показывает:
//   - последние N звонков с этим клиентом
//   - sentiment-бейдж (😊/😐/😡/💰) если транскрипция готова
//   - кнопка "развернуть" → транскрипт + резюме + теги
//   - ссылка на /calls?q=... для поиска по всем разговорам клиента

import { useState } from 'react';
import Link from 'next/link';
import {
  PhoneIncoming, PhoneOutgoing, PhoneMissed, Play,
  ChevronDown, ChevronUp, Sparkles, Loader2, ExternalLink,
} from 'lucide-react';
import { formatDateTime, formatPhone, cn } from '@/lib/utils';
import type { CallDirection, CallSentiment, TranscriptStatus } from '@prisma/client';

export interface LeadCallItem {
  id:                string;
  direction:         CallDirection;
  fromNumber:        string;
  toNumber:          string;
  startedAt:         string;          // ISO
  durationSec:       number | null;
  recordUrl:         string | null;
  recordLocalUrl:    string | null;
  transcript:        string | null;
  transcriptStatus:  TranscriptStatus;
  sentiment:         CallSentiment | null;
  analysisSummary:   string | null;
  analysisTags:      string[];
}

const SENTIMENT_META: Record<CallSentiment, { label: string; cls: string; emoji: string }> = {
  POSITIVE:       { label: 'Доволен',         emoji: '😊', cls: 'bg-success-bg text-success border-success/30' },
  NEUTRAL:        { label: 'Нейтрально',      emoji: '😐', cls: 'bg-bg text-ink-3 border-line' },
  NEGATIVE:       { label: 'Раздражён',       emoji: '😡', cls: 'bg-danger-bg text-danger border-danger/30' },
  PRICE_QUESTION: { label: 'Спрашивает цену', emoji: '💰', cls: 'bg-gold-pale text-gold border-gold/30' },
};

interface Props {
  calls:      LeadCallItem[];
  clientName: string;
}

export function LeadCallsList({ calls, clientName }: Props) {
  if (calls.length === 0) {
    return (
      <div className="text-center py-6 text-[12.5px] text-ink-4">
        Звонков с этим клиентом пока не было.
        <div className="mt-1 text-[11.5px]">
          Звонки импортируются автоматически из Play раз в 5 минут.
        </div>
      </div>
    );
  }
  return (
    <>
      <div className="flex flex-col divide-y divide-line">
        {calls.map((c) => <LeadCallRow key={c.id} call={c} />)}
      </div>
      <div className="mt-3 pt-2 border-t border-line text-[11.5px] text-ink-4 flex items-center justify-between">
        <span>Показаны последние {calls.length} звонков по лиду.</span>
        <Link
          href={`/calls?q=${encodeURIComponent(clientName)}`}
          className="inline-flex items-center gap-1 text-navy hover:underline font-medium"
        >
          Все звонки <ExternalLink size={10} />
        </Link>
      </div>
    </>
  );
}

function LeadCallRow({ call }: { call: LeadCallItem }) {
  const [expanded, setExpanded] = useState(false);

  const Icon = call.direction === 'IN' ? PhoneIncoming
              : call.direction === 'OUT' ? PhoneOutgoing
              : PhoneMissed;
  const color = call.direction === 'MISSED' ? 'text-danger'
               : call.direction === 'IN'    ? 'text-success'
               : 'text-info';
  const otherNumber = call.direction === 'IN' ? call.fromNumber : call.toNumber;
  const meta = call.sentiment ? SENTIMENT_META[call.sentiment] : null;
  const hasTranscript = !!call.transcript;

  return (
    <div className="py-2.5">
      <div className="flex items-center gap-2.5 flex-wrap">
        <div className={cn('w-7 h-7 rounded grid place-items-center shrink-0 bg-bg', color)}>
          <Icon size={12} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] text-ink-2 font-mono">{formatPhone(otherNumber)}</div>
          <div className="text-[11px] text-ink-4 mt-0.5">
            {formatDateTime(call.startedAt)}
            {call.durationSec ? (
              <span className="ml-2 font-mono">
                · {Math.floor(call.durationSec / 60)}:{(call.durationSec % 60).toString().padStart(2, '0')}
              </span>
            ) : null}
          </div>
        </div>

        {meta && (
          <span
            className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10.5px] font-semibold whitespace-nowrap', meta.cls)}
            title={call.analysisSummary ?? meta.label}
          >
            <span>{meta.emoji}</span>{meta.label}
          </span>
        )}

        {call.transcriptStatus === 'PENDING' && (
          <span className="inline-flex items-center gap-1 text-[10.5px] text-ink-4 whitespace-nowrap" title="Звонок ждёт транскрипции">
            <Loader2 size={9} className="animate-spin" /> в очереди
          </span>
        )}
        {call.transcriptStatus === 'PROCESSING' && (
          <span className="inline-flex items-center gap-1 text-[10.5px] text-info whitespace-nowrap" title="Whisper + LLM обрабатывают звонок">
            <Sparkles size={9} className="animate-pulse" /> анализируется
          </span>
        )}

        {(call.recordUrl || call.recordLocalUrl) && (
          <a
            href={call.recordLocalUrl ?? call.recordUrl!}
            target="_blank"
            rel="noreferrer"
            className="w-7 h-7 rounded border border-line bg-paper text-ink-3 grid place-items-center hover:border-info hover:text-info"
            title="Прослушать запись"
          >
            <Play size={11} />
          </a>
        )}

        {hasTranscript && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="w-7 h-7 rounded border border-line bg-paper text-ink-3 grid place-items-center hover:border-ink-5"
            title={expanded ? 'Свернуть транскрипт' : 'Показать транскрипт'}
          >
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        )}
      </div>

      {/* Краткое резюме всегда видно если есть */}
      {call.analysisSummary && !expanded && (
        <div className="ml-10 mt-1 text-[11.5px] text-ink-3 italic line-clamp-2">
          {call.analysisSummary}
        </div>
      )}

      {expanded && hasTranscript && (
        <div className="ml-10 mt-2 flex flex-col gap-2">
          {call.analysisSummary && (
            <div className="text-[11.5px] text-ink-3 italic">
              <span className="text-[10px] uppercase tracking-[0.05em] text-ink-4 font-semibold mr-1.5">Резюме</span>
              {call.analysisSummary}
            </div>
          )}
          {call.analysisTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {call.analysisTags.map((t) => (
                <span key={t} className="text-[10px] px-1.5 py-px rounded bg-bg text-ink-3 border border-line font-mono">
                  {t}
                </span>
              ))}
            </div>
          )}
          <div className="bg-bg/60 border border-line rounded p-2.5 text-[12px] text-ink-2 leading-relaxed whitespace-pre-wrap max-h-[300px] overflow-y-auto">
            {call.transcript}
          </div>
        </div>
      )}
    </div>
  );
}
