'use client';

// Inbox — три колонки: каналы / треды / переписка
import { useState, useRef, useEffect, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Send, Paperclip, Search, MessageSquare,
  ChevronLeft, FileText, Sparkles, Volume2, VolumeX,
} from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Modal } from '@/components/ui/modal';
import { cn, formatTime, formatPhone, formatDate } from '@/lib/utils';

// Звук уведомления — inline base64 wav (~12KB ding-ding G6→C7), без зависимости
// от статического файла. Раньше использовался '/notify.wav', но самого файла
// в public/ не было — звук молча не воспроизводился.
const NOTIFY_SOUND_DATA_URL = 'data:audio/wav;base64,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';

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
  activeChannelId: string | null;
  activeThreadId: string | null;
  activeMessages: MessageLite[];
  activeThread: {
    id: string; accountId: string; clientId: string | null;
    clientName: string; clientPhone: string; leadId: string | null;
  } | null;
}

export function InboxView({
  accounts, threads, activeChannelId, activeThreadId, activeMessages, activeThread,
}: InboxViewProps) {
  const router = useRouter();

  // Звук уведомлений при новом входящем. Состояние mute сохраняется в
  // localStorage, кнопка mute — в шапке "Каналы". Детект "нового": запоминаем
  // суммарный unreadCount всех тредов на прошлом рендере; если стало больше —
  // звякнули. Так ловим новое сообщение в любом треде, не только в активном.
  // На iOS Safari Audio.play() требует gesture — кнопка-toggle и есть тот gesture,
  // после первого тапа браузер разрешает воспроизведение.
  const [muted, setMuted] = useState<boolean>(false);
  const prevUnreadTotalRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    try { setMuted(localStorage.getItem('inbox.muted') === '1'); } catch {}
    const audio = new Audio(NOTIFY_SOUND_DATA_URL);
    audio.volume = 0.5;
    audio.preload = 'auto';
    audioRef.current = audio;
  }, []);

  useEffect(() => {
    const total = threads.reduce((s, t) => s + t.unreadCount, 0);
    const prev = prevUnreadTotalRef.current;
    prevUnreadTotalRef.current = total;
    if (prev === null) return; // первый рендер — не пикаем
    if (total > prev && !muted && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => { /* нет gesture-разрешения — молча */ });
    }
  }, [threads, muted]);

  function toggleMute() {
    setMuted((m) => {
      const next = !m;
      try { localStorage.setItem('inbox.muted', next ? '1' : '0'); } catch {}
      // Прогрев на iOS: если разрешения ещё нет — этот тап даст его, и
      // следующий play() в useEffect выше сработает уже без блокировок.
      if (!next && audioRef.current) {
        audioRef.current.play().then(() => {
          audioRef.current?.pause();
          if (audioRef.current) audioRef.current.currentTime = 0;
        }).catch(() => {});
      }
      return next;
    });
  }

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
    // position:fixed жёстко привязывает корень inbox-view к видимой области
    // viewport, без зависимости от body-скролла и от viewport units (svh/dvh
    // на iPad Safari при viewportFit:cover ведут себя непредсказуемо).
    //   top:52px  — под Topbar (sticky 52px высотой)
    //   left:0    — на mobile, md:left-[232px] — за Sidebar (232px на md+)
    //   right:0, bottom:0 — до правого/нижнего края экрана
    // Composer внутри (sticky bottom-0) всегда виден ровно над home indicator.
    <div className="fixed top-[52px] left-0 md:left-[232px] right-0 bottom-0 flex min-h-0 overflow-hidden bg-bg z-30">
      {/* Левая колонка — каналы */}
      <div className="w-56 border-r border-line bg-paper hidden lg:flex flex-col shrink-0 min-h-0">
        <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-2">
          {/* Заголовок "КАНАЛЫ" — navy брендовый */}
          <h2 className="text-[11px] font-bold uppercase tracking-[0.06em] text-navy">
            Каналы
          </h2>
          <button
            type="button"
            onClick={toggleMute}
            className={cn(
              'w-7 h-7 rounded-md grid place-items-center transition-colors shrink-0',
              muted
                ? 'text-ink-4 hover:text-navy hover:bg-navy/[0.04]'
                : 'text-success hover:bg-success/10',
            )}
            title={muted ? 'Звук выключен — нажмите чтобы включить' : 'Звук включён — нажмите чтобы выключить'}
            aria-label={muted ? 'Включить звук уведомлений' : 'Выключить звук уведомлений'}
          >
            {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto thin-scroll p-2 min-h-0">
          <Link
            href="/inbox"
            className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-md text-[12.5px] transition-colors',
              // "Все" активно когда channel-параметра нет
              activeChannelId === null
                ? 'bg-navy text-white font-semibold'
                : 'hover:bg-navy/[0.04] hover:text-navy',
            )}
          >
            <MessageSquare size={13} className={activeChannelId === null ? 'text-white' : 'text-ink-3'} />
            <span className="flex-1">Все</span>
          </Link>
          {accounts.map((a) => {
            const isActive = activeChannelId === a.id;
            return (
              <Link
                key={a.id}
                href={`/inbox?channel=${a.id}`}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-md text-[12.5px] transition-colors',
                  isActive
                    ? 'bg-navy text-white font-semibold'
                    : 'hover:bg-navy/[0.04] hover:text-navy',
                )}
              >
                <span className={cn(
                  'w-1.5 h-1.5 rounded-full shrink-0',
                  a.isConnected ? 'bg-success' : 'bg-ink-5',
                )} />
                <div className="flex-1 min-w-0">
                  <div className={cn('truncate', isActive ? 'text-white' : 'text-ink')}>{a.label}</div>
                  <div className={cn(
                    'text-[10.5px] font-mono truncate',
                    isActive ? 'text-white/70' : 'text-ink-4',
                  )}>{a.phoneNumber}</div>
                </div>
              </Link>
            );
          })}

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
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy/40" />
            <input
              type="text"
              placeholder="Поиск..."
              className="w-full pl-8 pr-3 py-1.5 text-[12.5px] bg-bg border border-transparent rounded-md focus:bg-paper focus:border-navy focus:outline-none"
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
                  // Активный тред — лёгкий navy фон + navy левый бордер
                  activeThreadId === t.id
                    ? 'bg-navy/[0.06] border-l-[3px] border-l-navy pl-[9px]'
                    : 'hover:bg-navy/[0.02]',
                )}
              >
                <Avatar name={t.clientName} size="md" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2 mb-0.5">
                    <span className={cn(
                      'text-[13px] truncate',
                      t.unreadCount > 0
                        ? 'font-bold text-navy'
                        : activeThreadId === t.id
                          ? 'font-bold text-navy'
                          : 'font-semibold text-ink-2',
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
                        <span className="text-[9.5px] px-1 py-px bg-navy/[0.06] text-navy/70 rounded font-semibold border border-navy/10">
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
              <MessageSquare size={36} className="mx-auto text-navy/30 mb-3" />
              <p className="text-[13px] text-navy/60">Выберите чат для просмотра</p>
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
      {/* Шапка чата — имя клиента navy брендовый */}
      <div className="bg-paper border-b border-line h-12 flex items-center gap-3 px-3 shrink-0">
        <Link
          href="/inbox"
          className="sm:hidden w-8 h-8 rounded-md grid place-items-center text-ink-3 hover:text-navy hover:bg-navy/[0.04]"
        >
          <ChevronLeft size={16} />
        </Link>
        <Avatar name={thread.clientName} size="sm" />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-bold text-navy truncate">{thread.clientName}</div>
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
                <span className="text-[10.5px] px-2.5 py-0.5 bg-paper border border-navy/15 rounded-full text-navy/70 font-semibold">
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

      {/* Композер — shrink-0 + sticky bottom-0 как страховка если родитель плывёт.
          pb-[env(safe-area-inset-bottom)] — отступ под home indicator на iPhone/iPad. */}
      <form onSubmit={send} className="bg-paper border-t border-line px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] shrink-0 sticky bottom-0 z-10">
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
            className="w-9 h-9 rounded-md text-ink-4 hover:text-navy grid place-items-center transition-colors"
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
            className="flex-1 resize-none px-3 py-2 text-[13px] bg-bg border border-transparent rounded-md focus:bg-paper focus:border-navy focus:outline-none max-h-[120px]"
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
              <h3 className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-navy/70 mb-1.5 px-1">
                {cat}
              </h3>
              <div className="flex flex-col gap-1">
                {items.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onPick(t.id)}
                    className="text-left p-2.5 rounded-md border border-line hover:border-navy/40 hover:bg-navy/[0.02] transition-colors"
                  >
                    <div className="text-[13px] font-semibold text-navy mb-0.5">{t.name}</div>
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
