'use client';

// Подсказка-tooltip с иконкой `?`. Появляется при наведении или фокусе.
// Используется по всему UI чтобы помочь Anna разобраться с терминами и формулами.
import { useState, useRef, useEffect, type ReactNode } from 'react';
import { HelpCircle } from 'lucide-react';

interface HintProps {
  /** Текст подсказки (короткий, до ~3 строк) */
  children: ReactNode;
  /** Размер иконки в пикселях, по умолчанию 13 */
  size?: number;
  /** Откуда показывать всплывашку относительно иконки */
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Дополнительные классы на корневой span */
  className?: string;
  /** Ширина всплывашки в пикселях, по умолчанию 240 */
  width?: number;
}

export function Hint({
  children,
  size = 13,
  side = 'top',
  className = '',
  width = 240,
}: HintProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  // Закрытие на Escape (доступность для клавиатуры)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Позиционирование всплывашки относительно иконки
  const tooltipPos = {
    top:    'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left:   'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right:  'left-full top-1/2 -translate-y-1/2 ml-1.5',
  }[side];

  // Стрелочка-уголок указывает на иконку
  const arrowPos = {
    top:    'top-full left-1/2 -translate-x-1/2 border-t-ink border-x-transparent border-b-transparent',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 border-b-ink border-x-transparent border-t-transparent',
    left:   'left-full top-1/2 -translate-y-1/2 border-l-ink border-y-transparent border-r-transparent',
    right:  'right-full top-1/2 -translate-y-1/2 border-r-ink border-y-transparent border-l-transparent',
  }[side];

  return (
    <span
      ref={wrapRef}
      className={`relative inline-flex items-center align-middle ${className}`}
    >
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => { e.preventDefault(); setOpen((v) => !v); }}
        aria-label="Подсказка"
        aria-expanded={open}
        className="inline-flex items-center justify-center text-ink-4 hover:text-ink-2 transition-colors cursor-help"
      >
        <HelpCircle size={size} />
      </button>

      {open && (
        <span
          role="tooltip"
          style={{ width: `${width}px` }}
          className={`absolute z-50 ${tooltipPos} px-2.5 py-1.5 bg-ink text-paper text-[11.5px] rounded-md shadow-lg leading-snug normal-case font-normal tracking-normal pointer-events-none`}
        >
          {children}
          <span className={`absolute w-0 h-0 border-[5px] ${arrowPos}`} />
        </span>
      )}
    </span>
  );
}
