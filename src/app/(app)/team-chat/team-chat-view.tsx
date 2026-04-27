'use client';

// UI: внутренние чаты — 2 колонки (список / переписка)
import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Send, MessageSquarePlus, Users, ChevronLeft, X, Search,
} from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Input, FormField } from '@/components/ui/input';
import {
  cn, formatTime, formatDate, formatRelative,
} from '@/lib/utils';
import {
  openDirectChat, createGroupChat, sendTeamChatMessage,
} from './actions';
import type { UserRole, TeamChatKind } from '@prisma/client';

interface ChatLite {
  id: string;
  kind: TeamChatKind;
  title: string;
  otherMembers: Array<{ id: string; name: string; role: UserRole }>;
  lastMessageText: string | null;
  lastMessageAt: string | null;
  unread: number;
}

interface MessageLite {
  id: string;
  body: string;
  authorId: string;
  authorName: string;
  createdAt: string;
  isMine: boolean;
}

interface Props {
  currentUserId: string;
  chats: ChatLite[];
  team: Array<{ id: string; name: string; role: UserRole; email: string }>;
  activeChatId: string | null;
  activeChatTitle: string | null;
  activeChatMembers: Array<{ id: string; name: string; role: UserRole }>;
  activeMessages: MessageLite[];
}

export function TeamChatView({
  currentUserId, chats, team, activeChatId, activeChatTitle, activeChatMembers, activeMessages,
}: Props) {
  const [creating, setCreating] = useState<'direct' | 'group' | null>(null);

  return (
    <div className="flex-1 flex h-[calc(100dvh-52px)] overflow-hidden">

      {/* Список чатов */}
      <div className={cn(
        'border-r border-line bg-paper flex flex-col shrink-0',
        'w-full sm:w-[320px]',
        activeChatId && 'hidden sm:flex',
      )}>
        <div className="px-3 py-2.5 border-b border-line flex items-center gap-2">
          <h2 className="text-[13px] font-bold tracking-tight">Чат команды</h2>
          <div className="ml-auto flex gap-1">
            <Button size="sm" onClick={() => setCreating('direct')} title="Личный чат">
              <MessageSquarePlus size={11} />
            </Button>
            <Button size="sm" onClick={() => setCreating('group')} title="Группа">
              <Users size={11} />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto thin-scroll">
          {chats.length === 0 ? (
            <div className="text-center p-8 text-[13px] text-ink-4">
              Чатов пока нет.<br />
              Начните личный или групповой.
            </div>
          ) : (
            chats.map((c) => (
              <Link
                key={c.id}
                href={`/team-chat?chat=${c.id}`}
                className={cn(
                  'flex gap-2.5 px-3 py-2.5 border-b border-line-2 transition-colors',
                  activeChatId === c.id ? 'bg-bg-alt' : 'hover:bg-bg',
                )}
              >
                {c.kind === 'GROUP' ? (
                  <div className="w-10 h-10 rounded-full bg-gold-pale text-gold grid place-items-center shrink-0">
                    <Users size={14} />
                  </div>
                ) : (
                  <Avatar name={c.title} size="md" variant="navy" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2 mb-0.5">
                    <span className={cn(
                      'text-[13px] truncate',
                      c.unread > 0 ? 'font-bold text-ink' : 'font-semibold text-ink-2',
                    )}>
                      {c.title}
                    </span>
                    {c.lastMessageAt && (
                      <span className="text-[10.5px] text-ink-4 shrink-0">
                        {formatRelativeShort(c.lastMessageAt)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-[11.5px] text-ink-3 truncate flex-1">
                      {c.lastMessageText || 'Нет сообщений'}
                    </p>
                    {c.unread > 0 && (
                      <span className="w-2 h-2 rounded-full bg-navy shrink-0" />
                    )}
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>

      {/* Переписка */}
      <div className={cn(
        'flex-1 bg-bg flex flex-col min-w-0',
        !activeChatId && 'hidden sm:flex',
      )}>
        {!activeChatId ? (
          <div className="flex-1 grid place-items-center text-center p-6">
            <div>
              <Users size={36} className="mx-auto text-ink-5 mb-3" />
              <p className="text-[13px] text-ink-3">Выберите чат для просмотра</p>
            </div>
          </div>
        ) : (
          <ChatPane
            chatId={activeChatId}
            title={activeChatTitle ?? '?'}
            members={activeChatMembers}
            currentUserId={currentUserId}
            messages={activeMessages}
          />
        )}
      </div>

      {creating === 'direct' && (
        <DirectChatModal team={team} onClose={() => setCreating(null)} />
      )}
      {creating === 'group' && (
        <GroupChatModal team={team} onClose={() => setCreating(null)} />
      )}
    </div>
  );
}

function ChatPane({
  chatId, title, members, currentUserId, messages,
}: {
  chatId: string;
  title: string;
  members: Array<{ id: string; name: string; role: UserRole }>;
  currentUserId: string;
  messages: MessageLite[];
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Авто-скролл вниз
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [messages.length]);

  // Polling каждые 5 сек на новые сообщения
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [router]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!body.trim() || sending) return;
    setSending(true);
    try {
      await sendTeamChatMessage({ chatId, body: body.trim() });
      setBody('');
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSending(false);
    }
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
      <div className="bg-paper border-b border-line h-12 flex items-center gap-3 px-3 shrink-0">
        <Link
          href="/team-chat"
          className="sm:hidden w-8 h-8 rounded-md grid place-items-center text-ink-3 hover:text-ink hover:bg-bg"
        >
          <ChevronLeft size={16} />
        </Link>
        <Avatar name={title} size="sm" variant="navy" />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-ink truncate">{title}</div>
          <div className="text-[10.5px] text-ink-4">
            {members.length} {plural(members.length, 'участник', 'участника', 'участников')}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto thin-scroll px-3 py-3">
        {grouped.length === 0 ? (
          <div className="text-center text-[13px] text-ink-4 py-12">
            Сообщений пока нет — напишите первое
          </div>
        ) : (
          grouped.map((g) => (
            <div key={g.date}>
              <div className="text-center my-3">
                <span className="text-[10.5px] px-2.5 py-0.5 bg-paper border border-line rounded-full text-ink-3 font-medium">
                  {formatDateLabel(g.date)}
                </span>
              </div>
              {g.items.map((m, i) => {
                const showAuthor = !m.isMine && (
                  i === 0 || g.items[i - 1].authorId !== m.authorId
                );
                return <Bubble key={m.id} m={m} showAuthor={showAuthor} />;
              })}
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={send} className="bg-paper border-t border-line px-3 py-2.5 shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e as unknown as FormEvent); }
            }}
            rows={1}
            placeholder="Сообщение..."
            className="flex-1 resize-none px-3 py-2 text-[13px] bg-bg border border-transparent rounded-md focus:bg-paper focus:border-line focus:outline-none max-h-[120px]"
          />
          <button
            type="submit"
            disabled={!body.trim() || sending}
            className={cn(
              'w-9 h-9 rounded-md grid place-items-center transition-colors',
              body.trim() && !sending ? 'bg-navy text-white hover:bg-navy-soft' : 'bg-bg text-ink-4 cursor-not-allowed',
            )}
          >
            <Send size={14} />
          </button>
        </div>
      </form>
    </>
  );
}

function Bubble({ m, showAuthor }: { m: MessageLite; showAuthor: boolean }) {
  return (
    <div className={cn('flex mb-1', m.isMine ? 'justify-end' : 'justify-start')}>
      <div className="max-w-[80%] sm:max-w-[60%]">
        {showAuthor && (
          <div className="text-[10.5px] text-ink-4 px-1 mb-0.5">{m.authorName}</div>
        )}
        <div className={cn(
          'px-3 py-1.5 rounded-2xl text-[13px] break-words whitespace-pre-wrap',
          m.isMine ? 'bg-navy text-white rounded-br-sm' : 'bg-paper border border-line text-ink rounded-bl-sm',
        )}>
          {m.body}
          <div className={cn(
            'text-[10px] mt-0.5 text-right opacity-70',
            m.isMine ? 'text-white/70' : 'text-ink-4',
          )}>
            {formatTime(m.createdAt)}
          </div>
        </div>
      </div>
    </div>
  );
}

function DirectChatModal({
  team, onClose,
}: {
  team: Array<{ id: string; name: string; role: UserRole; email: string }>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);

  const filtered = filter
    ? team.filter((t) => t.name.toLowerCase().includes(filter.toLowerCase()))
    : team;

  async function pick(userId: string) {
    setBusy(true);
    try {
      const { chatId } = await openDirectChat(userId);
      onClose();
      router.push(`/team-chat?chat=${chatId}`);
    } catch (e) { alert((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={true} onClose={onClose} title="Личный чат">
      <div className="relative mb-3">
        <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Поиск..."
          autoFocus
          className="w-full pl-8 pr-3 py-2 text-[13px] bg-paper border border-line rounded-md focus:border-navy focus:outline-none"
        />
      </div>

      <div className="flex flex-col gap-1 max-h-[400px] overflow-y-auto thin-scroll">
        {filtered.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => pick(t.id)}
            disabled={busy}
            className="flex items-center gap-3 p-2.5 rounded-md border border-line hover:border-ink-5 transition-colors text-left disabled:opacity-50"
          >
            <Avatar name={t.name} size="md" />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-ink">{t.name}</div>
              <div className="text-[11px] text-ink-4">{roleLabel(t.role)}</div>
            </div>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-6 text-[12px] text-ink-4">Никого не найдено</div>
        )}
      </div>
    </Modal>
  );
}

function GroupChatModal({
  team, onClose,
}: {
  team: Array<{ id: string; name: string; role: UserRole; email: string }>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName]       = useState('');
  const [picked, setPicked]   = useState<Set<string>>(new Set());
  const [busy, setBusy]       = useState(false);

  function toggle(id: string) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  }

  async function create() {
    if (!name.trim() || picked.size === 0) return;
    setBusy(true);
    try {
      const { chatId } = await createGroupChat({
        name: name.trim(),
        memberIds: [...picked],
      });
      onClose();
      router.push(`/team-chat?chat=${chatId}`);
    } catch (e) { alert((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Modal
      open={true}
      onClose={onClose}
      title="Новая группа"
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" onClick={create} disabled={busy || !name.trim() || picked.size === 0}>
            {busy ? 'Создание...' : `Создать (${picked.size})`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <FormField label="Название группы" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Легализация"
            autoFocus
          />
        </FormField>

        <FormField label="Участники" required hint={`Выбрано: ${picked.size}`}>
          <div className="flex flex-col gap-1 max-h-[280px] overflow-y-auto thin-scroll border border-line rounded-md p-1">
            {team.map((t) => (
              <label
                key={t.id}
                className="flex items-center gap-3 p-2 rounded hover:bg-bg cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={picked.has(t.id)}
                  onChange={() => toggle(t.id)}
                  className="w-4 h-4"
                />
                <Avatar name={t.name} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-ink">{t.name}</div>
                  <div className="text-[11px] text-ink-4">{roleLabel(t.role)}</div>
                </div>
              </label>
            ))}
          </div>
        </FormField>
      </div>
    </Modal>
  );
}

function roleLabel(r: UserRole): string {
  return ({ ADMIN: 'Администратор', SALES: 'Менеджер продаж', LEGAL: 'Менеджер легализации' } as const)[r];
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

function formatRelativeShort(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return formatTime(iso);
  return formatDate(iso);
}

function formatDateLabel(dayKey: string): string {
  const d = new Date(dayKey + 'T00:00:00');
  const today = new Date().toISOString().slice(0, 10);
  const yest = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
  if (dayKey === today) return 'Сегодня';
  if (dayKey === yest) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}
