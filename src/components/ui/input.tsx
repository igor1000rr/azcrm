// UI: поля ввода
import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

// type-alias вместо пустых interface-extends — чистее и не ругается no-empty-object-type
type InputProps    = InputHTMLAttributes<HTMLInputElement>;
type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;
type SelectProps   = SelectHTMLAttributes<HTMLSelectElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          'w-full px-3 py-2 text-13 bg-paper text-ink',
          'border border-line rounded-md',
          'placeholder:text-ink-4',
          'focus:outline-none focus:border-navy',
          'disabled:bg-bg disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
        {...props}
      />
    );
  },
);

Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, rows = 3, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={cn(
          'w-full px-3 py-2 text-13 bg-paper text-ink',
          'border border-line rounded-md resize-none',
          'placeholder:text-ink-4',
          'focus:outline-none focus:border-navy',
          'disabled:bg-bg disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
        {...props}
      />
    );
  },
);

Textarea.displayName = 'Textarea';

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={cn(
          'w-full px-3 py-2 text-13 bg-paper text-ink',
          'border border-line rounded-md',
          'focus:outline-none focus:border-navy',
          'disabled:bg-bg disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
        {...props}
      >
        {children}
      </select>
    );
  },
);

Select.displayName = 'Select';

export function FormField({
  label,
  htmlFor,
  required,
  error,
  hint,
  children,
}: {
  label?: string;
  htmlFor?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label
          htmlFor={htmlFor}
          className="text-[11px] font-semibold text-ink-2 uppercase tracking-[0.04em]"
        >
          {label}
          {required && <span className="text-danger ml-0.5">*</span>}
        </label>
      )}
      {children}
      {hint && !error && <p className="text-[11px] text-ink-4">{hint}</p>}
      {error && <p className="text-[11px] text-danger">{error}</p>}
    </div>
  );
}
