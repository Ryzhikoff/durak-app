import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Button, Modal } from '@/components/ui';
import { getApiErrorCode, getApiErrorMessage } from '@/lib/api';
import { useRematch } from './hooks';
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
  const navigate = useNavigate();
  const rematch = useRematch();
  const [rematchError, setRematchError] = useState<string | null>(null);
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

  // Rematch CTA only for participants (state.myUserId is set only when the
  // viewer is a participant; spectators never see this modal anyway).
  const isParticipant = !!me;

  const onRematch = async () => {
    setRematchError(null);
    try {
      const { lobbyId } = await rematch.mutateAsync(state.id);
      onClose();
      navigate(`/lobbies/${lobbyId}`);
    } catch (err) {
      const code = getApiErrorCode(err);
      if (code === 'ALREADY_IN_LOBBY') {
        const ax = err as {
          response?: { data?: { error?: { details?: { currentLobbyId?: string } } } };
        };
        const currentLobbyId = ax.response?.data?.error?.details?.currentLobbyId;
        if (currentLobbyId) {
          onClose();
          navigate(`/lobbies/${currentLobbyId}`);
          return;
        }
      }
      setRematchError(
        code
          ? t(`errors.${code}`, { defaultValue: getApiErrorMessage(err, t('errors.generic')) })
          : getApiErrorMessage(err, t('errors.generic')),
      );
    }
  };

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
      {rematchError ? <Alert variant="error">{rematchError}</Alert> : null}
      <div className="mt-2 flex flex-col gap-2">
        {isParticipant ? (
          <Button
            block
            variant="primary"
            onClick={onRematch}
            disabled={rematch.isPending}
            data-testid="rematch-button"
          >
            {rematch.isPending
              ? t('gameDetail.rematch.submitting')
              : t('gameDetail.rematch.button')}
          </Button>
        ) : null}
        <Link to="/">
          <Button block variant={isParticipant ? 'secondary' : 'primary'}>
            {t('game.over.backToHome')}
          </Button>
        </Link>
      </div>
    </Modal>
  );
}
