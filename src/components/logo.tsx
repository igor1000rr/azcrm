// Логотип AZ Group — текстовая версия в navy-квадрате с золотом.
// Когда Anna пришлёт SVG-версию, заменим на <img>.
import { cn } from '@/lib/utils';

interface LogoProps {
  size?:    'sm' | 'md' | 'lg';
  showText?: boolean;
  className?: string;
}

const sizes = {
  sm: { box: 'w-7 h-7  text-[14px]', text: 'text-[15px]' },
  md: { box: 'w-8 h-8  text-[16px]', text: 'text-[17px]' },
  lg: { box: 'w-10 h-10 text-[20px]', text: 'text-[20px]' },
};

export function Logo({ size = 'md', showText = true, className }: LogoProps) {
  const s = sizes[size];

  return (
    <div className={cn('inline-flex items-center gap-2.5', className)}>
      <div
        className={cn(
          'rounded bg-navy text-gold font-display font-bold leading-none',
          'grid place-items-center shrink-0',
          'shadow-sm tracking-tighter',
          s.box,
        )}
      >
        <span>
          A<span className="opacity-85">Z</span>
        </span>
      </div>
      {showText && (
        <div className="leading-none">
          <div
            className={cn(
              'font-display font-bold text-navy tracking-[0.06em]',
              s.text,
            )}
          >
            AZ GROUP
          </div>
          <div className="text-[9px] tracking-[0.18em] text-ink-4 font-medium uppercase mt-0.5">
            Migration Office
          </div>
        </div>
      )}
    </div>
  );
}
