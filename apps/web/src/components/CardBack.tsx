import { useId } from 'react';
import clsx from 'clsx';
import type { CardBackDef, CardBackPattern } from '@durak/shared-types';

export type CardBackSize = 'sm' | 'md' | 'lg';

type CardBackProps =
  | {
      mode?: 'preset';
      def: CardBackDef;
      size?: CardBackSize;
      className?: string;
      /** Render with a subtle highlighted ring (selected state). */
      selected?: boolean;
      /** Optional alt/label, e.g. for accessibility. */
      label?: string;
      imageUrl?: never;
    }
  | {
      mode: 'custom';
      imageUrl: string;
      size?: CardBackSize;
      className?: string;
      selected?: boolean;
      label?: string;
      def?: never;
    };

/**
 * Renders a playing-card back. In `preset` mode draws an inline SVG pattern
 * from `CardBackDef`. In `custom` mode shows a user-uploaded image (the
 * backend already pre-rendered it at 360x504 webp — 5:7 aspect that matches
 * the card frame here).
 */
export function CardBack(props: CardBackProps) {
  const { size = 'md', className, selected, label } = props;
  const sizeClass = sizeClassMap[size];

  const accessibleLabel =
    label ?? (props.mode === 'custom' ? 'custom' : props.def.name);

  return (
    <div
      className={clsx(
        'relative overflow-hidden rounded-xl border border-black/30 shadow-sm',
        sizeClass,
        selected ? 'ring-2 ring-accent ring-offset-2 ring-offset-bg' : '',
        className,
      )}
      role="img"
      aria-label={accessibleLabel}
    >
      {props.mode === 'custom' ? (
        <img
          src={props.imageUrl}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <PatternSvg
          pattern={props.def.pattern}
          primary={props.def.colors[0]}
          secondary={props.def.colors[1]}
        />
      )}
      {/* Inner border for the "card frame" look */}
      <div className="pointer-events-none absolute inset-1 rounded-lg border border-white/20" />
      <div className="pointer-events-none absolute inset-2 rounded-md border border-white/10" />
    </div>
  );
}

const sizeClassMap: Record<CardBackSize, string> = {
  // 2.5 : 3.5 aspect ratio (poker card)
  sm: 'w-10 h-14',
  md: 'w-16 h-24',
  lg: 'w-24 h-36',
};

interface PatternProps {
  pattern: CardBackPattern;
  primary: string;
  secondary: string;
}

function PatternSvg({ pattern, primary, secondary }: PatternProps) {
  const patternId = useId();
  return (
    <svg
      viewBox="0 0 100 140"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <defs>
        <PatternDef id={patternId} pattern={pattern} primary={primary} secondary={secondary} />
      </defs>
      <rect width="100" height="140" fill={primary} />
      <rect width="100" height="140" fill={`url(#${patternId})`} />
    </svg>
  );
}

interface PatternDefProps extends PatternProps {
  id: string;
}

function PatternDef({ id, pattern, primary, secondary }: PatternDefProps) {
  switch (pattern) {
    case 'dots':
      return (
        <pattern id={id} width="10" height="10" patternUnits="userSpaceOnUse">
          <rect width="10" height="10" fill={primary} />
          <circle cx="5" cy="5" r="1.6" fill={secondary} />
        </pattern>
      );
    case 'grid':
      return (
        <pattern id={id} width="10" height="10" patternUnits="userSpaceOnUse">
          <rect width="10" height="10" fill={primary} />
          <path
            d="M10 0 L0 0 0 10"
            fill="none"
            stroke={secondary}
            strokeWidth="0.8"
            opacity="0.85"
          />
        </pattern>
      );
    case 'stripes':
      return (
        <pattern
          id={id}
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="8" height="8" fill={primary} />
          <rect width="4" height="8" fill={secondary} opacity="0.75" />
        </pattern>
      );
    case 'crosshatch':
      return (
        <pattern id={id} width="10" height="10" patternUnits="userSpaceOnUse">
          <rect width="10" height="10" fill={primary} />
          <path d="M0 10 L10 0" stroke={secondary} strokeWidth="0.7" opacity="0.7" />
          <path d="M0 0 L10 10" stroke={secondary} strokeWidth="0.7" opacity="0.7" />
        </pattern>
      );
    case 'chevron':
      return (
        <pattern id={id} width="12" height="12" patternUnits="userSpaceOnUse">
          <rect width="12" height="12" fill={primary} />
          <path
            d="M0 6 L6 0 L12 6 L6 12 Z"
            fill={secondary}
            opacity="0.6"
          />
        </pattern>
      );
    case 'wave':
      return (
        <pattern id={id} width="20" height="10" patternUnits="userSpaceOnUse">
          <rect width="20" height="10" fill={primary} />
          <path
            d="M0 5 Q5 0 10 5 T20 5"
            fill="none"
            stroke={secondary}
            strokeWidth="1"
            opacity="0.85"
          />
        </pattern>
      );
    case 'plain':
    default:
      return (
        <pattern id={id} width="100" height="140" patternUnits="userSpaceOnUse">
          <rect width="100" height="140" fill={primary} />
          <rect
            x="6"
            y="6"
            width="88"
            height="128"
            fill={secondary}
            opacity="0.55"
            rx="6"
            ry="6"
          />
        </pattern>
      );
  }
}
