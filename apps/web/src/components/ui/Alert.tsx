import { HTMLAttributes } from 'react';
import clsx from 'clsx';

type Variant = 'info' | 'error' | 'success' | 'warning';

interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: Variant;
  title?: string;
}

const variantClass: Record<Variant, string> = {
  info: 'bg-surfaceAlt border-border text-text',
  error: 'bg-danger/10 border-danger/40 text-text',
  success: 'bg-success/10 border-success/40 text-text',
  warning: 'bg-warning/10 border-warning/40 text-text',
};

export function Alert({
  variant = 'info',
  title,
  children,
  className,
  ...rest
}: AlertProps) {
  return (
    <div
      role="alert"
      className={clsx(
        'rounded-xl border px-4 py-3 text-sm',
        variantClass[variant],
        className,
      )}
      {...rest}
    >
      {title ? <div className="mb-1 font-semibold">{title}</div> : null}
      {children}
    </div>
  );
}
