'use client';

// Объединённая переписка по клиенту в карточке лида.
// Показывает сообщения со всех каналов в одной ленте, с пометкой канала
// рядом с каждым сообщением. Снизу — селектор канала и поле ввода.
//
// Права (через бэк, мы только отображаем доступные):
//   ADMIN — все активные каналы
//   SALES / LEGAL — свои (ownerId == user.id) + общие (ownerId == null)

import { useState, useRef, useEffect, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Send, FileText, MessageSquare, ChevronDown } from 'lucide-react';
import { cn, formatTime, formatDate } from '@/lib/utils';

export interface LeadChatMessage {
  id:          string;
  direction:   'IN' | 'OUT' | 'SYSTEM';
  type:        string;
  body:        string | null;
  mediaUrl:    string | null;
  mediaName:   string | null;
  createdAt:   string;
  isRead:      boolean;
  deliveredAt: string | null;
  senderName:  string | null;
  // Канал откуда пришло/отправлено сообщение
  accountId:    string;
  accountLabel: string;
}

export interface LeadChatAccount {
  id:          string;
  label:       string;
  phoneNumber: string;
  isConnected: boolean;
  isShared:    boolean;  // ownerId === null
}

interface Props {
  leadId:           string;
  clientName:       string;
  messages:         LeadChatMessage[];
  availableAccounts: LeadChatAccount[];
}

export function LeadChatPanel({
  leadId, clientName, messages, availableAccounts,
}: Props) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Выбираем канал по умолчанию: тот откуда пришло последнее входящее.
  // Если входящих нет — первый доступный подключённый.
  const defaultAccountId = pickDefaultAccount(messages, availableAccounts);
  const [selectedAccountId, setSelectedAccountId] = useState(defaultAccountId);

  // Если данные обновились (router.refresh) и сменился набор каналов —
  // переустанавливаем выбор только если текущий стал недоступен.
  useEffect(() => {
    if (selectedAccountId && availableAccounts.some((a) => a.id === selectedAccountId)) {
      return;
    }
    setSelectedAccountId(pickDefaultAccount(messages, availableAccounts));
  }, [availableAccounts, messages, selectedAccountId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [messages.length]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!body.trim() || sending || !selectedAccountId) return;
    setSending(true);
    try {
      const res = await fetch('/api/whatsapp/lead-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId,
          accountId: selectedAccountId,
          body:      body.trim(),
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        alert(data.error || 'Не удалось отправить');
      } else {
        setBody('');
        router.refresh();
      }
    } catch (e) {
      console.error(e);
      alert('Ошибка отправки');
    } finally {
      setSending(false);
    }
  }

  // Группировка по дням для красивых разделителей
  const grouped: Array<{ date: string; items: LeadChatMessage[] }> = [];
  for (const m of messages) {
    const day = m.createdAt.slice(0, 10);
    const last = grouped[grouped.length - 1];
    if (last && last.date === day) last.items.push(m);
    else grouped.push({ date: day, items: [m] });
  }

  const selectedAccount = availableAccounts.find((a) => a.id === selectedAccountId);

  return (
    <div className="bg-paper border border-line rounded-lg flex flex-col overflow-hidden">
      {/* Шапка */}
      <div className="px-4 py-2.5 border-b border-line flex items-center gap-2 bg-bg">
        <MessageSquare size={14} className="text-ink-3" />
        <h3 className="text-[12.5px] font-bold uppercase tracking-[0.05em] text-ink-2">
          Переписки с {clientName}
        </h3>
        <span className="ml-auto text-[11px] text-ink-4">
          {messages.length} {pluralizeMsg(messages.length)} · {countChannels(messages)} {pluralizeChannel(countChannels(messages))}
        </span>
      </div>

      {/* Лента сообщений — фиксированная высота с прокруткой */}
      <div className="h-[480px] overflow-y-auto thin-scroll px-3 py-3 bg-bg">
        {grouped.length === 0 ? (
          <div className="h-full grid place-items-center text-center text-[13px] text-ink-4">
            <div>
              <MessageSquare size={32} className="mx-auto text-ink-5 mb-2" />
              <div>Переписок с этим клиентом пока нет</div>
              <div className="text-[11.5px] mt-1">Напишите первое сообщение ниже</div>
            </div>
          </div>
        ) : (
          grouped.map((g) => (
            <div key={g.date}>
              <div className="text-center my-3">
                <span className="text-[10.5px] px-2.5 py-0.5 bg-paper border border-line rounded-full text-ink-3 font-medium">
                  {formatDateLabel(g.date)}
                </span>
              </div>
              {g.items.map((m) => (
                <Bubble key={m.id} m={m} />
              ))}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Композер с селектором канала */}
      <form onSubmit={send} className="border-t border-line px-3 py-2.5">
        {availableAccounts.length === 0 ? (
          <div className="text-[12px] text-ink-4 text-center py-2">
            Нет доступных каналов для отправки сообщения
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[11px] text-ink-4 shrink-0">Отправить через:</span>
              <ChannelSelect
                accounts={availableAccounts}
                selectedId={selectedAccountId}
                onChange={setSelectedAccountId}
              />
              {selectedAccount && !selectedAccount.isConnected && (
                <span className="text-[10.5px] text-warn">канал не подключён</span>
              )}
            </div>
            <div className="flex items-end gap-2">
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send(e as unknown as FormEvent);
                  }
                }}
                rows={2}
                placeholder="Напишите сообщение..."
                className="flex-1 resize-none px-3 py-2 text-[13px] bg-bg border border-line rounded-md focus:bg-paper focus:border-navy focus:outline-none max-h-[120px]"
                disabled={!selectedAccountId || (selectedAccount && !selectedAccount.isConnected)}
              />
              <button
                type="submit"
                disabled={!body.trim() || sending || !selectedAccountId || (selectedAccount && !selectedAccount.isConnected)}
                className={cn(
                  'h-9 px-3 rounded-md flex items-center gap-1.5 text-[12.5px] font-semibold transition-colors',
                  body.trim() && !sending && selectedAccount?.isConnected
                    ? 'bg-navy text-white hover:bg-navy-soft'
                    : 'bg-bg text-ink-4 cursor-not-allowed',
                )}
              >
                <Send size={13} />
                Отправить
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

/** Кастомный селектор канала — небольшой dropdown под "Отправить через:" */
function ChannelSelect({
  accounts, selectedId, onChange,
}: {
  accounts: LeadChatAccount[];
  selectedId: string | null;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const selected = accounts.find((a) => a.id === selectedId);

  // Закрываем при клике снаружи
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-1 text-[12px] bg-bg border border-line rounded-md hover:bg-paper hover:border-ink-5 transition-colors"
      >
        {selected ? (
          <>
            <span className={cn(
              'w-1.5 h-1.5 rounded-full shrink-0',
              selected.isConnected ? 'bg-success' : 'bg-warn',
            )} />
            <span className="font-semibold text-ink">{selected.label}</span>
            {selected.isShared && (
              <span className="text-[10px] text-ink-4 px-1 bg-bg-alt rounded">общий</span>
            )}
          </>
        ) : (
          <span className="text-ink-4">Выберите канал</span>
        )}
        <ChevronDown size={11} className="text-ink-4" />
      </button>

      {open && (
        <div className="absolute z-30 top-full left-0 mt-1 min-w-[220px] bg-paper border border-line rounded-md shadow-lg py-1">
          {accounts.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => { onChange(a.id); setOpen(false); }}
              className={cn(
                'w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] text-left hover:bg-bg',
                selectedId === a.id && 'bg-bg',
              )}
            >
              <span className={cn(
                'w-1.5 h-1.5 rounded-full shrink-0',
                a.isConnected ? 'bg-success' : 'bg-ink-5',
              )} />
              <span className="flex-1 min-w-0">
                <span className="font-semibold text-ink">{a.label}</span>
                <span className="ml-1.5 text-ink-4 font-mono text-[10.5px]">{a.phoneNumber}</span>
              </span>
              {a.isShared && (
                <span className="text-[10px] text-ink-4 px-1 bg-bg-alt rounded">общий</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Bubble({ m }: { m: LeadChatMessage }) {
  const isOut = m.direction === 'OUT';
  return (
    <div className={cn('flex mb-1', isOut ? 'justify-end' : 'justify-start')}>
      <div className={cn(
        'max-w-[85%] sm:max-w-[70%] px-3 py-1.5 rounded-2xl text-[13px] break-words',
        isOut
          ? 'bg-navy text-white rounded-br-sm'
          : 'bg-paper border border-line text-ink rounded-bl-sm',
      )}>
        {/* Тег канала — маленькая плашка над сообщением */}
        <div className={cn(
          'text-[9.5px] font-semibold uppercase tracking-[0.04em] mb-0.5',
          isOut ? 'text-white/70' : 'text-ink-4',
        )}>
          {m.accountLabel}
          {m.senderName && isOut && ` · ${m.senderName}`}
        </div>

        {m.type === 'IMAGE' && m.mediaUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.mediaUrl} alt="" className="rounded mb-1 max-w-full" />
        )}
        {m.type === 'DOCUMENT' && m.mediaUrl && (
          <a
            href={m.mediaUrl}
            target="_blank"
            rel="noreferrer"
            className={cn(
              'flex items-center gap-2 text-[12px] underline mb-1',
              isOut ? 'text-white/90' : 'text-info',
            )}
          >
            <FileText size={12} /> {m.mediaName || 'Документ'}
          </a>
        )}
        {m.body && <div className="whitespace-pre-wrap">{m.body}</div>}
        <div className={cn(
          'text-[10px] mt-0.5 text-right opacity-70',
          isOut ? 'text-white/70' : 'text-ink-4',
        )}>
          {formatTime(m.createdAt)}
          {isOut && (
            <span className="ml-1">
              {m.isRead ? '✓✓' : m.deliveredAt ? '✓' : '·'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** По умолчанию выбираем канал последнего входящего, если он доступен */
function pickDefaultAccount(
  messages: LeadChatMessage[],
  accounts: LeadChatAccount[],
): string | null {
  // последнее входящее в порядке от свежих к старым
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.direction === 'IN' && accounts.some((a) => a.id === m.accountId)) {
      return m.accountId;
    }
  }
  // первый подключённый из доступных
  const connected = accounts.find((a) => a.isConnected);
  if (connected) return connected.id;
  // вообще любой доступный
  return accounts[0]?.id ?? null;
}

function countChannels(messages: LeadChatMessage[]): number {
  const set = new Set(messages.map((m) => m.accountId));
  return set.size;
}

function pluralizeMsg(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return 'сообщение';
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return 'сообщения';
  return 'сообщений';
}

function pluralizeChannel(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return 'канал';
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return 'канала';
  return 'каналов';
}

function formatDateLabel(dayKey: string): string {
  const d = new Date(dayKey + 'T00:00:00');
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const yest = new Date(now.getTime() - 86400_000).toISOString().slice(0, 10);
  if (dayKey === today) return 'Сегодня';
  if (dayKey === yest) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

void formatDate; // keep import for potential future use
