import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ChevronDown, ChevronUp, LogOut } from 'lucide-react';
import type { Lobby, LobbySettings } from '@durak/shared-types';
import { Alert, Button, Card, Spinner } from '@/components/ui';
import { useAuthStore } from '@/stores/auth.store';
import { getApiErrorCode, getApiErrorMessage } from '@/lib/api';
import {
  useDebouncedValue,
  useLeaveLobby,
  useLobbyRoom,
  useSetReady,
  useStartLobby,
  useUpdateLobbySettings,
} from './hooks';
import { LobbySettingsEditor } from './LobbySettingsEditor';
import { PlayerList } from './PlayerList';
import { SocketAckError } from '@/lib/socket';

export function LobbyRoomPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const me = useAuthStore((s) => s.user);
  const [toast, setToast] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [leavingExplicitly, setLeavingExplicitly] = useState(false);

  const onStarted = useCallback(
    (gameId: string) => {
      navigate(`/games/${gameId}`);
    },
    [navigate],
  );
  const onDeleted = useCallback(() => {
    if (!leavingExplicitly) {
      setToast({ kind: 'info', text: t('lobbies.deletedToast') });
      navigate('/', { replace: true });
    }
  }, [navigate, leavingExplicitly, t]);

  const room = useLobbyRoom(id, { onStarted, onDeleted });

  if (!id) return <Navigate to="/" replace />;

  if (room.isPending) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="text-accent" />
      </div>
    );
  }

  if (room.isError) {
    const code = getApiErrorCode(room.error);
    if (code === 'LOBBY_NOT_FOUND') return <NotFound />;
    return (
      <Alert variant="error">
        {getApiErrorMessage(room.error, t('errors.generic'))}
      </Alert>
    );
  }

  if (room.joinError) {
    if (room.joinError.code === 'LOBBY_NOT_FOUND') return <NotFound />;
    return (
      <div className="flex flex-col gap-3">
        <Alert variant="error">
          {t(`errors.${room.joinError.code}`, { defaultValue: room.joinError.message })}
        </Alert>
        <Link to="/">
          <Button variant="secondary">{t('game.backToHome')}</Button>
        </Link>
      </div>
    );
  }

  const lobby = room.data;
  if (!lobby) return null;

  return (
    <RoomContent
      lobby={lobby}
      meId={me?.id}
      toast={toast}
      onToast={setToast}
      settingsOpen={settingsOpen}
      onToggleSettings={() => setSettingsOpen((v) => !v)}
      onLeaveExplicit={() => setLeavingExplicitly(true)}
    />
  );
}

interface RoomContentProps {
  lobby: Lobby;
  meId: string | undefined;
  toast: { kind: 'error' | 'info'; text: string } | null;
  onToast: (t: { kind: 'error' | 'info'; text: string } | null) => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
  onLeaveExplicit: () => void;
}

function RoomContent({
  lobby,
  meId,
  toast,
  onToast,
  settingsOpen,
  onToggleSettings,
  onLeaveExplicit,
}: RoomContentProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setReady = useSetReady();
  const leave = useLeaveLobby();
  const start = useStartLobby();
  const updateSettings = useUpdateLobbySettings();

  const me = useMemo(
    () => (meId ? lobby.players.find((p) => p.userId === meId) ?? null : null),
    [lobby.players, meId],
  );
  const isParticipant = !!me;
  const allReady = lobby.players.length >= 2 && lobby.players.every((p) => p.isReady);
  const canStart = isParticipant && allReady;

  // Settings draft: we only diff against the server snapshot, so a participant
  // who fiddles with knobs immediately broadcasts to others (or, for the
  // number input, after a 300ms debounce).
  const [draft, setDraft] = useState<LobbySettings>(lobby.settings);
  // Stash the last seen server settings so an incoming `lobby:state` doesn't
  // clobber an in-progress local edit unless the values actually changed.
  const lastServerRef = useRef<LobbySettings>(lobby.settings);
  useEffect(() => {
    // Refresh draft when the server settings actually change vs what we last
    // saw — preserves the local typing experience.
    const incoming = lobby.settings;
    const prev = lastServerRef.current;
    if (!shallowEqualSettings(prev, incoming)) {
      setDraft(incoming);
      lastServerRef.current = incoming;
    }
  }, [lobby.settings]);

  const debouncedAttempts = useDebouncedValue(draft.cheatAttempts, 300);

  // Push diff -> server. We never send the full settings object: only the
  // fields that differ from the latest server snapshot.
  useEffect(() => {
    if (!isParticipant) return;
    const server = lobby.settings;
    const partial: Partial<LobbySettings> = {};
    (Object.keys(draft) as Array<keyof LobbySettings>).forEach((k) => {
      if (k === 'cheatAttempts') return; // handled separately (debounced)
      if (draft[k] !== server[k]) {
        // The two sides have the same shape; assignment is safe.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (partial[k] as any) = draft[k];
      }
    });
    if (Object.keys(partial).length === 0) return;
    updateSettings
      .mutateAsync({ lobbyId: lobby.id, settings: partial })
      .catch((err) => onToast({ kind: 'error', text: formatSocketError(err, t) }));
    // updateSettings reference is stable from useMutation; toast/translation are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    draft.maxPlayers,
    draft.firstBoutLimit,
    draft.attackerScope,
    draft.cheatingEnabled,
    draft.cheatNoticeScope,
    draft.layoutOnRepeat,
    draft.firstTurn,
    draft.deckSize,
    draft.jokers,
    draft.turnTimer,
    lobby.id,
    isParticipant,
  ]);

  useEffect(() => {
    if (!isParticipant) return;
    if (debouncedAttempts === lobby.settings.cheatAttempts) return;
    updateSettings
      .mutateAsync({
        lobbyId: lobby.id,
        settings: { cheatAttempts: debouncedAttempts },
      })
      .catch((err) => onToast({ kind: 'error', text: formatSocketError(err, t) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedAttempts, lobby.id, isParticipant]);

  const onReadyToggle = () => {
    if (!me) return;
    setReady
      .mutateAsync({ lobbyId: lobby.id, ready: !me.isReady })
      .catch((err) => onToast({ kind: 'error', text: formatSocketError(err, t) }));
  };

  const onLeave = () => {
    onLeaveExplicit();
    leave
      .mutateAsync(lobby.id)
      .then(() => navigate('/', { replace: true }))
      .catch((err) => onToast({ kind: 'error', text: formatSocketError(err, t) }));
  };

  const onStart = () => {
    start
      .mutateAsync(lobby.id)
      .catch((err) => onToast({ kind: 'error', text: formatSocketError(err, t) }));
  };

  const startDisabledReason = !isParticipant
    ? t('lobbies.startBlockedNotParticipant')
    : lobby.players.length < 2
      ? t('lobbies.startBlockedTooFew')
      : !allReady
        ? t('lobbies.startBlockedNotReady')
        : null;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold sm:text-2xl">{t('lobbies.roomTitle')}</h1>
          <p className="mt-1 text-xs text-textMuted">
            {t('lobbies.status.' + lobby.status)} · {lobby.players.length}/
            {lobby.settings.maxPlayers}
          </p>
        </div>
        {isParticipant ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={onLeave}
            disabled={leave.isPending}
          >
            <LogOut className="h-4 w-4" />
            {t('lobbies.leave')}
          </Button>
        ) : null}
      </header>

      {toast ? (
        <Alert
          variant={toast.kind === 'error' ? 'error' : 'info'}
          className="cursor-pointer"
          onClick={() => onToast(null)}
        >
          {toast.text}
        </Alert>
      ) : null}

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-textMuted">
          {t('lobbies.playersTitle')}
        </h2>
        <PlayerList
          players={lobby.players}
          maxPlayers={lobby.settings.maxPlayers}
          currentUserId={meId}
        />
        {isParticipant ? (
          <div className="mt-4">
            <Button
              variant={me?.isReady ? 'secondary' : 'primary'}
              block
              onClick={onReadyToggle}
              disabled={setReady.isPending}
            >
              {me?.isReady ? t('lobbies.unready') : t('lobbies.ready')}
            </Button>
          </div>
        ) : null}
      </Card>

      <Card>
        <button
          type="button"
          onClick={onToggleSettings}
          className="-m-1 flex w-full items-center justify-between rounded-lg p-1 text-left sm:cursor-default sm:pointer-events-none"
          aria-expanded={settingsOpen}
          aria-controls="lobby-settings"
        >
          <h2 className="text-sm font-semibold text-textMuted">
            {t('lobbies.settingsTitle')}
          </h2>
          <span className="sm:hidden text-textMuted">
            {settingsOpen ? (
              <ChevronUp className="h-5 w-5" />
            ) : (
              <ChevronDown className="h-5 w-5" />
            )}
          </span>
        </button>
        <div
          id="lobby-settings"
          className={settingsOpen ? 'mt-3 block' : 'mt-3 hidden sm:block'}
        >
          <LobbySettingsEditor
            value={draft}
            onChange={setDraft}
            disabled={!isParticipant || updateSettings.isPending}
            showResetWarning
          />
        </div>
      </Card>

      {isParticipant ? (
        <div>
          <Button
            block
            onClick={onStart}
            disabled={!canStart || start.isPending}
            title={startDisabledReason ?? undefined}
          >
            {start.isPending ? t('lobbies.starting') : t('lobbies.start')}
          </Button>
          {startDisabledReason ? (
            <p className="mt-1 text-center text-xs text-textMuted">
              {startDisabledReason}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function NotFound() {
  const { t } = useTranslation();
  return (
    <Card className="text-center">
      <h1 className="text-xl font-semibold">{t('lobbies.notFoundTitle')}</h1>
      <p className="mt-2 text-sm text-textMuted">
        {t('lobbies.notFoundDescription')}
      </p>
      <div className="mt-4">
        <Link to="/">
          <Button variant="secondary">{t('game.backToHome')}</Button>
        </Link>
      </div>
    </Card>
  );
}

function shallowEqualSettings(a: LobbySettings, b: LobbySettings): boolean {
  return (
    a.maxPlayers === b.maxPlayers &&
    a.firstBoutLimit === b.firstBoutLimit &&
    a.attackerScope === b.attackerScope &&
    a.cheatingEnabled === b.cheatingEnabled &&
    a.cheatAttempts === b.cheatAttempts &&
    a.cheatNoticeScope === b.cheatNoticeScope &&
    a.layoutOnRepeat === b.layoutOnRepeat &&
    a.firstTurn === b.firstTurn &&
    a.deckSize === b.deckSize &&
    a.jokers === b.jokers &&
    a.turnTimer === b.turnTimer
  );
}

function formatSocketError(err: unknown, t: TFunction): string {
  if (err instanceof SocketAckError) {
    return t(`errors.${err.code}`, { defaultValue: err.message });
  }
  if (err instanceof Error) return err.message;
  return t('errors.generic');
}
