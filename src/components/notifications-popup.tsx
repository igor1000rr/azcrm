'use client';

// Попап уведомлений в шапке: dropdown по клику на колокольчик
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Bell, Check, MessageSquare, AtSign, UserPlus, CreditCard, Calendar, FileText } from 'lucide-react';
import { cn, formatRelative } from '@/lib/utils';
import type { NotificationKind } from '@prisma/client';

interface NotifItem {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

export function NotificationsPopup() {
  const [open, setOpen]             = useState(false);
  const [items, setItems]           = useState<NotifItem[]>([]);
  const [unreadCount, setUnread]    = useState(0);
  const [loading, setLoading]       = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Загрузка при открытии
  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/notifications/list');
      const data = await res.json();
      setItems(data.items ?? []);
      setUnread(data.unreadCount ?? 0);
    } catch {}
    finally { setLoading(false); }
  }

  // Polling раз в 30 сек для счётчика
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  // Закрытие по клику вне попапа
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (popupRef.current?.contains(e.target as Node)) return;
      if (buttonRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  async function markAllRead() {
    await fetch('/api/notifications/read-all', { method: 'POST' });
    setItems((prev) => prev.map((i) => ({ ...i, isRead: true })));
    setUnread(0);
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => { setOpen(!open); if (!open) load(); }}
        className={cn(
          'relative w-9 h-9 rounded-md border border-line-strong bg-paper text-ink-2',
          'grid place-items-center hover:border-ink-4 hover:text-ink transition-colors',
        )}
        aria-label="Уведомления"
      >
        <Bell size={14} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-danger text-white text-[10px] font-bold leading-none grid place-items-center ring-2 ring-paper">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={popupRef}
          className="absolute right-3 top-[58px] w-[360px] max-w-[calc(100vw-24px)] bg-paper border border-line rounded-lg shadow-lg z-[100] overflow-hidden"
        >
          {/* Шапка */}
          <div className="px-4 py-3 border-b border-line flex items-center justify-between">
            <h3 className="text-[13px] font-bold text-ink">
              Уведомления
              {unreadCount > 0 && (
                <span className="text-[11px] font-normal text-ink-3 ml-1.5">
                  · {unreadCount} новых
                </span>
              )}
            </h3>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-[11.5px] text-info hover:underline"
              >
                Прочитать всё
              </button>
            )}
          </div>

          {/* Список */}
          <div className="max-h-[420px] overflow-y-auto thin-scroll">
            {loading && items.length === 0 ? (
              <div className="text-center py-6 text-[12px] text-ink-4">Загрузка...</div>
            ) : items.length === 0 ? (
              <div className="text-center py-10">
                <Bell size={28} className="mx-auto text-ink-5 mb-2" />
                <p className="text-[12.5px] text-ink-3">Уведомлений нет</p>
              </div>
            ) : (
              items.map((item) => <NotifRow key={item.id} item={item} onClick={() => setOpen(false)} />)
            )}
          </div>
        </div>
      )}
    </>
  );
}

function NotifRow({ item, onClick }: { item: NotifItem; onClick: () => void }) {
  const Icon = iconFor(item.kind);
  const colorClass = colorFor(item.kind);

  const Wrapper = item.link
    ? ({ children }: { children: React.ReactNode }) => (
        <Link href={item.link!} onClick={onClick} className="block">{children}</Link>
      )
    : ({ children }: { children: React.ReactNode }) => <div>{children}</div>;

  return (
    <Wrapper>
      <div className={cn(
        'px-4 py-2.5 border-b border-line-2 last:border-0 flex items-start gap-2.5 transition-colors hover:bg-bg',
        !item.isRead && 'bg-info-bg/30',
      )}>
        <div className={cn('w-7 h-7 rounded-md grid place-items-center shrink-0', colorClass)}>
          <Icon size={12} />
        </div>
        <div className="flex-1 min-w-0">
          <div className={cn(
            'text-[12.5px] leading-snug',
            !item.isRead ? 'font-semibold text-ink' : 'text-ink-2',
          )}>
            {item.title}
          </div>
          {item.body && (
            <div className="text-[11.5px] text-ink-3 mt-0.5 line-clamp-2">{item.body}</div>
          )}
          <div className="text-[10.5px] text-ink-4 mt-1">{formatRelative(item.createdAt)}</div>
        </div>
        {!item.isRead && (
          <span className="w-1.5 h-1.5 rounded-full bg-info mt-1.5 shrink-0" />
        )}
      </div>
    </Wrapper>
  );
}

function iconFor(kind: NotificationKind) {
  switch (kind) {
    case 'NEW_MESSAGE':           return MessageSquare;
    case 'MENTION_IN_NOTE':       return AtSign;
    case 'LEAD_TRANSFERRED':      return UserPlus;
    case 'TASK_ASSIGNED':
    case 'TASK_OVERDUE':          return Check;
    case 'PAYMENT_RECEIVED':      return CreditCard;
    case 'FINGERPRINT_REMINDER':  return Calendar;
    default:                      return FileText;
  }
}

function colorFor(kind: NotificationKind): string {
  switch (kind) {
    case 'NEW_MESSAGE':           return 'bg-info-bg text-info';
    case 'MENTION_IN_NOTE':       return 'bg-gold-pale text-gold';
    case 'LEAD_TRANSFERRED':      return 'bg-navy/[0.06] text-navy';
    case 'TASK_ASSIGNED':
    case 'TASK_OVERDUE':          return 'bg-warn-bg text-warn';
    case 'PAYMENT_RECEIVED':      return 'bg-success-bg text-success';
    case 'FINGERPRINT_REMINDER':  return 'bg-warn-bg text-warn';
    default:                      return 'bg-bg text-ink-3';
  }
}
