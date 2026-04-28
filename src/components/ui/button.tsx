// UI: кнопка
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type Variant = 'default' | 'primary' | 'success' | 'danger' | 'warn' | 'ghost' | 'gold';
type Size    = 'sm' | 'md' | 'icon';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?:    Size;
}

// Подкорректированы:
//   default — лёгкий navy hover (текст + бордер) для брендового ощущения
//   primary — тёмно-синий с золотой подсветкой бордера в hover
//   gold    — новый вариант для премиум-акцентов (использовать редко, для
//             единичных кнопок типа "Сохранить" в важных местах)
const variants: Record<Variant, string> = {
  default: 'bg-paper text-ink-2 border-line-strong hover:border-navy/40 hover:text-navy hover:bg-navy/[0.02]',
  primary: 'bg-navy text-white border-navy hover:bg-navy-soft hover:border-gold/50',
  success: 'bg-success text-white border-success hover:bg-green-700',
  danger:  'bg-danger text-white border-danger hover:bg-red-700',
  warn:    'bg-warn text-white border-warn hover:bg-yellow-700',
  ghost:   'bg-transparent text-ink-3 border-transparent hover:bg-navy/[0.04] hover:text-navy',
  gold:    'bg-gold text-navy border-gold hover:bg-gold-light hover:border-gold-light font-semibold',
};

const sizes: Record<Size, string> = {
  sm:   'px-2.5 py-1.5 text-[11.5px] gap-1.5',
  md:   'px-3 py-1.5 text-[12.5px] gap-1.5',
  icon: 'w-[34px] h-[34px] p-0 justify-center',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'default', size = 'md', className, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center font-medium leading-none rounded-md border transition-colors whitespace-nowrap',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-navy/40 focus-visible:ring-offset-1',
          variants[variant],
          sizes[size],
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);

Button.displayName = 'Button';
