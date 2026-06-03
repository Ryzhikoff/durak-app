import { forwardRef, ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import clsx from 'clsx';

const button = cva(
  'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg select-none',
  {
    variants: {
      variant: {
        primary:
          'bg-accent text-accentText hover:bg-accentHover active:translate-y-px',
        secondary:
          'bg-surfaceAlt text-text hover:bg-border active:translate-y-px',
        ghost:
          'bg-transparent text-text hover:bg-surfaceAlt',
        danger:
          'bg-danger text-white hover:opacity-90 active:translate-y-px',
      },
      size: {
        sm: 'h-9 px-3 text-sm',
        md: 'h-11 px-4 text-base',
      },
      block: {
        true: 'w-full',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, block, type = 'button', ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      className={clsx(button({ variant, size, block }), className)}
      {...rest}
    />
  ),
);
Button.displayName = 'Button';
