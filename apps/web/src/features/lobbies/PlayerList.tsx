import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Check } from 'lucide-react';
import type { LobbyPlayer } from '@durak/shared-types';
import { Avatar } from '@/components/Avatar';

interface PlayerListProps {
  players: LobbyPlayer[];
  maxPlayers: number;
  currentUserId: string | undefined;
}

export function PlayerList({ players, maxPlayers, currentUserId }: PlayerListProps) {
  const { t } = useTranslation();
  const slots = Math.max(maxPlayers, players.length);

  return (
    <ul className="flex flex-col gap-2">
      {Array.from({ length: slots }).map((_, idx) => {
        const player = players[idx];
        return (
          <li
            key={player?.userId ?? `empty-${idx}`}
            className={clsx(
              'flex items-center gap-3 rounded-xl border px-3 py-2',
              player
                ? 'border-border bg-surfaceAlt'
                : 'border-dashed border-border/60 bg-transparent text-textMuted',
            )}
          >
            {player ? (
              <>
                <Avatar
                  src={player.avatarUrl}
                  nickname={player.nickname}
                  size={36}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {player.nickname}
                    {player.userId === currentUserId ? (
                      <span className="ml-2 text-xs text-accent">
                        {t('lobbies.you')}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-textMuted">
                    {player.isReady
                      ? t('lobbies.statusReady')
                      : t('lobbies.statusNotReady')}
                  </div>
                </div>
                <ReadyIndicator ready={player.isReady} />
              </>
            ) : (
              <span className="text-sm">{t('lobbies.emptySlot')}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ReadyIndicator({ ready }: { ready: boolean }) {
  return (
    <span
      className={clsx(
        'inline-flex h-7 w-7 items-center justify-center rounded-full border',
        ready
          ? 'border-success bg-success/20 text-success'
          : 'border-border bg-surface text-textMuted',
      )}
      aria-hidden="true"
    >
      {ready ? <Check className="h-4 w-4" /> : null}
    </span>
  );
}
