import { forwardRef, InputHTMLAttributes, useId } from 'react';
import clsx from 'clsx';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  help?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, help, id, 'aria-describedby': describedBy, ...rest }, ref) => {
    const autoId = useId();
    const inputId = id ?? autoId;
    const errorId = `${inputId}-error`;
    const helpId = `${inputId}-help`;
    const describedByIds = [
      error ? errorId : null,
      !error && help ? helpId : null,
      describedBy ?? null,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div className="flex flex-col gap-1.5">
        {label ? (
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-textMuted"
          >
            {label}
          </label>
        ) : null}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedByIds || undefined}
          className={clsx(
            'h-11 w-full rounded-xl border border-border bg-surface px-3.5 text-base text-text placeholder:text-textMuted/60',
            'focus-visible:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40',
            'disabled:opacity-60 disabled:cursor-not-allowed',
            error ? 'border-danger focus-visible:border-danger focus-visible:ring-danger/40' : '',
            className,
          )}
          {...rest}
        />
        {error ? (
          <span id={errorId} className="text-xs text-danger">
            {error}
          </span>
        ) : help ? (
          <span id={helpId} className="text-xs text-textMuted/80">
            {help}
          </span>
        ) : null}
      </div>
    );
  },
);
Input.displayName = 'Input';
