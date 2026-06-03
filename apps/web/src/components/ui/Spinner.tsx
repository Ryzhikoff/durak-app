import clsx from 'clsx';

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={clsx(
        'inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-r-transparent',
        className,
      )}
    />
  );
}
