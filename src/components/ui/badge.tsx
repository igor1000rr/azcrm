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

// default теперь слегка синеватый вместо чисто серого — брендовый акцент
// в самых распространённых плашках (воронка, источник, статусы).
const variants: Record<BadgeVariant, string> = {
  default: 'bg-navy/[0.04] text-navy/85 border-navy/15',
  navy:    'bg-navy text-white border-navy',
  gold:    'bg-gold-pale text-[#8A6E36] border-gold/40',
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
