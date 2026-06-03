import { HTMLAttributes } from 'react';
import clsx from 'clsx';

export function Card({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        'rounded-2xl border border-border bg-surface p-5 shadow-sm',
        className,
      )}
      {...rest}
    />
  );
}
