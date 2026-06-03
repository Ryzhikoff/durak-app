import clsx from 'clsx';

interface AvatarProps {
  /** Direct URL (may be null/empty for fallback). */
  src?: string | null;
  /** Used for initials + deterministic background color. */
  nickname: string;
  /** Pixel size (square). */
  size?: number;
  className?: string;
  alt?: string;
}

/**
 * Square user avatar. Falls back to a tinted circle with the nickname's first
 * (Unicode-aware) glyph when `src` is null/empty. Background color is derived
 * from a stable string hash → HSL.
 */
export function Avatar({ src, nickname, size = 40, className, alt }: AvatarProps) {
  const dimension = { width: size, height: size };
  const fontSize = Math.max(10, Math.round(size * 0.42));

  if (src) {
    return (
      <img
        src={src}
        alt={alt ?? nickname}
        width={size}
        height={size}
        className={clsx(
          'inline-block shrink-0 rounded-full object-cover bg-surfaceAlt',
          className,
        )}
        style={dimension}
        loading="lazy"
      />
    );
  }

  const initial = getInitial(nickname);
  const { bg, fg } = hashColor(nickname);

  return (
    <span
      role="img"
      aria-label={alt ?? nickname}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold uppercase select-none',
        className,
      )}
      style={{ ...dimension, backgroundColor: bg, color: fg, fontSize }}
    >
      {initial}
    </span>
  );
}

function getInitial(nickname: string): string {
  const trimmed = nickname.trim();
  if (!trimmed) return '?';
  // Use Array.from to handle surrogate pairs (emoji) correctly.
  const first = Array.from(trimmed)[0];
  return (first ?? '?').toUpperCase();
}

/**
 * Stable string → {bg, fg} via a small DJB2-style hash and HSL conversion.
 * Background uses fixed saturation/lightness so initials are always readable
 * on the dark theme.
 */
function hashColor(input: string): { bg: string; fg: string } {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(h) % 360;
  return {
    bg: `hsl(${hue} 55% 38%)`,
    fg: '#fff',
  };
}
