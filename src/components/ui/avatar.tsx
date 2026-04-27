// UI: аватар (с инициалами или картинкой)
import { type HTMLAttributes } from 'react';
import { cn, initials } from '@/lib/utils';

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
type AvatarStatus = 'online' | 'away' | 'offline';

interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  name:      string;
  size?:     AvatarSize;
  status?:   AvatarStatus;
  imageUrl?: string | null;
  /** Цветовая схема: светлый или тёмный (navy + gold) */
  variant?: 'light' | 'navy';
}

const sizes: Record<AvatarSize, string> = {
  xs: 'w-5 h-5  text-[8.5px]',
  sm: 'w-7 h-7  text-[10px]',
  md: 'w-8 h-8  text-[11px]',
  lg: 'w-12 h-12 text-[15px]',
  xl: 'w-16 h-16 text-[18px]',
};

const statusColors: Record<AvatarStatus, string> = {
  online:  'bg-success',
  away:    'bg-warn',
  offline: 'bg-ink-5',
};

const statusSize: Record<AvatarSize, string> = {
  xs: 'w-1.5 h-1.5',
  sm: 'w-2 h-2',
  md: 'w-[9px] h-[9px]',
  lg: 'w-3 h-3',
  xl: 'w-4 h-4',
};

export function Avatar({
  name,
  size = 'md',
  status,
  imageUrl,
  variant = 'light',
  className,
  ...props
}: AvatarProps) {
  const variantClass =
    variant === 'navy'
      ? 'bg-navy text-gold border-transparent'
      : 'bg-bg text-ink-2 border-line';

  return (
    <div className={cn('relative shrink-0', className)} {...props}>
      <div
        className={cn(
          'rounded-full grid place-items-center font-bold border tracking-tight overflow-hidden',
          sizes[size],
          variantClass,
        )}
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={name} className="w-full h-full object-cover" />
        ) : (
          initials(name)
        )}
      </div>
      {status && (
        <span
          className={cn(
            'absolute -right-px -bottom-px rounded-full border-2 border-paper',
            statusSize[size],
            statusColors[status],
          )}
          aria-label={status}
        />
      )}
    </div>
  );
}
