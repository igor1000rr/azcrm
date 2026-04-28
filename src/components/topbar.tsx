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
    // Жёлтая полоска под границей + navy-tint фон всего topbar для различия
    <header className="bg-paper border-b border-line h-[52px] flex items-center gap-3 px-4 md:px-5 sticky top-0 z-50 relative
      after:hidden md:after:block after:absolute after:bottom-[-1px] after:left-0 after:w-32 after:h-[2px] after:bg-gold">
      <div className="md:hidden w-9 shrink-0" />

      <nav className="flex items-center gap-1.5 text-[13px] min-w-0">
        {breadcrumbs.map((crumb, i) => {
          const isLast = i === breadcrumbs.length - 1;
          return (
            <div key={i} className="flex items-center gap-1.5 min-w-0">
              {i > 0 && <span className="text-navy-light shrink-0">/</span>}
              {isLast ? (
                <strong className="text-navy font-bold tracking-tight truncate">{crumb.label}</strong>
              ) : crumb.href ? (
                <a href={crumb.href} className="text-navy-medium hover:text-navy transition-colors truncate font-semibold">
                  {crumb.label}
                </a>
              ) : (
                <span className="text-navy-medium truncate font-semibold">{crumb.label}</span>
              )}
            </div>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        {rightSlot}

        <NotificationsPopup />

        <Link href="/clients/new" className="hidden sm:inline-flex">
          <Button variant="primary">
            <Plus size={13} />
            Новый лид
          </Button>
        </Link>
      </div>
    </header>
  );
}
