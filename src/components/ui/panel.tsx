// UI: контейнеры
import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/** Базовая карточка-панель */
export function Panel({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'bg-paper border border-line rounded-lg overflow-hidden',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** Заголовок панели */
export function PanelHead({
  title,
  count,
  action,
  className,
}: {
  title: string;
  count?: number | string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'px-4 py-3 border-b border-line flex items-center justify-between gap-3',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <h3 className="text-[13px] font-bold text-ink-2 uppercase tracking-[0.04em]">
          {title}
        </h3>
        {count !== undefined && (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-bg text-ink-3 font-semibold">
            {count}
          </span>
        )}
      </div>
      {action}
    </div>
  );
}

/** Тело панели */
export function PanelBody({
  className,
  children,
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4', className)}>{children}</div>;
}

/** Пустое состояние */
export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
      {icon && <div className="mb-3 text-ink-4">{icon}</div>}
      <h3 className="text-sm font-semibold text-ink mb-1">{title}</h3>
      {description && (
        <p className="text-xs text-ink-3 max-w-sm">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
