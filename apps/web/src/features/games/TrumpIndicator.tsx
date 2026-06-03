import { useTranslation } from 'react-i18next';
import type { Card, Suit } from './types';
import { PlayingCard } from './PlayingCard';

interface TrumpIndicatorProps {
  trumpCard: Card | null;
  trumpSuit: Suit | null;
  deckSize: number;
}

const SUIT_GLYPH: Record<Suit, string> = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
};

const SUIT_COLOR: Record<Suit, string> = {
  spades: 'text-slate-100',
  clubs: 'text-slate-100',
  hearts: 'text-red-400',
  diamonds: 'text-red-400',
};

/**
 * Bottom-of-deck trump preview + remaining deck size. Shown to all viewers
 * (the trump is public information by the rules of the game).
 */
export function TrumpIndicator({
  trumpCard,
  trumpSuit,
  deckSize,
}: TrumpIndicatorProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-1 text-xs text-textMuted">
      <div className="text-[10px] uppercase tracking-wide">
        {t('game.trump')}
      </div>
      <div className="relative">
        {trumpCard ? (
          <div className="rotate-90">
            <PlayingCard card={trumpCard} size="sm" />
          </div>
        ) : trumpSuit ? (
          <div
            className={`flex h-14 w-10 items-center justify-center rounded-lg border border-slate-300 bg-white text-2xl ${SUIT_COLOR[trumpSuit]}`}
            role="img"
            aria-label={`trump ${trumpSuit}`}
          >
            <span className="text-slate-900">{SUIT_GLYPH[trumpSuit]}</span>
          </div>
        ) : (
          <div className="h-14 w-10 rounded-lg border border-dashed border-border bg-surfaceAlt" />
        )}
      </div>
      <div className="text-[10px]">
        {t('game.deckSize', { count: deckSize })}
      </div>
    </div>
  );
}
