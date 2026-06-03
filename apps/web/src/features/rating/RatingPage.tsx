import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Spinner } from '@/components/ui';
import { Avatar } from '@/components/Avatar';
import { useRating } from './hooks';
import { useGames } from '@/features/games/hooks';
import { useAuthStore } from '@/stores/auth.store';
import { getApiErrorMessage } from '@/lib/api';
import type { GameSummary, RatingEntry } from '@durak/shared-types';

const PAGE_LIMIT = 20;
const RECENT_GAMES_LIMIT = 20;

export function RatingPage() {
  const { t } = useTranslation();
  const me = useAuthStore((s) => s.user);
  const [page, setPage] = useState(1);

  const ratingQuery = useMemo(() => ({ page, limit: PAGE_LIMIT }), [page]);
  const rating = useRating(ratingQuery);
  const recentGamesQuery = useMemo(
    () => ({ page: 1, limit: RECENT_GAMES_LIMIT }),
    [],
  );
  const recentGames = useGames(recentGamesQuery);

  const totalPages = rating.data
    ? Math.max(1, Math.ceil(rating.data.total / PAGE_LIMIT))
    : 1;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('home.title')}</h1>
          <p className="mt-1 text-sm text-textMuted">{t('home.subtitle')}</p>
        </div>
        {me ? (
          <Link to={`/u/${me.id}`} className="self-start sm:self-auto">
            <Button variant="secondary" size="sm">
              {t('home.openProfile')}
            </Button>
          </Link>
        ) : null}
      </header>

      <section aria-labelledby="rating-section" className="flex flex-col gap-3">
        <h2 id="rating-section" className="text-lg font-semibold">
          {t('home.ratingTitle')}
        </h2>

        {rating.isPending ? (
          <Card>
            <div className="flex justify-center py-6">
              <Spinner className="text-accent" />
            </div>
          </Card>
        ) : rating.isError ? (
          <Alert variant="error">
            {getApiErrorMessage(rating.error, t('errors.generic'))}
          </Alert>
        ) : rating.data.items.length === 0 ? (
          <Card>
            <p className="text-center text-textMuted">{t('home.ratingEmpty')}</p>
          </Card>
        ) : (
          <>
            {/* Mobile: cards */}
            <div className="flex flex-col gap-2 md:hidden">
              {rating.data.items.map((entry, idx) => (
                <RatingMobileCard
                  key={entry.id}
                  entry={entry}
                  place={(page - 1) * PAGE_LIMIT + idx + 1}
                />
              ))}
            </div>

            {/* Desktop: table */}
            <Card className="hidden md:block !p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surfaceAlt text-left text-textMuted">
                  <tr>
                    <th className="px-4 py-3 font-medium w-12">{t('home.table.place')}</th>
                    <th className="px-4 py-3 font-medium">{t('home.table.player')}</th>
                    <th className="px-4 py-3 font-medium text-right">{t('home.table.rating')}</th>
                    <th className="px-4 py-3 font-medium text-right">{t('home.table.games')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rating.data.items.map((entry, idx) => (
                    <RatingRow
                      key={entry.id}
                      entry={entry}
                      place={(page - 1) * PAGE_LIMIT + idx + 1}
                    />
                  ))}
                </tbody>
              </table>
            </Card>

            {totalPages > 1 ? (
              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  {t('home.prev')}
                </Button>
                <div className="text-sm text-textMuted">
                  {t('home.page', { page, total: totalPages })}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  {t('home.next')}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </section>

      <section aria-labelledby="recent-games-section" className="flex flex-col gap-3">
        <h2 id="recent-games-section" className="text-lg font-semibold">
          {t('home.lastGamesTitle')}
        </h2>
        {recentGames.isPending ? (
          <Card>
            <div className="flex justify-center py-6">
              <Spinner className="text-accent" />
            </div>
          </Card>
        ) : recentGames.isError ? (
          <Alert variant="error">
            {getApiErrorMessage(recentGames.error, t('errors.generic'))}
          </Alert>
        ) : recentGames.data.items.length === 0 ? (
          <Card>
            <p className="text-center text-textMuted">{t('home.lastGamesEmpty')}</p>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {recentGames.data.items.map((g) => (
              <GameSummaryCard key={g.id} game={g} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function RatingRow({ entry, place }: { entry: RatingEntry; place: number }) {
  return (
    <tr className="hover:bg-surfaceAlt/40">
      <td className="px-4 py-3 text-textMuted">{place}</td>
      <td className="px-4 py-3">
        <Link
          to={`/u/${entry.id}`}
          className="inline-flex items-center gap-2 hover:text-accent"
        >
          <Avatar src={entry.avatarUrl} nickname={entry.nickname} size={24} />
          <span className="truncate">{entry.nickname}</span>
        </Link>
      </td>
      <td className="px-4 py-3 text-right font-semibold tabular-nums">{entry.rating}</td>
      <td className="px-4 py-3 text-right text-textMuted tabular-nums">
        {entry.gamesPlayed}
      </td>
    </tr>
  );
}

function RatingMobileCard({ entry, place }: { entry: RatingEntry; place: number }) {
  const { t } = useTranslation();
  return (
    <Card className="!p-4">
      <div className="flex items-center gap-3">
        <div className="w-6 shrink-0 text-center text-sm text-textMuted">{place}</div>
        <Avatar src={entry.avatarUrl} nickname={entry.nickname} size={40} />
        <div className="min-w-0 flex-1">
          <Link
            to={`/u/${entry.id}`}
            className="block truncate font-semibold hover:text-accent"
          >
            {entry.nickname}
          </Link>
          <div className="text-xs text-textMuted">
            {t('home.table.games')}: {entry.gamesPlayed}
          </div>
        </div>
        <div className="text-lg font-bold tabular-nums">{entry.rating}</div>
      </div>
    </Card>
  );
}

function GameSummaryCard({ game }: { game: GameSummary }) {
  const fmt = useMemo(
    () =>
      new Intl.DateTimeFormat('ru-RU', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [],
  );
  return (
    <Link to={`/games/${game.id}`}>
      <Card className="!p-3 transition-colors hover:bg-surfaceAlt/60">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">
              {game.players.map((p) => p.nickname).join(', ')}
            </div>
            <div className="text-xs text-textMuted">
              {fmt.format(new Date(game.startedAt))}
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}
