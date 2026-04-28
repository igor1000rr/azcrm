'use client';

// Inbox — три колонки: каналы / треды / переписка
import { useState, useRef, useEffect, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Send, Paperclip, Search, MessageSquare,
  ChevronLeft, FileText, Sparkles,
} from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Modal } from '@/components/ui/modal';
import { cn, formatTime, formatPhone, formatDate } from '@/lib/utils';

interface AccountLite {
  id: string; label: string; phoneNumber: string;
  isConnected: boolean; ownerId: string | null;
}

interface ThreadLite {
  id: string;
  clientName: string;
  clientPhone: string;
  lastMessageAt: string | null;
  lastMessageText: string | null;
  unreadCount: number;
  accountLabel: string | null;
  leadId: string | null;
  funnelName: string | null;
}

interface MessageLite {
  id: string;
  direction: 'IN' | 'OUT' | 'SYSTEM';
  type: string;
  body: string | null;
  mediaUrl: string | null;
  mediaName: string | null;
  createdAt: string;
  isRead: boolean;
  deliveredAt: string | null;
  senderName: string | null;
}

interface InboxViewProps {
  accounts: AccountLite[];
  threads: ThreadLite[];
  activeThreadId: string | null;
  activeMessages: MessageLite[];
  activeThread: {
    id: string; accountId: string; clientId: string | null;
    clientName: string; clientPhone: string; leadId: string | null;
  } | null;
}

export function InboxView({
  accounts, threads, activeThreadId, activeMessages, activeThread,
}: InboxViewProps) {
  const router = useRouter();

  // Авто-обновление: раз в 5 секунд тихо перезапрашиваем server-state
  // через router.refresh() — это RSC-friendly, без full page reload.
  // Когда вкладка не в фокусе — пауза (Page Visibility API), чтобы не
  // долбить сервер открытыми вкладками. При возврате фокуса — мгновенный
  // refresh + возобновление интервала.
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (intervalId) return;
      intervalId = setInterval(() => {
        if (document.visibilityState === 'visible') {
          router.refresh();
        }
      }, 5000);
    };

    const stop = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        router.refresh(); // мгновенный апдейт при возврате во вкладку
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [router]);

  return (
    // 100svh (small viewport height) надёжнее 100dvh в Safari — не пляшет
    // вместе с URL-bar. min-h-0 нужен чтобы flex-children (треды, чат)
    // могли скроллиться внутри, а не выпирать наружу формой ввода.
    <div className="flex-1 flex h-[calc(100svh-52px)] min-h-0 overflow-hidden">
      {/* Левая колонка — каналы */}
      <div className="w-56 border-r border-line bg-paper hidden lg:flex flex-col shrink-0 min-h-0">
        <div className="px-4 py-3 border-b border-line">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-2">
            Каналы
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto thin-scroll p-2 min-h-0">
          <Link
            href="/inbox"
            className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-md text-[12.5px]',
              'hover:bg-bg transition-colors',
            )}
          >
            <MessageSquare size={13} className="text-ink-3" />
            <span className="flex-1">Все</span>
          </Link>
          {accounts.map((a) => (
            <Link
              key={a.id}
              href={`/inbox?channel=${a.id}`}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-md text-[12.5px]',
                'hover:bg-bg transition-colors',
              )}
            >
              <span className={cn(
                'w-1.5 h-1.5 rounded-full shrink-0',
                a.isConnected ? 'bg-success' : 'bg-ink-5',
              )} />
              <div className="flex-1 min-w-0">
                <div className="text-ink truncate">{a.label}</div>
                <div className="text-[10.5px] text-ink-4 font-mono truncate">{a.phoneNumber}</div>
              </div>
            </Link>
          ))}

          <Link
            href="/settings/channels"
            className="block mt-3 px-3 py-2 text-[11.5px] text-info hover:underline"
          >
            Управление каналами →
          </Link>
        </div>
      </div>

      {/* Средняя колонка — список тредов */}
      <div className={cn(
        'border-r border-line bg-paper flex flex-col shrink-0 min-h-0',
        'w-full sm:w-[320px]',
        activeThread && 'hidden sm:flex',
      )}>
        <div className="px-3 py-2.5 border-b border-line shrink-0">
          <div className="relative">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
            <input
              type="text"
              placeholder="Поиск..."
              className="w-full pl-8 pr-3 py-1.5 text-[12.5px] bg-bg border border-transparent rounded-md focus:bg-paper focus:border-line focus:outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto thin-scroll min-h-0">
          {threads.length === 0 ? (
            <div className="text-center p-8 text-[13px] text-ink-4">
              Переписок пока нет
            </div>
          ) : (
            threads.map((t) => (
              <Link
                key={t.id}
                href={`/inbox?thread=${t.id}`}
                className={cn(
                  'flex gap-2.5 px-3 py-2.5 border-b border-line-2 transition-colors',
                  activeThreadId === t.id ? 'bg-bg-alt' : 'hover:bg-bg',
                )}
              >
                <Avatar name={t.clientName} size="md" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2 mb-0.5">
                    <span className={cn(
                      'text-[13px] truncate',
                      t.unreadCount > 0 ? 'font-bold text-ink' : 'font-semibold text-ink-2',
                    )}>
                      {t.clientName}
                    </span>
                    {t.lastMessageAt && (
                      <span className={cn(
                        'text-[10.5px] shrink-0',
                        t.unreadCount > 0 ? 'text-navy font-bold' : 'text-ink-4',
                      )}>
                        {formatRelativeShort(t.lastMessageAt)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <p className={cn(
                      'text-[11.5px] truncate flex-1',
                      t.unreadCount > 0 ? 'text-ink-2' : 'text-ink-3',
                    )}>
                      {t.lastMessageText || '—'}
                    </p>
                    {t.unreadCount > 0 && (
                      <span className="text-[10px] bg-navy text-white font-bold px-1.5 py-px rounded-full min-w-[18px] text-center shrink-0">
                        {t.unreadCount}
                      </span>
                    )}
                  </div>
                  {(t.accountLabel || t.funnelName) && (
                    <div className="flex items-center gap-1.5 mt-1">
                      {t.accountLabel && (
                        <span className="text-[9.5px] px-1 py-px bg-bg text-ink-4 rounded font-medium">
                          {t.accountLabel}
                        </span>
                      )}
                      {t.funnelName && (
                        <span className="text-[9.5px] px-1 py-px bg-info-bg text-info rounded font-medium">
                          {t.funnelName}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </Link>
            ))
          )}
        </div>
      </div>

      {/* Правая колонка — сообщения */}
      <div className={cn(
        'flex-1 bg-bg flex flex-col min-w-0 min-h-0',
        !activeThread && 'hidden sm:flex',
      )}>
        {!activeThread ? (
          <div className="flex-1 grid place-items-center text-center p-6">
            <div>
              <MessageSquare size={36} className="mx-auto text-ink-5 mb-3" />
              <p className="text-[13px] text-ink-3">Выберите чат для просмотра</p>
            </div>
          </div>
        ) : (
          <ChatPane
            thread={activeThread}
            messages={activeMessages}
          />
        )}
      </div>
    </div>
  );
}

function ChatPane({
  thread, messages,
}: {
  thread: NonNullable<InboxViewProps['activeThread']>;
  messages: MessageLite[];
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Авто-скролл вниз при новых сообщениях
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [messages.length]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!body.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: thread.accountId,
          threadId:  thread.id,
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

  async function applyTemplate(templateId: string) {
    try {
      const res = await fetch('/api/chat-templates/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId, threadId: thread.id }),
      });
      const data = await res.json();
      if (data.body) {
        setBody(data.body);
        setTemplatesOpen(false);
      }
    } catch { alert('Не удалось применить шаблон'); }
  }

  // Группируем сообщения по дням
  const grouped: Array<{ date: string; items: MessageLite[] }> = [];
  for (const m of messages) {
    const day = m.createdAt.slice(0, 10);
    const last = grouped[grouped.length - 1];
    if (last && last.date === day) last.items.push(m);
    else grouped.push({ date: day, items: [m] });
  }

  return (
    <>
      {/* Шапка чата */}
      <div className="bg-paper border-b border-line h-12 flex items-center gap-3 px-3 shrink-0">
        <Link
          href="/inbox"
          className="sm:hidden w-8 h-8 rounded-md grid place-items-center text-ink-3 hover:text-ink hover:bg-bg"
        >
          <ChevronLeft size={16} />
        </Link>
        <Avatar name={thread.clientName} size="sm" />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-ink truncate">{thread.clientName}</div>
          <div className="text-[11px] text-ink-4 font-mono">
            {formatPhone(thread.clientPhone)}
          </div>
        </div>
        {thread.leadId && (
          <Link href={`/clients/${thread.leadId}`} className="text-[12px] text-info hover:underline">
            Открыть карточку →
          </Link>
        )}
      </div>

      {/* Сообщения — flex-1 + min-h-0, чтобы скроллились внутри а не выпихивали форму вниз */}
      <div className="flex-1 overflow-y-auto thin-scroll px-3 py-3 min-h-0">
        {grouped.length === 0 ? (
          <div className="text-center text-[13px] text-ink-4 py-12">
            Сообщений пока нет
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
                <MessageBubble key={m.id} m={m} />
              ))}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Композер — shrink-0 + sticky bottom-0 как страховка если родитель плывёт */}
      <form onSubmit={send} className="bg-paper border-t border-line px-3 py-2.5 shrink-0 sticky bottom-0 z-10">
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => setTemplatesOpen(true)}
            className="w-9 h-9 rounded-md text-ink-4 hover:text-gold hover:bg-gold-pale grid place-items-center transition-colors"
            title="Шаблон сообщения"
          >
            <Sparkles size={15} />
          </button>
          <button
            type="button"
            className="w-9 h-9 rounded-md text-ink-4 hover:text-ink-2 grid place-items-center"
            title="Прикрепить"
          >
            <Paperclip size={15} />
          </button>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(e as unknown as FormEvent);
              }
            }}
            rows={1}
            placeholder="Напишите сообщение..."
            className="flex-1 resize-none px-3 py-2 text-[13px] bg-bg border border-transparent rounded-md focus:bg-paper focus:border-line focus:outline-none max-h-[120px]"
          />
          <button
            type="submit"
            disabled={!body.trim() || sending}
            className={cn(
              'w-9 h-9 rounded-md grid place-items-center transition-colors',
              body.trim() && !sending
                ? 'bg-navy text-white hover:bg-navy-soft'
                : 'bg-bg text-ink-4 cursor-not-allowed',
            )}
            title="Отправить (Enter)"
          >
            <Send size={14} />
          </button>
        </div>
      </form>

      {templatesOpen && (
        <TemplatesModal
          onClose={() => setTemplatesOpen(false)}
          onPick={applyTemplate}
        />
      )}
    </>
  );
}

function TemplatesModal({
  onClose, onPick,
}: {
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const [templates, setTemplates] = useState<Array<{
    id: string; name: string; body: string; category: string | null;
  }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/chat-templates')
      .then((r) => r.json())
      .then((d) => setTemplates(d.templates ?? []))
      .finally(() => setLoading(false));
  }, []);

  // Группируем по категории
  const grouped: Record<string, typeof templates> = {};
  for (const t of templates) {
    const cat = t.category || 'Прочее';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(t);
  }

  return (
    <Modal open={true} onClose={onClose} title="Шаблоны сообщений" size="lg">
      {loading ? (
        <div className="text-center py-6 text-[13px] text-ink-4">Загрузка...</div>
      ) : templates.length === 0 ? (
        <div className="text-center py-8">
          <Sparkles size={32} className="mx-auto text-ink-5 mb-2" />
          <div className="text-[13px] text-ink-3 mb-1">Шаблонов пока нет</div>
          <div className="text-[12px] text-ink-4">
            Добавьте шаблоны в Настройки → Шаблоны сообщений
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 max-h-[500px] overflow-y-auto thin-scroll">
          {Object.entries(grouped).map(([cat, items]) => (
            <div key={cat}>
              <h3 className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-ink-3 mb-1.5 px-1">
                {cat}
              </h3>
              <div className="flex flex-col gap-1">
                {items.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onPick(t.id)}
                    className="text-left p-2.5 rounded-md border border-line hover:border-ink-5 hover:bg-bg transition-colors"
                  >
                    <div className="text-[13px] font-semibold text-ink mb-0.5">{t.name}</div>
                    <div className="text-[11.5px] text-ink-3 line-clamp-2 whitespace-pre-wrap">
                      {t.body.length > 140 ? t.body.slice(0, 140) + '...' : t.body}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function MessageBubble({ m }: { m: MessageLite }) {
  const isOut = m.direction === 'OUT';

  return (
    <div className={cn('flex mb-1', isOut ? 'justify-end' : 'justify-start')}>
      <div className={cn(
        'max-w-[80%] sm:max-w-[60%] px-3 py-1.5 rounded-2xl text-[13px] break-words',
        isOut
          ? 'bg-navy text-white rounded-br-sm'
          : 'bg-paper border border-line text-ink rounded-bl-sm',
      )}>
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

function formatRelativeShort(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return formatTime(iso);
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400_000);
  if (diffDays < 7) return d.toLocaleDateString('ru-RU', { weekday: 'short' });
  return formatDate(iso);
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
