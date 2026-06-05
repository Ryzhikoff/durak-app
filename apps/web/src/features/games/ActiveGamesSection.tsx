/**
 * Home-page list of currently-active (non-finished) games. Any logged-in user
 * can click a card to enter the game in spectator mode (`/games/:id`). The
 * backend serves a redacted snapshot with no hand data; the GamePage detects
 * `state.isSpectator` and hides commands / drag / chat input.
 */
import { Link } from 'react-router-dom';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { GAME_EVENTS } from '@durak/shared-types';
import { Alert, Card, Spinner } from '@/components/ui';
import { Avatar } from '@/components/Avatar';
import { getApiErrorMessage } from '@/lib/api';
import { gamesSocket, useGameSocket } from './socket';
import { ACTIVE_GAMES_QUERY_KEY, useActiveGames } from './hooks';
import type { ActiveGamePlayer, ActiveGameSummary } from './types';

export function ActiveGamesSection() {
  const { t } = useTranslation();
  const list = useActiveGames();
  const qc = useQueryClient();

  // Invalidate the list as soon as ANY game finishes (server publishes the
  // public `game:over` event on the /games namespace, audible from anywhere).
  useGameSocket();
  useEffect(() => {
    const onOverPublic = () => {
      void qc.invalidateQueries({ queryKey: [ACTIVE_GAMES_QUERY_KEY] });
    };
    gamesSocket.on(GAME_EVENTS.overPublic, onOverPublic);
    return () => {
      gamesSocket.off(GAME_EVENTS.overPublic, onOverPublic);
    };
  }, [qc]);

  return (
    <section
      aria-labelledby="active-games-section"
      className="flex flex-col gap-3"
    >
      <header className="flex items-center justify-between gap-3">
        <h2 id="active-games-section" className="text-lg font-semibold">
          {t('home.activeGames.title')}
        </h2>
      </header>

      {list.isPending ? (
        <Card>
          <div className="flex justify-center py-6">
            <Spinner className="text-accent" />
          </div>
        </Card>
      ) : list.isError ? (
        <Alert variant="error">
          {getApiErrorMessage(list.error, t('errors.generic'))}
        </Alert>
      ) : !list.data || list.data.items.length === 0 ? (
        <Card className="text-center">
          <p className="text-sm text-textMuted">{t('home.activeGames.empty')}</p>
        </Card>
      ) : (
        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          data-testid="active-games-grid"
        >
          {list.data.items.map((game) => (
            <ActiveGameCard key={game.gameId} game={game} />
          ))}
        </div>
      )}
    </section>
  );
}

function ActiveGameCard({ game }: { game: ActiveGameSummary }) {
  const { t } = useTranslation();
  const VISIBLE = 4;
  const visible = game.players.slice(0, VISIBLE);
  const extra = Math.max(0, game.players.length - VISIBLE);
  return (
    <Link
      to={`/games/${game.gameId}`}
      data-testid={`active-game-card-${game.gameId}`}
      className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <Card className="!p-4 transition-colors hover:bg-surfaceAlt/60">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="rounded-full bg-surfaceAlt px-2 py-0.5 text-xs text-textMuted">
              {t('home.activeGames.bout', { number: game.boutNumber })}
            </span>
            <span className="text-xs font-semibold uppercase tracking-wide text-accent">
              {t('home.activeGames.watch')}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {visible.map((p) => (
              <PlayerBadge key={p.userId} player={p} />
            ))}
            {extra > 0 ? (
              <span className="rounded-full bg-surfaceAlt px-2 py-0.5 text-xs text-textMuted">
                +{extra}
              </span>
            ) : null}
          </div>
          <div className="truncate text-xs text-textMuted">
            {game.players.map((p) => p.nickname).join(', ')}
          </div>
        </div>
      </Card>
    </Link>
  );
}

function PlayerBadge({ player }: { player: ActiveGamePlayer }) {
  // Slight visual hint for current attacker / defender so the spectator can
  // tell at a glance who is doing what.
  const ring = player.isAttacker
    ? 'ring-2 ring-accent'
    : player.isDefender
      ? 'ring-2 ring-warning'
      : '';
  return (
    <span className={`relative inline-flex rounded-full ${ring}`}>
      <Avatar
        src={player.avatarUrl}
        nickname={player.nickname}
        size={28}
      />
    </span>
  );
}
