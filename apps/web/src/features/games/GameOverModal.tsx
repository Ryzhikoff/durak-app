import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button, Modal } from '@/components/ui';
import type { ClientGameState } from './types';

interface GameOverModalProps {
  state: ClientGameState;
  open: boolean;
  onClose: () => void;
}

/**
 * Endgame summary. Three flavors:
 *  - `myUserId === loserPlayerId` → "you lost"
 *  - `loserPlayerId == null` → "draw"
 *  - else → "you won" (i.e. the loser is someone else and you're not them)
 *
 * Always lists the finish placements so the player sees where everyone landed.
 */
export function GameOverModal({ state, open, onClose }: GameOverModalProps) {
  const { t } = useTranslation();
  const loserId = state.loserPlayerId;
  const me = state.myUserId;
  const headline =
    loserId == null
      ? t('game.over.draw')
      : me === loserId
        ? t('game.over.youLost')
        : t('game.over.youWon');

  // Sort by finishPlace ascending; finished players first, then loser, then
  // anyone still mid-game (shouldn't happen post-game_over, defensive).
  const ranked = [...state.players].sort((a, b) => {
    const ap = a.finishPlace ?? Infinity;
    const bp = b.finishPlace ?? Infinity;
    return ap - bp;
  });

  return (
    <Modal open={open} onClose={onClose} title={t('game.over.title')}>
      <p className="text-base font-semibold text-text">{headline}</p>
      <ul className="flex flex-col gap-1">
        {ranked.map((p) => {
          const isLoser = p.id === loserId;
          const place =
            p.finishPlace != null
              ? t('game.over.placement', { place: p.finishPlace })
              : isLoser
                ? t('game.over.loserBadge')
                : '—';
          return (
            <li
              key={p.id}
              className="flex items-center justify-between text-sm"
            >
              <Link
                to={`/u/${p.id}`}
                className="truncate font-medium hover:text-accent"
              >
                {p.nickname}
              </Link>
              <span className="ml-2 shrink-0 text-textMuted">{place}</span>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex flex-col gap-2">
        <Link to="/">
          <Button block variant="primary">
            {t('game.over.backToHome')}
          </Button>
        </Link>
      </div>
    </Modal>
  );
}
