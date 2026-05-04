'use client';

// Объединённая переписка по клиенту в карточке лида.
// Показывает сообщения со всех каналов (WhatsApp/Telegram/Viber/Messenger/Instagram)
// в одной ленте, с пометкой канала рядом с каждым сообщением.
// Снизу — селектор канала, кнопка прикрепить файл и поле ввода.
//
// Отправка идёт через единый POST /api/messages/lead-send который роутит
// по `kind` канала. Файлы загружаются через POST /api/files/upload
// и затем шлются как mediaUrl/mediaName/mediaType (Anna 04.05.2026).
//
// Права (через бэк, мы только отображаем доступные):
//   ADMIN — все активные каналы
//   SALES / LEGAL — свои (ownerId == user.id) + общие (ownerId == null)

import { useState, useRef, useEffect, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  Send, FileText, MessageSquare, ChevronDown,
  Smartphone, MessageCircle, Facebook, Instagram,
  Paperclip, X, Loader2,
} from 'lucide-react';
import { cn, formatTime, formatDate, formatFileSize } from '@/lib/utils';

export type ChannelKindStr = 'WHATSAPP' | 'TELEGRAM' | 'VIBER' | 'MESSENGER' | 'INSTAGRAM';

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
  kind:         ChannelKindStr;
  accountId:    string;
  accountLabel: string;
}

export interface LeadChatAccount {
  kind:         ChannelKindStr;
  accountId:    string;
  label:        string;
  subtitle:     string | null;
  isConnected:  boolean;
  isShared:     boolean;
}

interface Props {
  leadId:           string;
  clientId:         string;
  clientName:       string;
  messages:         LeadChatMessage[];
  availableAccounts: LeadChatAccount[];
}

interface AttachedFile {
  url:       string;
  name:      string;
  size:      number;
  mediaType: 'IMAGE' | 'DOCUMENT';
}

function accountKey(a: { kind: ChannelKindStr; accountId: string }): string {
  return `${a.kind}:${a.accountId}`;
}

export function LeadChatPanel({
  leadId, clientId, clientName, messages, availableAccounts,
}: Props) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [attached, setAttached] = useState<AttachedFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const defaultKey = pickDefaultAccount(messages, availableAccounts);
  const [selectedKey, setSelectedKey] = useState(defaultKey);

  useEffect(() => {
    if (selectedKey && availableAccounts.some((a) => accountKey(a) === selectedKey)) {
      return;
    }
    setSelectedKey(pickDefaultAccount(messages, availableAccounts));
  }, [availableAccounts, messages, selectedKey]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [messages.length]);

  const selectedAccount = availableAccounts.find((a) => accountKey(a) === selectedKey);

  // Прикрепить файл: грузим в /api/files/upload (он же добавит файл
  // в карточку клиента — это плюс, юзер потом найдёт его в «Файлы клиента»),
  // получаем url + mimeType, кладём в стейт. Ничего не отправляем пока
  // юзер не нажмёт «Отправить».
  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      alert('Файл больше 50 МБ');
      e.target.value = '';
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('clientId', clientId);
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
    if (sending || !selectedAccount) return;
    const trimmed = body.trim();
    if (!trimmed && !attached) return;
    setSending(true);
    try {
      const res = await fetch('/api/messages/lead-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId,
          kind:      selectedAccount.kind,
          accountId: selectedAccount.accountId,
          body:      trimmed,
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

  // Группировка по дням для красивых разделителей
  const grouped: Array<{ date: string; items: LeadChatMessage[] }> = [];
  for (const m of messages) {
    const day = m.createdAt.slice(0, 10);
    const last = grouped[grouped.length - 1];
    if (last && last.date === day) last.items.push(m);
    else grouped.push({ date: day, items: [m] });
  }

  const canSend = !!selectedAccount?.isConnected && !sending && !uploading && (body.trim().length > 0 || !!attached);
  const onlyWaSupportsFiles = selectedAccount && selectedAccount.kind !== 'WHATSAPP';

  return (
    <div className="bg-paper border border-line rounded-lg flex flex-col overflow-hidden" data-testid="chat-panel">
      {/* Шапка */}
      <div className="px-4 py-2.5 border-b border-line flex items-center gap-2 bg-bg" data-testid="chat-header">
        <MessageSquare size={14} className="text-ink-3" />
        <h3 className="text-[12.5px] font-bold uppercase tracking-[0.05em] text-ink-2">
          Переписки с {clientName}
        </h3>
        <span className="ml-auto text-[11px] text-ink-4" data-testid="chat-stats">
          {messages.length} {pluralizeMsg(messages.length)} · {countChannels(messages)} {pluralizeChannel(countChannels(messages))}
        </span>
      </div>

      {/* Лента сообщений */}
      <div className="h-[480px] overflow-y-auto thin-scroll px-3 py-3 bg-bg" data-testid="messages-list">
        {grouped.length === 0 ? (
          <div className="h-full grid place-items-center text-center text-[13px] text-ink-4" data-testid="empty-state">
            <div>
              <MessageSquare size={32} className="mx-auto text-ink-5 mb-2" />
              <div>Переписок с этим клиентом пока нет</div>
              <div className="text-[11.5px] mt-1">Напишите первое сообщение ниже</div>
            </div>
          </div>
        ) : (
          grouped.map((g) => (
            <div key={g.date} data-testid={`day-group-${g.date}`}>
              <div className="text-center my-3">
                <span className="text-[10.5px] px-2.5 py-0.5 bg-paper border border-line rounded-full text-ink-3 font-medium" data-testid={`day-label-${g.date}`}>
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

      {/* Композер */}
      <form onSubmit={send} className="border-t border-line px-3 py-2.5" data-testid="composer">
        {availableAccounts.length === 0 ? (
          <div className="text-[12px] text-ink-4 text-center py-2" data-testid="no-channels">
            Нет доступных каналов для отправки сообщения
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-[11px] text-ink-4 shrink-0">Отправить через:</span>
              <ChannelSelect
                accounts={availableAccounts}
                selectedKey={selectedKey}
                onChange={setSelectedKey}
              />
              {selectedAccount && !selectedAccount.isConnected && (
                <span className="text-[10.5px] text-warn" data-testid="not-connected-warn">канал не подключён</span>
              )}
            </div>

            {/* Превью прикреплённого файла */}
            {attached && (
              <div className="mb-2 flex items-center gap-2 px-2.5 py-1.5 bg-bg border border-line rounded-md" data-testid="attached-preview">
                <FileText size={13} className="text-info shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-semibold text-ink truncate">{attached.name}</div>
                  <div className="text-[10.5px] text-ink-4">
                    {formatFileSize(attached.size)}
                    {onlyWaSupportsFiles && <span className="ml-2 text-warn">(в {channelLabel(selectedAccount.kind)} файл уйдёт ссылкой)</span>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={clearAttached}
                  className="text-ink-4 hover:text-danger transition-colors p-1"
                  title="Удалить вложение"
                  data-testid="clear-attached"
                >
                  <X size={12} />
                </button>
              </div>
            )}

            <div className="flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                onChange={onPickFile}
                className="hidden"
                disabled={uploading || sending}
                data-testid="file-input"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || sending || !!attached}
                className="h-9 w-9 rounded-md grid place-items-center text-ink-4 hover:text-navy hover:bg-bg disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                title={attached ? 'Уже прикреплён файл' : 'Прикрепить файл'}
                data-testid="attach-btn"
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
                rows={2}
                placeholder={attached ? 'Подпись к файлу (необязательно)' : 'Напишите сообщение...'}
                className="flex-1 resize-none px-3 py-2 text-[13px] bg-bg border border-line rounded-md focus:bg-paper focus:border-navy focus:outline-none max-h-[120px]"
                disabled={!selectedAccount || !selectedAccount.isConnected}
                data-testid="msg-input"
              />
              <button
                type="submit"
                data-testid="send-btn"
                disabled={!canSend}
                className={cn(
                  'h-9 px-3 rounded-md flex items-center gap-1.5 text-[12.5px] font-semibold transition-colors',
                  canSend
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

function channelLabel(kind: ChannelKindStr): string {
  return ({
    WHATSAPP:  'WhatsApp',
    TELEGRAM:  'Telegram',
    VIBER:     'Viber',
    MESSENGER: 'Messenger',
    INSTAGRAM: 'Instagram',
  })[kind];
}

/** Иконка канала — показывается в селекторе и в bubble. */
function ChannelIcon({ kind, size = 11 }: { kind: ChannelKindStr; size?: number }) {
  switch (kind) {
    case 'WHATSAPP':  return <Smartphone size={size} style={{ color: '#25D366' }} />;
    case 'TELEGRAM':  return <Send size={size} style={{ color: '#229ED9' }} />;
    case 'VIBER':     return <MessageCircle size={size} style={{ color: '#7360F2' }} />;
    case 'MESSENGER': return <Facebook size={size} style={{ color: '#1877F2' }} />;
    case 'INSTAGRAM': return <Instagram size={size} style={{ color: '#E4405F' }} />;
  }
}

function ChannelSelect({
  accounts, selectedKey, onChange,
}: {
  accounts: LeadChatAccount[];
  selectedKey: string | null;
  onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const selected = accounts.find((a) => accountKey(a) === selectedKey);

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
        data-testid="channel-select-btn"
        className="flex items-center gap-1.5 px-2 py-1 text-[12px] bg-bg border border-line rounded-md hover:bg-paper hover:border-ink-5 transition-colors"
      >
        {selected ? (
          <>
            <ChannelIcon kind={selected.kind} />
            <span className={cn(
              'w-1.5 h-1.5 rounded-full shrink-0',
              selected.isConnected ? 'bg-success' : 'bg-warn',
            )} data-testid="selected-status-dot" />
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
        <div className="absolute z-30 top-full left-0 mt-1 min-w-[260px] bg-paper border border-line rounded-md shadow-lg py-1" data-testid="channel-dropdown">
          {accounts.map((a) => {
            const key = accountKey(a);
            return (
              <button
                key={key}
                type="button"
                data-testid={`channel-option-${key}`}
                onClick={() => { onChange(key); setOpen(false); }}
                className={cn(
                  'w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] text-left hover:bg-bg',
                  selectedKey === key && 'bg-bg',
                )}
              >
                <ChannelIcon kind={a.kind} />
                <span className={cn(
                  'w-1.5 h-1.5 rounded-full shrink-0',
                  a.isConnected ? 'bg-success' : 'bg-ink-5',
                )} />
                <span className="flex-1 min-w-0">
                  <span className="font-semibold text-ink">{a.label}</span>
                  {a.subtitle && (
                    <span className="ml-1.5 text-ink-4 font-mono text-[10.5px]">{a.subtitle}</span>
                  )}
                </span>
                {a.isShared && (
                  <span className="text-[10px] text-ink-4 px-1 bg-bg-alt rounded">общий</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Bubble изображения с белым фоном и fallback'ом на ссылку при ошибке загрузки.
 *  Anna 04.05.2026: PNG не отображался в bubble — сливался с фоном bg-navy. */
function ImageMessage({ src, name, isOut, msgId }: { src: string; name: string | null; isOut: boolean; msgId: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        data-testid={`bubble-img-failed-${msgId}`}
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
        data-testid={`bubble-img-${msgId}`}
      />
    </a>
  );
}

function Bubble({ m }: { m: LeadChatMessage }) {
  const isOut = m.direction === 'OUT';
  return (
    <div className={cn('flex mb-1', isOut ? 'justify-end' : 'justify-start')} data-testid={`bubble-${m.id}`}>
      <div className={cn(
        'max-w-[85%] sm:max-w-[70%] px-3 py-1.5 rounded-2xl text-[13px] break-words',
        isOut
          ? 'bg-navy text-white rounded-br-sm'
          : 'bg-paper border border-line text-ink rounded-bl-sm',
      )}>
        <div className={cn(
          'flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-[0.04em] mb-0.5',
          isOut ? 'text-white/70' : 'text-ink-4',
        )} data-testid={`bubble-label-${m.id}`}>
          <ChannelIcon kind={m.kind} size={9} />
          <span>{m.accountLabel}</span>
          {m.senderName && isOut && <span>· {m.senderName}</span>}
        </div>

        {m.type === 'IMAGE' && m.mediaUrl && (
          <ImageMessage src={m.mediaUrl} name={m.mediaName} isOut={isOut} msgId={m.id} />
        )}
        {m.type === 'DOCUMENT' && m.mediaUrl && (
          <a
            href={m.mediaUrl}
            target="_blank"
            rel="noreferrer"
            data-testid={`bubble-doc-${m.id}`}
            className={cn(
              'flex items-center gap-2 text-[12px] underline mb-1',
              isOut ? 'text-white/90' : 'text-info',
            )}
          >
            <FileText size={12} /> {m.mediaName || 'Документ'}
          </a>
        )}
        {m.body && <div className="whitespace-pre-wrap" data-testid={`bubble-body-${m.id}`}>{m.body}</div>}
        <div className={cn(
          'text-[10px] mt-0.5 text-right opacity-70',
          isOut ? 'text-white/70' : 'text-ink-4',
        )} data-testid={`bubble-meta-${m.id}`}>
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

/** По умолчанию выбираем канал последнего входящего, если он доступен. */
function pickDefaultAccount(
  messages: LeadChatMessage[],
  accounts: LeadChatAccount[],
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const matchKey = `${m.kind}:${m.accountId}`;
    if (m.direction === 'IN' && accounts.some((a) => accountKey(a) === matchKey)) {
      return matchKey;
    }
  }
  const connected = accounts.find((a) => a.isConnected);
  if (connected) return accountKey(connected);
  return accounts[0] ? accountKey(accounts[0]) : null;
}

function countChannels(messages: LeadChatMessage[]): number {
  const set = new Set(messages.map((m) => `${m.kind}:${m.accountId}`));
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
