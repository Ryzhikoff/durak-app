import { useTranslation } from 'react-i18next';

interface DiscardPileProps {
  discardSize: number;
}

/** Small "burn pile" badge — the cards inside are not visible to anyone. */
export function DiscardPile({ discardSize }: DiscardPileProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-1 text-xs text-textMuted">
      <div className="text-[10px] uppercase tracking-wide">
        {t('game.discard')}
      </div>
      <div
        className="relative h-14 w-10 rounded-lg border border-border bg-surfaceAlt"
        role="img"
        aria-label="discard pile"
      >
        {discardSize > 0 ? (
          <>
            <div className="absolute inset-0 rotate-3 rounded-lg border border-border bg-surface/80" />
            <div className="absolute inset-0 -rotate-3 rounded-lg border border-border bg-surface/80" />
            <div className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-text">
              {discardSize}
            </div>
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px]">
            0
          </div>
        )}
      </div>
    </div>
  );
}
