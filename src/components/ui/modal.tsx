'use client';

// UI: модальное окно
import { useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';

interface ModalProps {
  open:     boolean;
  onClose:  () => void;
  title:    string;
  children: ReactNode;
  footer?:  ReactNode;
  /** Ширина: sm=400, md=540, lg=720 */
  size?:    'sm' | 'md' | 'lg';
}

const sizes = {
  sm: 'max-w-[400px]',
  md: 'max-w-[540px]',
  lg: 'max-w-[720px]',
};

export function Modal({ open, onClose, title, children, footer, size = 'md' }: ModalProps) {
  // Закрытие на Esc
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Скрол вне модалки заблокирован
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className={cn(
          'w-full bg-paper rounded-xl shadow-lg border border-line overflow-hidden',
          'animate-in fade-in zoom-in-95 duration-150',
          sizes[size],
        )}
      >
        <div className="px-5 py-4 border-b border-line flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-ink">{title}</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md border border-line bg-paper text-ink-3 grid place-items-center hover:text-ink hover:border-ink-5 transition-colors"
            aria-label="Закрыть"
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-5">{children}</div>

        {footer && (
          <div className="px-5 py-3 border-t border-line bg-bg flex justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
