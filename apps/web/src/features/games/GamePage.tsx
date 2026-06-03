import { useMemo } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Spinner } from '@/components/ui';
import { getApiErrorCode, getApiErrorMessage } from '@/lib/api';
import { useGame } from './hooks';

export function GamePage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const game = useGame(id);

  if (!id) {
    return <Navigate to="/" replace />;
  }

  if (game.isPending) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="text-accent" />
      </div>
    );
  }

  if (game.isError) {
    const code = getApiErrorCode(game.error);
    if (code === 'GAME_NOT_FOUND') {
      return <NotFound />;
    }
    return (
      <Alert variant="error">
        {getApiErrorMessage(game.error, t('errors.generic'))}
      </Alert>
    );
  }

  // Stub render — real game UI lands in Phase 4+.
  return <GameStub game={game.data} />;
}

function NotFound() {
  const { t } = useTranslation();
  return (
    <Card className="text-center">
      <h1 className="text-xl font-semibold">{t('game.notFoundTitle')}</h1>
      <p className="mt-2 text-sm text-textMuted">{t('game.notFoundDescription')}</p>
      <div className="mt-4">
        <Link to="/">
          <Button variant="secondary">{t('game.backToHome')}</Button>
        </Link>
      </div>
    </Card>
  );
}

function GameStub({
  game,
}: {
  game: {
    id: string;
    startedAt: string;
    endedAt: string | null;
    players: Array<{ id: string; nickname: string; place: number | null }>;
  };
}) {
  const { t } = useTranslation();
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
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{t('game.title')}</h1>
      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <div className="text-xs uppercase tracking-wide text-textMuted">
              {t('game.startedAt')}
            </div>
            <div className="mt-1">{fmt.format(new Date(game.startedAt))}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-textMuted">
              {t('game.endedAt')}
            </div>
            <div className="mt-1">
              {game.endedAt ? fmt.format(new Date(game.endedAt)) : '—'}
            </div>
          </div>
        </div>
      </Card>
      <Card>
        <div className="mb-2 text-sm font-medium text-textMuted">
          {t('game.playersTitle')}
        </div>
        <ul className="flex flex-col gap-1.5">
          {game.players.map((p) => (
            <li key={p.id} className="flex items-center justify-between text-sm">
              <Link to={`/u/${p.id}`} className="hover:text-accent">
                {p.nickname}
              </Link>
              <span className="text-textMuted">
                {p.place !== null ? `#${p.place}` : '—'}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
