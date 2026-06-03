import { ReactNode, useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * When false, prevents closing via Escape, overlay click and hides the X button.
   * Useful for one-time data displays (e.g. generated passwords) that the user
   * MUST acknowledge explicitly via a button inside the modal.
   * @default true
   */
  dismissible?: boolean;
  /**
   * Optional explicit id for the title element. If omitted, an internal id is
   * generated and wired up via aria-labelledby.
   */
  titleId?: string;
  /** Optional id of an element that describes this modal (for aria-describedby). */
  describedById?: string;
}

const FOCUSABLE_SELECTOR =
  'a[href], area[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  dismissible = true,
  titleId,
  describedById,
}: ModalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const autoTitleId = useId();
  const resolvedTitleId = titleId ?? (title ? autoTitleId : undefined);

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const container = containerRef.current;
    // Initial focus: first focusable inside, or the container itself.
    const focusInitial = () => {
      if (!container) return;
      const focusables = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      const first = focusables.item(0);
      if (first) {
        first.focus();
      } else {
        container.focus();
      }
    };
    focusInitial();

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (dismissible) onClose();
        return;
      }
      if (e.key === 'Tab' && container) {
        const focusables = Array.from(
          container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        ).filter((el) => !el.hasAttribute('disabled'));
        if (focusables.length === 0) {
          e.preventDefault();
          container.focus();
          return;
        }
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (active === first || !container.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
      // Restore focus when modal closes/unmounts.
      const prev = previouslyFocused.current;
      if (prev && typeof prev.focus === 'function') {
        prev.focus();
      }
    };
  }, [open, onClose, dismissible]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={resolvedTitleId}
      aria-describedby={describedById}
    >
      <div
        className="absolute inset-0 bg-black/60"
        onClick={dismissible ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        ref={containerRef}
        tabIndex={-1}
        className="relative z-10 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-border bg-surface p-5 shadow-xl max-h-[92vh] overflow-y-auto focus:outline-none"
      >
        {title || dismissible ? (
          <div className="mb-3 flex items-center justify-between gap-3">
            {title ? (
              <h2 id={resolvedTitleId} className="text-lg font-semibold">
                {title}
              </h2>
            ) : (
              <span />
            )}
            {dismissible ? (
              <Button
                variant="ghost"
                size="sm"
                aria-label="Закрыть"
                onClick={onClose}
                className="!h-9 !w-9 !p-0"
              >
                <X className="h-5 w-5" />
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-col gap-4">{children}</div>
        {footer ? (
          <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
