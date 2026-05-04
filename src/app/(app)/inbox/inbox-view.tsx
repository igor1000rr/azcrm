'use client';

// Inbox — три колонки: каналы / треды / переписка.
// Поддерживает WhatsApp, Telegram, Viber, Facebook Messenger, Instagram Direct.
// Иконка канала с цветом — рядом с каждым тредом и в шапке чата.
// Отправка идёт на универсальный POST /api/messages/thread-send,
// который сам определяет kind из thread.channel.

import { useState, useRef, useEffect, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Send, Paperclip, Search, MessageSquare,
  ChevronLeft, FileText, Sparkles, Volume2, VolumeX,
  Smartphone, MessageCircle, Facebook, Instagram, Plus,
  X, Loader2,
} from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Modal } from '@/components/ui/modal';
import { cn, formatTime, formatPhone, formatDate, formatFileSize } from '@/lib/utils';
import { NOTIFY_SOUND_DATA_URL } from './notify-sound';

type ChannelKindStr = 'WHATSAPP' | 'TELEGRAM' | 'VIBER' | 'MESSENGER' | 'INSTAGRAM';

interface AccountLite {
  kind:        ChannelKindStr;
  id:          string;
  label:       string;
  subtitle:    string;
  isConnected: boolean;
  ownerId:     string | null;
}

interface ThreadLite {
  id: string;
  kind: ChannelKindStr;
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
    id: string; kind: ChannelKindStr; clientId: string | null;
    clientName: string; clientPhone: string; leadId: string | null;
  } | null;
}

/** Цветная иконка канала — единый стиль во всём inbox. */
function ChannelIcon({ kind, size = 11 }: { kind: ChannelKindStr; size?: number }) {
  switch (kind) {
    case 'WHATSAPP':  return <Smartphone size={size} style={{ color: '#25D366' }} />;
    case 'TELEGRAM':  return <Send size={size} style={{ color: '#229ED9' }} />;
    case 'VIBER':     return <MessageCircle size={size} style={{ color: '#7360F2' }} />;
    case 'MESSENGER': return <Facebook size={size} style={{ color: '#1877F2' }} />;
    case 'INSTAGRAM': return <Instagram size={size} style={{ color: '#E4405F' }} />;
  }
}

export function InboxView({
  accounts, threads, activeChannelId, activeThreadId, activeMessages, activeThread,
}: InboxViewProps) {
  const router = useRouter();

  // Звук уведомлений (см. оригинальный комментарий)
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
    if (prev === null) return;
    if (total > prev && !muted && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    }
  }, [threads, muted]);

  function toggleMute() {
    setMuted((m) => {
      const next = !m;
      try { localStorage.setItem('inbox.muted', next ? '1' : '0'); } catch {}
      if (!next && audioRef.current) {
        audioRef.current.play().then(() => {
          audioRef.current?.pause();
          if (audioRef.current) audioRef.current.currentTime = 0;
        }).catch(() => {});
      }
      return next;
    });
  }

  // Авто-обновление каждые 5 сек когда вкладка в фокусе
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (intervalId) return;
      intervalId = setInterval(() => {
        if (document.visibilityState === 'visible') router.refresh();
      }, 5000);
    };
    const stop = () => { if (intervalId) { clearInterval(intervalId); intervalId = null; } };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') { router.refresh(); start(); }
      else stop();
    };
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [router]);

  return (
    <div className="fixed top-[52px] left-0 md:left-[232px] right-0 bottom-0 flex min-h-0 overflow-hidden bg-bg z-30">
      {/* Левая колонка — каналы */}
      <div className="w-56 border-r border-line bg-paper hidden lg:flex flex-col shrink-0 min-h-0">
        <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-2">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.06em] text-navy">Каналы</h2>
          <button
            type="button"
            onClick={toggleMute}
            className={cn(
              'w-7 h-7 rounded-md grid place-items-center transition-colors shrink-0',
              muted ? 'text-ink-4 hover:text-navy hover:bg-navy/[0.04]' : 'text-success hover:bg-success/10',
            )}
            title={muted ? 'Звук выключен' : 'Звук включён'}
            aria-label={muted ? 'Включить звук' : 'Выключить звук'}
          >
            {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto thin-scroll p-2 min-h-0">
          <Link
            href="/inbox"
            className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-md text-[12.5px] transition-colors',
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
                  isActive ? 'bg-navy text-white font-semibold' : 'hover:bg-navy/[0.04] hover:text-navy',
                )}
              >
                <ChannelIcon kind={a.kind} size={12} />
                <span className={cn(
                  'w-1.5 h-1.5 rounded-full shrink-0',
                  a.isConnected ? 'bg-success' : 'bg-ink-5',
                )} />
                <div className="flex-1 min-w-0">
                  <div className={cn('truncate', isActive ? 'text-white' : 'text-ink')}>{a.label}</div>
                  <div className={cn(
                    'text-[10.5px] font-mono truncate',
                    isActive ? 'text-white/70' : 'text-ink-4',
                  )}>{a.subtitle}</div>
                </div>
              </Link>
            );
          })}

          <Link href="/settings/channels" className="block mt-3 px-3 py-2 text-[11.5px] text-info hover:underline">
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
            <div className="text-center p-8 text-[13px] text-ink-4">Переписок пока нет</div>
          ) : (
            threads.map((t) => (
              <Link
                key={t.id}
                href={`/inbox?thread=${t.id}`}
                className={cn(
                  'flex gap-2.5 px-3 py-2.5 border-b border-line-2 transition-colors',
                  activeThreadId === t.id
                    ? 'bg-navy/[0.06] border-l-[3px] border-l-navy pl-[9px]'
                    : 'hover:bg-navy/[0.02]',
                )}
              >
                <Avatar name={t.clientName} size="md" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2 mb-0.5">
                    <span className={cn(
                      'text-[13px] truncate flex items-center gap-1.5',
                      t.unreadCount > 0
                        ? 'font-bold text-navy'
                        : activeThreadId === t.id ? 'font-bold text-navy' : 'font-semibold text-ink-2',
                    )}>
                      <ChannelIcon kind={t.kind} size={11} />
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
          <ChatPane thread={activeThread} messages={activeMessages} />
        )}
      </div>
    </div>
  );
}

interface AttachedFile {
  url:       string;
  name:      string;
  size:      number;
  mediaType: 'IMAGE' | 'DOCUMENT';
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
  // Anna 04.05.2026: «Не добавляются документы в переписку». Раньше Paperclip
  // была декоративной (без onClick) — теперь полноценная загрузка через
  // /api/files/upload (требует clientId) + /api/messages/thread-send с
  // mediaUrl/mediaName/mediaType. Аналогично lead-chat-panel в карточке.
  const [attached, setAttached]   = useState<AttachedFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [messages.length]);

  // Прикрепить файл. Файл попадает в "Файлы клиента" (через clientId) и
  // одновременно держим ссылку в стейте чтобы потом отправить как mediaUrl.
  // Если у thread'а нет clientId (внешний контакт без созданного клиента) —
  // прикрепление не работает. Это редкий кейс — обычно клиент создаётся
  // автоматически при первом входящем (см. webhook handlers).
  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!thread.clientId) {
      alert('Клиент ещё не оформлен — нельзя прикрепить файл. Сначала создайте лид через кнопку «Создать лид» в шапке.');
      e.target.value = '';
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      alert('Файл больше 50 МБ');
      e.target.value = '';
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('clientId', thread.clientId);
      fd.append('category', 'GENERAL');
      const res = await fetch('/api/files/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не удалось загрузить файл');
      const mediaType: 'IMAGE' | 'DOCUMENT' = (data.mimeType as string | null)?.startsWith('image/') ? 'IMAGE' : 'DOCUMENT';
      setAttached({ url: data.url, name: data.name, size: data.size, mediaType });
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setUploading(false);
      if (e.target) e.target.value = '';
    }
  }

  function clearAttached() { setAttached(null); }

  async function send(e: FormEvent) {
    e.preventDefault();
    if (sending) return;
    const trimmed = body.trim();
    if (!trimmed && !attached) return;
    setSending(true);
    try {
      // Универсальный endpoint — kind определяется из thread.channel в БД
      const res = await fetch('/api/messages/thread-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: thread.id,
          body:     trimmed,
          ...(attached ? {
            mediaUrl:  attached.url,
            mediaName: attached.name,
            mediaType: attached.mediaType,
          } : {}),
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        alert(data.error || 'Не удалось отправить');
      } else {
        setBody('');
        setAttached(null);
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

  // Для не-WhatsApp каналов phone может быть пустой (используется externalId)
  const showPhone = thread.kind === 'WHATSAPP' && thread.clientPhone;
  const canSend = !sending && !uploading && (body.trim().length > 0 || !!attached);
  const onlyWaSupportsFiles = thread.kind !== 'WHATSAPP';

  return (
    <>
      {/* Шапка чата */}
      <div className="bg-paper border-b border-line h-12 flex items-center gap-3 px-3 shrink-0">
        <Link
          href="/inbox"
          className="sm:hidden w-8 h-8 rounded-md grid place-items-center text-ink-3 hover:text-navy hover:bg-navy/[0.04]"
        >
          <ChevronLeft size={16} />
        </Link>
        <Avatar name={thread.clientName} size="sm" />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-bold text-navy truncate flex items-center gap-1.5">
            <ChannelIcon kind={thread.kind} size={11} />
            {thread.clientName}
          </div>
          <div className="text-[11px] text-ink-4 font-mono">
            {showPhone ? formatPhone(thread.clientPhone) : channelLabel(thread.kind)}
          </div>
        </div>
        {/*
          Если у клиента уже есть лид (thread.leadId) — кнопка ведёт в карточку лида.
          Если лида ещё нет (новый клиент написал — но менеджер пока не оформил) —
          предлагаем создать его через готовую форму /clients/new (Anna 01.05.2026).
          В форме можно выбрать воронку и этап.
        */}
        {thread.leadId ? (
          <Link
            href={`/clients/${thread.leadId}`}
            className="text-[12px] text-info hover:underline shrink-0"
          >
            Открыть карточку →
          </Link>
        ) : thread.clientId ? (
          <Link
            href={`/clients/new?clientId=${thread.clientId}`}
            className="text-[12px] font-semibold text-success hover:underline shrink-0 flex items-center gap-1"
          >
            <Plus size={12} />
            Создать лид
          </Link>
        ) : null}
      </div>

      {/* Сообщения */}
      <div className="flex-1 overflow-y-auto thin-scroll px-3 py-3 min-h-0">
        {grouped.length === 0 ? (
          <div className="text-center text-[13px] text-ink-4 py-12">Сообщений пока нет</div>
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

      {/* Композер */}
      <form onSubmit={send} className="bg-paper border-t border-line px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] shrink-0 sticky bottom-0 z-10">
        {/* Превью прикреплённого файла — над инпутом */}
        {attached && (
          <div className="mb-2 flex items-center gap-2 px-2.5 py-1.5 bg-bg border border-line rounded-md">
            <FileText size={13} className="text-info shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-semibold text-ink truncate">{attached.name}</div>
              <div className="text-[10.5px] text-ink-4">
                {formatFileSize(attached.size)}
                {onlyWaSupportsFiles && (
                  <span className="ml-2 text-warn">(в {channelLabel(thread.kind)} файл уйдёт ссылкой)</span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={clearAttached}
              className="text-ink-4 hover:text-danger transition-colors p-1"
              title="Удалить вложение"
            >
              <X size={12} />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => setTemplatesOpen(true)}
            className="w-9 h-9 rounded-md text-ink-4 hover:text-gold hover:bg-gold-pale grid place-items-center transition-colors"
            title="Шаблон сообщения"
          >
            <Sparkles size={15} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            onChange={onPickFile}
            className="hidden"
            disabled={uploading || sending}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || sending || !!attached || !thread.clientId}
            className="w-9 h-9 rounded-md text-ink-4 hover:text-navy grid place-items-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={
              !thread.clientId
                ? 'Сначала создайте лид'
                : attached
                ? 'Уже прикреплён файл'
                : 'Прикрепить файл'
            }
          >
            {uploading ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}
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
            placeholder={attached ? 'Подпись к файлу (необязательно)' : 'Напишите сообщение...'}
            className="flex-1 resize-none px-3 py-2 text-[13px] bg-bg border border-transparent rounded-md focus:bg-paper focus:border-navy focus:outline-none max-h-[120px]"
          />
          <button
            type="submit"
            disabled={!canSend}
            className={cn(
              'w-9 h-9 rounded-md grid place-items-center transition-colors',
              canSend
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

function channelLabel(kind: ChannelKindStr): string {
  return ({
    WHATSAPP:  'WhatsApp',
    TELEGRAM:  'Telegram',
    VIBER:     'Viber',
    MESSENGER: 'Messenger',
    INSTAGRAM: 'Instagram',
  })[kind];
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

/** Bubble изображения с белым фоном и fallback'ом на ссылку при ошибке загрузки.
 *  Anna 04.05.2026: «Картинка не отправляется адекватно» — в bubble показывался
 *  пустой тёмный квадрат потому что PNG был с прозрачным/тёмным фоном на bg-navy.
 *  bg-white под картинкой — видно любой PNG. onError — если URL вовсе
 *  не загрузился (auth/404), показываем явную ссылку вместо невидимого пустого прямоугольника. */
function ImageMessage({ src, name, isOut }: { src: string; name: string | null; isOut: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        className={cn(
          'flex items-center gap-2 text-[12px] underline mb-1',
          isOut ? 'text-white/90' : 'text-info',
        )}
      >
        <FileText size={12} /> {name || 'Открыть изображение'}
      </a>
    );
  }
  return (
    <a href={src} target="_blank" rel="noreferrer" className="block mb-1">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={name || ''}
        loading="lazy"
        onError={() => setFailed(true)}
        className="rounded max-w-full bg-white"
      />
    </a>
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
          <ImageMessage src={m.mediaUrl} name={m.mediaName} isOut={isOut} />
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
