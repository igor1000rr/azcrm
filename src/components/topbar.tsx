'use client';

// Шапка приложения — крошки и быстрые действия
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { Button } from './ui/button';
import { NotificationsPopup } from './notifications-popup';

interface TopbarProps {
  breadcrumbs: Array<{ label: string; href?: string }>;
  rightSlot?: React.ReactNode;
}

export function Topbar({ breadcrumbs, rightSlot }: TopbarProps) {
  return (
    <header className="bg-paper border-b border-line h-[52px] flex items-center gap-3 px-4 md:px-5 sticky top-0 z-50 relative">
      {/* Отступ под мобильную кнопку меню */}
      <div className="md:hidden w-9 shrink-0" />

      {/* Крошки */}
      <nav className="flex items-center gap-1.5 text-[13px] min-w-0">
        {breadcrumbs.map((crumb, i) => {
          const isLast = i === breadcrumbs.length - 1;
          return (
            <div key={i} className="flex items-center gap-1.5 min-w-0">
              {i > 0 && <span className="text-ink-5 shrink-0">/</span>}
              {isLast ? (
                <strong className="text-ink font-semibold truncate">{crumb.label}</strong>
              ) : crumb.href ? (
                <a href={crumb.href} className="text-ink-4 hover:text-ink truncate">
                  {crumb.label}
                </a>
              ) : (
                <span className="text-ink-4 truncate">{crumb.label}</span>
              )}
            </div>
          );
        })}
      </nav>

      {/* Правая часть */}
      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        {rightSlot}

        <NotificationsPopup />

        <Link href="/clients/new" className="hidden sm:inline-flex">
          <Button variant="default">
            <Plus size={13} />
            Новый лид
          </Button>
        </Link>
      </div>
    </header>
  );
}
