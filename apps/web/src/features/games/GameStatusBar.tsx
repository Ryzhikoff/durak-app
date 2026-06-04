import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { ClientGameState, DomainEvent } from './types';

interface GameStatusBarProps {
  /** Unseen events received since the last ack — newest at the end. */
  unseenEvents: DomainEvent[];
  /** Used to format player names instead of bare ids. */
  state: ClientGameState;
  /** Called with how many events were consumed so the buffer can be cleared. */
  onConsume: (count: number) => void;
  /**
   * Default text shown when no recent event is active (eg. "Ходит Вася").
   * Drawn from the game state by the parent.
   */
  defaultStatus: string;
  /**
   * Short-lived hint that takes priority over both events and the default
   * status while present. Used for client-side drop-rejection feedback
   * ("эта карта не подходит" etc.).
   */
  transientHint?: string | null;
}

/** How long the latest event message stays before falling back to default. */
const EVENT_LIFETIME_MS = 10_000;

/**
 * Thin status strip rendered just above the player's hand. Displays a single
 * line summarising the most recent in-game event, or — once the event ages
 * past `EVENT_LIFETIME_MS` — the default status passed in by the parent.
 *
 * Replaces the old `EventToastFeed` which floated multiple toasts at the top.
 */
export function GameStatusBar({
  unseenEvents,
  state,
  onConsume,
  defaultStatus,
  transientHint = null,
}: GameStatusBarProps) {
  const { t } = useTranslation();
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Consume the latest meaningful event (last one wins; we only display one).
  useEffect(() => {
    if (unseenEvents.length === 0) return;
    const nameById = new Map(state.players.map((p) => [p.id, p.nickname]));
    let latest: string | null = null;
    for (const ev of unseenEvents) {
      const text = formatEvent(ev, t, nameById);
      if (text) latest = text;
    }
    if (latest !== null) {
      setMessage(latest);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setMessage(null), EVENT_LIFETIME_MS);
    }
    onConsume(unseenEvents.length);
  }, [unseenEvents, state.players, t, onConsume]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const isHint = transientHint != null;
  const text = transientHint ?? message ?? defaultStatus;
  return (
    <div
      className={
        isHint
          ? 'flex h-9 w-full items-center justify-center overflow-hidden rounded-md bg-rose-600 px-3 text-xs font-semibold text-white'
          : 'flex h-9 w-full items-center justify-center overflow-hidden rounded-md bg-surfaceAlt px-3 text-xs text-text'
      }
      data-testid="game-status-bar"
      data-hint={isHint ? 'true' : 'false'}
      aria-live="polite"
    >
      <span className="truncate">{text}</span>
    </div>
  );
}

function formatEvent(
  ev: DomainEvent,
  t: TFunction,
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
    case 'DefenderTookCalled':
      return t('game.toast.defenderTookCalled', {
        nickname: name(ev.defenderId),
      });
    case 'PlayersDrew': {
      const total = ev.draws.reduce(
        (sum: number, d: { playerId: string; count: number }) => sum + d.count,
        0,
      );
      if (total === 0) return null;
      return t('game.toast.playersDrew', { count: total });
    }
    case 'CheatNoticed': {
      const noticer = name(ev.noticerId);
      // `cheaterId` may be null in theory (defensive null on the engine type).
      // Fall back to a generic "the player" label so the toast still reads
      // sensibly even in that case.
      const cheater = ev.cheaterId
        ? name(ev.cheaterId)
        : t('game.cheat.unknownPlayer');
      return ev.succeeded
        ? t('game.cheat.toast.caught', {
            noticer,
            cheater,
          })
        : t('game.cheat.toast.falseAlarm', { noticer });
    }
    case 'CardAttacked':
    case 'CardBeaten':
    case 'TurnPassed':
      return null;
    default:
      return null;
  }
}
