// Тесты sidebar.tsx — навигация, активный пункт, бейджи, видимость по ролям.
// Прогнаны локально 32/32 ✓ через vitest+jsdom+RTL.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from '@/components/sidebar';
import { usePathname } from 'next/navigation';

const ADMIN = { id: 'a1', name: 'Anna',   email: 'a@x', role: 'ADMIN' as const };
const SALES = { id: 's1', name: 'Sergey', email: 's@x', role: 'SALES' as const };
const LEGAL = { id: 'l1', name: 'Yuliia', email: 'l@x', role: 'LEGAL' as const };

beforeEach(() => {
  vi.mocked(usePathname).mockReturnValue('/');
});

// ====================== ВИДИМОСТЬ ПО РОЛЯМ ======================

describe('Sidebar — видимость пунктов по ролям', () => {
  it('ADMIN видит все пункты включая Обзор, Аналитику, Автоматизации', () => {
    render(<Sidebar user={ADMIN} />);
    expect(screen.getByText('Обзор')).toBeInTheDocument();
    expect(screen.getByText('Аналитика')).toBeInTheDocument();
    expect(screen.getByText('Автоматизации')).toBeInTheDocument();
  });

  it('ADMIN видит секцию Финансы (Сводная по ЗП, Расходы, Услуги)', () => {
    render(<Sidebar user={ADMIN} />);
    expect(screen.getByText('Сводная по ЗП')).toBeInTheDocument();
    expect(screen.getByText('Расходы')).toBeInTheDocument();
    expect(screen.getByText('Услуги (прайс)')).toBeInTheDocument();
  });

  it('ADMIN видит секцию Настройки', () => {
    render(<Sidebar user={ADMIN} />);
    expect(screen.getByText('Команда')).toBeInTheDocument();
    expect(screen.getByText('Города')).toBeInTheDocument();
    expect(screen.getByText('Аудит-лог')).toBeInTheDocument();
  });

  it('SALES не видит ADMIN-only пункты (Обзор, Аналитика, Автоматизации)', () => {
    render(<Sidebar user={SALES} />);
    expect(screen.queryByText('Обзор')).not.toBeInTheDocument();
    expect(screen.queryByText('Аналитика')).not.toBeInTheDocument();
    expect(screen.queryByText('Автоматизации')).not.toBeInTheDocument();
  });

  it('SALES не видит секции Настройки', () => {
    render(<Sidebar user={SALES} />);
    expect(screen.queryByText('Команда')).not.toBeInTheDocument();
    expect(screen.queryByText('Аудит-лог')).not.toBeInTheDocument();
  });

  it('SALES видит "Премии менеджеров" (свои), но не админские финансы', () => {
    render(<Sidebar user={SALES} />);
    expect(screen.getByText('Премии менеджеров')).toBeInTheDocument();
    expect(screen.queryByText('Сводная по ЗП')).not.toBeInTheDocument();
    expect(screen.queryByText('Расходы')).not.toBeInTheDocument();
  });

  it('LEGAL — то же что и SALES (общая логика)', () => {
    render(<Sidebar user={LEGAL} />);
    expect(screen.getByText('Inbox')).toBeInTheDocument();
    expect(screen.getByText('Клиенты')).toBeInTheDocument();
    expect(screen.getByText('Премии менеджеров')).toBeInTheDocument();
    expect(screen.queryByText('Аналитика')).not.toBeInTheDocument();
    expect(screen.queryByText('Аудит-лог')).not.toBeInTheDocument();
  });

  it('Все роли видят основные пункты: Inbox, /funnel, Клиенты, Задачи', () => {
    for (const u of [ADMIN, SALES, LEGAL]) {
      const { container, unmount } = render(<Sidebar user={u} />);
      expect(screen.getByText('Inbox')).toBeInTheDocument();
      expect(container.querySelector('a[href="/funnel"]')).not.toBeNull();
      expect(screen.getByText('Клиенты')).toBeInTheDocument();
      expect(screen.getByText('Задачи')).toBeInTheDocument();
      unmount();
    }
  });
});

// ====================== АКТИВНЫЙ ПУНКТ ======================

describe('Sidebar — активный пункт', () => {
  it('активный пункт имеет navy подсветку (bg-navy-tint, border-l-navy, font-bold)', () => {
    vi.mocked(usePathname).mockReturnValue('/funnel');
    const { container } = render(<Sidebar user={ADMIN} />);
    const link = container.querySelector('a[href="/funnel"]');
    expect(link?.className).toContain('bg-navy-tint');
    expect(link?.className).toContain('text-navy');
    expect(link?.className).toContain('border-l-navy');
    expect(link?.className).toContain('font-bold');
  });

  it('неактивный пункт без navy фона', () => {
    vi.mocked(usePathname).mockReturnValue('/funnel');
    const { container } = render(<Sidebar user={ADMIN} />);
    const inboxLink = container.querySelector('a[href="/inbox"]');
    expect(inboxLink?.className).toContain('text-ink-2');
    expect(inboxLink?.className).not.toContain('bg-navy-tint text-navy border-l-navy font-bold');
  });

  it('подпуть тоже активирует пункт (/funnel/123 → активна Воронка)', () => {
    vi.mocked(usePathname).mockReturnValue('/funnel/abc-123');
    const { container } = render(<Sidebar user={ADMIN} />);
    const link = container.querySelector('a[href="/funnel"]');
    expect(link?.className).toContain('bg-navy-tint');
  });

  it('точное совпадение пути активирует только этот пункт', () => {
    vi.mocked(usePathname).mockReturnValue('/clients');
    const { container } = render(<Sidebar user={ADMIN} />);
    const clients = container.querySelector('a[href="/clients"]');
    expect(clients?.className).toContain('bg-navy-tint');

    const inbox = container.querySelector('a[href="/inbox"]');
    expect(inbox?.className).not.toContain('bg-navy-tint text-navy');
  });
});

// ====================== БЕЙДЖИ ======================

describe('Sidebar — бейджи и счётчики', () => {
  it('бейдж с числом отображается рядом с пунктом', () => {
    render(<Sidebar user={ADMIN} counters={{ inboxUnread: 5 }} />);
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('pulse=true (срочно) → красный фон bg-danger', () => {
    render(<Sidebar user={ADMIN} counters={{ paymentsOverdue: 3 }} />);
    const badge = screen.getByText('3');
    expect(badge.className).toContain('bg-danger');
    expect(badge.className).toContain('text-white');
    expect(badge.className).toContain('pulse-dot');
  });

  it('активный пункт + бейдж → золотой бейдж (bg-gold, text-navy)', () => {
    vi.mocked(usePathname).mockReturnValue('/funnel');
    render(<Sidebar user={ADMIN} counters={{ leadsActive: 12 }} />);
    const badge = screen.getByText('12');
    expect(badge.className).toContain('bg-gold');
    expect(badge.className).toContain('text-navy');
  });

  it('неактивный пункт + бейдж без pulse → серый бейдж', () => {
    vi.mocked(usePathname).mockReturnValue('/');
    render(<Sidebar user={ADMIN} counters={{ tasksOpen: 7 }} />);
    const badge = screen.getByText('7');
    expect(badge.className).toContain('bg-paper');
    expect(badge.className).toContain('text-ink-3');
  });

  it('бейдж=0 не отображается', () => {
    const { container } = render(<Sidebar user={ADMIN} counters={{ inboxUnread: 0 }} />);
    const inboxLink = container.querySelector('a[href="/inbox"]');
    expect(inboxLink?.querySelector('.rounded-full')).toBeNull();
  });

  it('бейдж=undefined не отображается', () => {
    const { container } = render(<Sidebar user={ADMIN} />);
    const inboxLink = container.querySelector('a[href="/inbox"]');
    expect(inboxLink?.querySelectorAll('span.rounded-full').length).toBe(0);
  });
});

// ====================== WHATSAPP КАНАЛЫ ======================

describe('Sidebar — WhatsApp каналы', () => {
  it('секция WhatsApp скрыта когда whatsappAccounts пустой', () => {
    render(<Sidebar user={ADMIN} />);
    expect(screen.queryByText('Каналы WhatsApp')).not.toBeInTheDocument();
  });

  it('секция WhatsApp показывается с переданными каналами', () => {
    render(<Sidebar user={ADMIN} whatsappAccounts={[
      { id: 'w1', label: 'Общий канал',  phoneNumber: '+48 100', unread: 3 },
      { id: 'w2', label: 'Anna личный',  phoneNumber: '+48 200', unread: 0, isOwn: true },
    ]}/>);
    expect(screen.getByText('Каналы WhatsApp')).toBeInTheDocument();
    expect(screen.getByText('Общий канал')).toBeInTheDocument();
    expect(screen.getByText('Anna личный')).toBeInTheDocument();
  });

  it('канал с unread > 0 показывает число', () => {
    render(<Sidebar user={ADMIN} whatsappAccounts={[
      { id: 'w1', label: 'WA1', phoneNumber: '+48 100', unread: 7 },
    ]}/>);
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('канал с unread=0 не показывает число', () => {
    render(<Sidebar user={ADMIN} whatsappAccounts={[
      { id: 'w1', label: 'WA1', phoneNumber: '+48 100', unread: 0 },
    ]}/>);
    const link = screen.getByText('WA1').closest('a');
    expect(link?.textContent).not.toMatch(/0/);
  });

  it('ссылка канала ведёт на /inbox?channel={id}', () => {
    render(<Sidebar user={ADMIN} whatsappAccounts={[
      { id: 'w-abc', label: 'Test', phoneNumber: '+48 100' },
    ]}/>);
    const link = screen.getByText('Test').closest('a');
    expect(link?.getAttribute('href')).toBe('/inbox?channel=w-abc');
  });
});

// ====================== КАРТОЧКА ПОЛЬЗОВАТЕЛЯ ======================

describe('Sidebar — карточка пользователя', () => {
  it('отображает имя пользователя', () => {
    render(<Sidebar user={ADMIN} />);
    expect(screen.getByText('Anna')).toBeInTheDocument();
  });

  it('ADMIN → "Администратор"', () => {
    render(<Sidebar user={ADMIN} />);
    expect(screen.getByText('Администратор')).toBeInTheDocument();
  });

  it('SALES → "Менеджер продаж"', () => {
    render(<Sidebar user={SALES} />);
    expect(screen.getByText('Менеджер продаж')).toBeInTheDocument();
  });

  it('LEGAL → "Менеджер легализации"', () => {
    render(<Sidebar user={LEGAL} />);
    expect(screen.getByText('Менеджер легализации')).toBeInTheDocument();
  });

  it('кнопка настроек профиля ведёт на /settings/profile', () => {
    render(<Sidebar user={ADMIN} />);
    const settingsLink = screen.getByLabelText('Настройки');
    expect(settingsLink.getAttribute('href')).toBe('/settings/profile');
  });
});

// ====================== МОБИЛЬНОЕ МЕНЮ ======================

describe('Sidebar — мобильное меню (burger)', () => {
  it('по дефолту меню закрыто (-translate-x-full)', () => {
    const { container } = render(<Sidebar user={ADMIN} />);
    const aside = container.querySelector('aside');
    expect(aside?.className).toContain('max-md:-translate-x-full');
  });

  it('клик на бургер открывает меню (translate-x-0)', () => {
    const { container } = render(<Sidebar user={ADMIN} />);
    fireEvent.click(screen.getByLabelText('Открыть меню'));
    const aside = container.querySelector('aside');
    expect(aside?.className).toContain('max-md:translate-x-0');
  });

  it('клик по оверлею закрывает меню', () => {
    const { container } = render(<Sidebar user={ADMIN} />);
    fireEvent.click(screen.getByLabelText('Открыть меню'));
    const overlay = container.querySelector('.fixed.inset-0');
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay!);
    const aside = container.querySelector('aside');
    expect(aside?.className).toContain('max-md:-translate-x-full');
  });

  it('клик по пункту меню закрывает мобильное меню', () => {
    const { container } = render(<Sidebar user={ADMIN} />);
    fireEvent.click(screen.getByLabelText('Открыть меню'));
    fireEvent.click(screen.getByText('Inbox'));
    const aside = container.querySelector('aside');
    expect(aside?.className).toContain('max-md:-translate-x-full');
  });
});
