// UI: метка/бейдж
import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type BadgeVariant =
  | 'default'
  | 'navy'
  | 'gold'
  | 'success'
  | 'danger'
  | 'warn'
  | 'info';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  /** Включить точку слева (для статусов вроде "online") */
  withDot?: boolean;
}

const variants: Record<BadgeVariant, string> = {
  default: 'bg-bg text-ink-2 border-line',
  navy:    'bg-navy/[0.04] text-navy border-navy/20',
  gold:    'bg-gold-pale text-[#8A6E36] border-gold/30',
  success: 'bg-success-bg text-success border-success/20',
  danger:  'bg-danger-bg text-danger border-danger/20',
  warn:    'bg-warn-bg text-warn border-warn/20',
  info:    'bg-info-bg text-info border-info/20',
};

export function Badge({
  variant = 'default',
  withDot = false,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded border whitespace-nowrap',
        variants[variant],
        className,
      )}
      {...props}
    >
      {withDot && (
        <span className="w-[5px] h-[5px] rounded-full bg-current shrink-0" aria-hidden />
      )}
      {children}
    </span>
  );
}
