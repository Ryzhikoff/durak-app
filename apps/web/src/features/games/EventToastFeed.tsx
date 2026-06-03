import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DomainEvent } from './types';
import type { ClientGameState } from './types';

interface EventToastFeedProps {
  /** New events that haven't been displayed yet. */
  unseenEvents: DomainEvent[];
  /** Used to format player names instead of bare ids. */
  state: ClientGameState;
  /** Called with how many events were consumed so they can be cleared. */
  onConsume: (count: number) => void;
}

interface Toast {
  id: number;
  text: string;
}

const TOAST_LIFETIME_MS = 4_000;

/**
 * Lightweight in-game toast feed. Subscribes to `recentEvents` and renders
 * each event as a short Russian-language line that fades out after a few
 * seconds. We intentionally skip noisy events (`CardAttacked`, `CardBeaten`)
 * because those are already visible on the table.
 */
export function EventToastFeed({
  unseenEvents,
  state,
  onConsume,
}: EventToastFeedProps) {
  const { t } = useTranslation();
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    if (unseenEvents.length === 0) return;
    const nameById = new Map(state.players.map((p) => [p.id, p.nickname]));
    const newToasts: Toast[] = [];
    let counter = Date.now();
    for (const ev of unseenEvents) {
      const text = formatEvent(ev, t, nameById);
      if (!text) continue;
      newToasts.push({ id: counter++, text });
    }
    if (newToasts.length > 0) {
      setToasts((prev) => [...prev, ...newToasts].slice(-5));
    }
    onConsume(unseenEvents.length);
  }, [unseenEvents, state.players, t, onConsume]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setTimeout(() => {
      setToasts((prev) => prev.slice(1));
    }, TOAST_LIFETIME_MS);
    return () => clearTimeout(timer);
  }, [toasts]);

  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-30 flex flex-col items-center gap-1 px-3">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto rounded-lg bg-surface/95 px-3 py-1.5 text-xs shadow-md ring-1 ring-border"
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

function formatEvent(
  ev: DomainEvent,
  t: (key: string, opts?: Record<string, unknown>) => string,
  names: Map<string, string>,
): string | null {
  const name = (id: string): string => names.get(id) ?? id.slice(0, 6);
  switch (ev.type) {
    case 'CardsTaken':
      return t('game.toast.cardsTaken', {
        nickname: name(ev.defenderId),
        count: ev.count,
      });
    case 'BoutEnded':
      return t(`game.toast.boutEnded.${ev.outcome}`, {
        defaultValue: t('game.toast.boutEndedFallback'),
      });
    case 'PlayerOut':
      return t('game.toast.playerOut', {
        nickname: name(ev.playerId),
        place: ev.place,
      });
    case 'GameEnded':
      return t('game.toast.gameEnded');
    case 'CardTranslated':
      return t('game.toast.cardTranslated', {
        nickname: name(ev.fromPlayerId),
      });
    case 'TablePassed':
      return t('game.toast.tablePassed', { nickname: name(ev.sayerId) });
    case 'PlayersDrew': {
      const total = ev.draws.reduce(
        (sum: number, d: { playerId: string; count: number }) => sum + d.count,
        0,
      );
      if (total === 0) return null;
      return t('game.toast.playersDrew', { count: total });
    }
    // Visually obvious — skip to keep the toast feed quiet.
    case 'CardAttacked':
    case 'CardBeaten':
    case 'TurnPassed':
    case 'CheatNoticed':
      return null;
    default:
      return null;
  }
}
