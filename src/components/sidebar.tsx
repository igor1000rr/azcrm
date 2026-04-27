'use client';

// Sidebar — основная навигация
// Адаптив: на >900px фиксирован слева, на ≤900px — drawer с overlay
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  Inbox, LayoutGrid, Users, Calendar, CreditCard,
  CheckSquare, Zap, BarChart3, Phone, MessageSquare,
  Settings, X, Menu, Activity, Wallet, Receipt, ListChecks, Clock,
  Cake,
} from 'lucide-react';
import { Logo } from './logo';
import { Avatar } from './ui/avatar';
import { cn } from '@/lib/utils';
import type { UserRole } from '@prisma/client';

interface NavItem {
  href:     string;
  label:    string;
  icon:     React.ComponentType<{ size?: number; className?: string }>;
  badge?:   number | string;
  pulse?:   boolean;
  roles?:   UserRole[];
}

interface SidebarProps {
  user: {
    id:    string;
    name:  string;
    email: string;
    role:  UserRole;
  };
  counters?: {
    inboxUnread?: number;
    leadsActive?: number;
    eventsToday?: number;
    paymentsOverdue?: number;
    tasksOpen?: number;
    automationsActive?: number;
    teamChatUnread?: number;
  };
  whatsappAccounts?: Array<{
    id:          string;
    label:       string;
    phoneNumber: string;
    unread?:     number;
    isOwn?:      boolean; // true если это личный канал юзера или общий
  }>;
}

export function Sidebar({ user, counters = {}, whatsappAccounts = [] }: SidebarProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const items: NavItem[] = [
    { href: '/inbox',         label: 'Inbox',         icon: Inbox,        badge: counters.inboxUnread,    pulse: !!counters.inboxUnread },
    { href: '/dashboard',     label: 'Обзор',         icon: LayoutGrid,   roles: ['ADMIN'] },
    { href: '/funnel',        label: 'Воронки',       icon: BarChart3,    badge: counters.leadsActive },
    { href: '/clients',       label: 'Клиенты',       icon: Users },
    { href: '/birthdays',     label: 'Дни рождения',  icon: Cake },
    { href: '/calls',         label: 'Звонки',        icon: Phone },
    { href: '/calendar',      label: 'Календарь',     icon: Calendar,     badge: counters.eventsToday },
    { href: '/work-calendar', label: 'Моё рабочее время', icon: Clock },
    { href: '/payments',      label: 'Оплаты',        icon: CreditCard,   badge: counters.paymentsOverdue, pulse: !!counters.paymentsOverdue },
    { href: '/tasks',         label: 'Задачи',        icon: CheckSquare,  badge: counters.tasksOpen },
    { href: '/team-chat',     label: 'Чат команды',   icon: MessageSquare, badge: counters.teamChatUnread, pulse: !!counters.teamChatUnread },
    { href: '/automations',   label: 'Автоматизации', icon: Zap,          badge: counters.automationsActive, roles: ['ADMIN'] },
    { href: '/stats',         label: 'Аналитика',     icon: BarChart3,    roles: ['ADMIN'] },
  ];

  const financeItems: NavItem[] = [
    { href: '/finance/commissions', label: 'Премии менеджеров', icon: Wallet },
    { href: '/finance/payroll',     label: 'Сводная по ЗП',     icon: ListChecks, roles: ['ADMIN'] },
    { href: '/finance/expenses',    label: 'Расходы',           icon: Receipt,    roles: ['ADMIN'] },
    { href: '/finance/services',    label: 'Услуги (прайс)',    icon: BarChart3,  roles: ['ADMIN'] },
  ];

  const settingsItems: NavItem[] = [
    { href: '/settings/team',           label: 'Команда',          icon: Users,         roles: ['ADMIN'] },
    { href: '/settings/funnels',        label: 'Воронки',          icon: BarChart3,     roles: ['ADMIN'] },
    { href: '/settings/channels',       label: 'WhatsApp каналы',  icon: MessageSquare, roles: ['ADMIN'] },
    { href: '/settings/blueprints',     label: 'Шаблоны Word',     icon: Settings,      roles: ['ADMIN'] },
    { href: '/settings/chat-templates', label: 'Шаблоны сообщений', icon: Settings,     roles: ['ADMIN'] },
    { href: '/settings/audit',          label: 'Аудит-лог',        icon: Activity,      roles: ['ADMIN'] },
  ];

  const visibleItems    = items.filter((it) => !it.roles || it.roles.includes(user.role));
  const visibleFinance  = financeItems.filter((it) => !it.roles || it.roles.includes(user.role));
  const visibleSettings = settingsItems.filter((it) => !it.roles || it.roles.includes(user.role));

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
    <>
      {/* Кнопка меню в мобиле — отдельно показываем в layout */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Открыть меню"
        className="md:hidden fixed top-2.5 left-3 z-[80] w-9 h-9 rounded-md border border-line bg-paper text-ink-2 grid place-items-center shadow-sm"
      >
        <Menu size={16} />
      </button>

      {/* Overlay в мобиле */}
      {open && (
        <div
          className="md:hidden fixed inset-0 z-[90] bg-black/40 backdrop-blur-[2px]"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Сам сайдбар */}
      <aside
        className={cn(
          'bg-paper border-r border-line py-4 sticky top-0 h-dvh',
          'flex flex-col overflow-y-auto thin-scroll',
          'w-[232px] shrink-0',
          // Mobile drawer
          'max-md:fixed max-md:left-0 max-md:top-0 max-md:z-[100] max-md:w-[280px] max-md:max-w-[85vw]',
          'max-md:shadow-lg max-md:transition-transform max-md:duration-200',
          open ? 'max-md:translate-x-0' : 'max-md:-translate-x-full',
        )}
      >
        {/* Бренд */}
        <div className="px-4 pb-4 border-b border-line mb-3 flex items-center justify-between">
          <Link href="/" onClick={() => setOpen(false)}>
            <Logo size="sm" />
          </Link>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Закрыть меню"
            className="md:hidden w-8 h-8 rounded-md border border-line bg-paper text-ink-2 grid place-items-center"
          >
            <X size={14} />
          </button>
        </div>

        {/* Навигация */}
        <NavLabel>Главное</NavLabel>
        {visibleItems.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={isActive(item.href)}
            onClick={() => setOpen(false)}
          />
        ))}

        {/* Каналы (только для не-админов? Нет, всем — но видят только свои) */}
        {whatsappAccounts.length > 0 && (
          <>
            <NavLabel>Каналы WhatsApp</NavLabel>
            {whatsappAccounts.map((wa) => (
              <Link
                key={wa.id}
                href={`/inbox?channel=${wa.id}`}
                onClick={() => setOpen(false)}
                className={cn(
                  'flex items-center gap-2 px-4 py-1.5 text-[12px] text-ink-2',
                  'hover:bg-bg hover:text-ink transition-colors',
                  wa.unread && 'font-semibold',
                )}
              >
                <span className="w-1.5 h-1.5 rounded bg-wa shrink-0" />
                <span className="truncate flex-1">{wa.label}</span>
                {wa.unread !== undefined && wa.unread > 0 && (
                  <span className="text-[10.5px] text-danger font-bold">{wa.unread}</span>
                )}
              </Link>
            ))}
          </>
        )}

        {/* Финансы — раздел с премиями, ЗП, расходами */}
        {visibleFinance.length > 0 && (
          <>
            <NavLabel>Финансы</NavLabel>
            {visibleFinance.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                active={isActive(item.href)}
                onClick={() => setOpen(false)}
              />
            ))}
          </>
        )}

        {/* Настройки (только для админа) */}
        {visibleSettings.length > 0 && (
          <>
            <NavLabel>Настройки</NavLabel>
            {visibleSettings.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                active={isActive(item.href)}
                onClick={() => setOpen(false)}
              />
            ))}
          </>
        )}

        {/* Карточка юзера снизу */}
        <div className="mt-auto px-3.5 pt-3 border-t border-line flex items-center gap-2.5">
          <Avatar name={user.name} size="md" status="online" variant="navy" />
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-semibold text-ink truncate">{user.name}</div>
            <div className="text-[10.5px] text-ink-4">{roleLabel(user.role)}</div>
          </div>
          <Link
            href="/settings/profile"
            className="text-ink-4 hover:text-ink p-1 transition-colors"
            aria-label="Настройки"
          >
            <Settings size={14} />
          </Link>
        </div>
      </aside>
    </>
  );
}

// ====================== ВСПОМОГАТЕЛЬНЫЕ ======================

function NavLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] tracking-[0.12em] text-ink-4 font-semibold uppercase px-4 mt-3 mb-1">
      {children}
    </div>
  );
}

function NavLink({
  item, active, onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={cn(
        'flex items-center gap-2.5 px-4 py-1.5 text-[13px] font-medium transition-colors',
        'border-l-2 border-transparent',
        active
          ? 'bg-bg text-navy border-l-gold font-semibold'
          : 'text-ink-2 hover:bg-bg hover:text-ink',
      )}
    >
      <Icon size={15} className={cn('shrink-0', active ? 'opacity-100' : 'opacity-65')} />
      <span className="flex-1">{item.label}</span>
      {item.badge !== undefined && item.badge !== 0 && (
        <span
          className={cn(
            'text-[10.5px] font-semibold px-1.5 py-px rounded-full min-w-[20px] text-center border',
            item.pulse
              ? 'bg-danger text-white border-danger pulse-dot'
              : active
                ? 'bg-navy text-white border-navy'
                : 'bg-paper text-ink-3 border-line',
          )}
        >
          {item.badge}
        </span>
      )}
    </Link>
  );
}

function roleLabel(role: UserRole): string {
  return {
    ADMIN: 'Администратор',
    SALES: 'Менеджер продаж',
    LEGAL: 'Менеджер легализации',
  }[role];
}
