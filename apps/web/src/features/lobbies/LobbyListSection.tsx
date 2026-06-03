import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import type { LobbySummary } from '@durak/shared-types';
import { Alert, Button, Card, Spinner } from '@/components/ui';
import { Avatar } from '@/components/Avatar';
import { getApiErrorMessage } from '@/lib/api';
import { useLobbyList } from './hooks';
import { CreateLobbyModal } from './CreateLobbyModal';

export function LobbyListSection() {
  const { t } = useTranslation();
  const list = useLobbyList();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <section
      aria-labelledby="lobbies-section"
      className="flex flex-col gap-3"
    >
      <header className="flex items-center justify-between gap-3">
        <h2 id="lobbies-section" className="text-lg font-semibold">
          {t('lobbies.title')}
        </h2>
        <Button onClick={() => setCreateOpen(true)} size="sm">
          <Plus className="h-4 w-4" />
          {t('lobbies.create')}
        </Button>
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
      ) : !list.data || list.data.length === 0 ? (
        <Card className="text-center">
          <p className="text-sm text-textMuted">{t('lobbies.empty')}</p>
          <div className="mt-3">
            <Button onClick={() => setCreateOpen(true)}>
              {t('lobbies.createFirst')}
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {list.data.map((lobby) => (
            <LobbyCard key={lobby.id} lobby={lobby} />
          ))}
        </div>
      )}

      <CreateLobbyModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </section>
  );
}

function LobbyCard({ lobby }: { lobby: LobbySummary }) {
  const { t } = useTranslation();
  const VISIBLE_AVATARS = 4;
  const visible = lobby.players.slice(0, VISIBLE_AVATARS);
  const extra = Math.max(0, lobby.players.length - VISIBLE_AVATARS);
  return (
    <Link
      to={`/lobbies/${lobby.id}`}
      className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-2xl"
    >
      <Card className="!p-4 transition-colors hover:bg-surfaceAlt/60">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-surfaceAlt px-2 py-0.5 text-xs text-textMuted">
                {t(`lobbies.status.${lobby.status}`)}
              </span>
              <span className="text-sm font-semibold tabular-nums">
                {lobby.playerCount}/{lobby.maxPlayers}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              {visible.map((p) => (
                <Avatar
                  key={p.userId}
                  src={p.avatarUrl}
                  nickname={p.nickname}
                  size={26}
                />
              ))}
              {extra > 0 ? (
                <span className="rounded-full bg-surfaceAlt px-2 py-0.5 text-xs text-textMuted">
                  +{extra}
                </span>
              ) : null}
            </div>
            <div className="mt-2 truncate text-xs text-textMuted">
              {lobby.players.map((p) => p.nickname).join(', ')}
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}
