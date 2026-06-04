import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MessageCircle, Settings2 } from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { Alert, Button, Card, Modal, Spinner } from '@/components/ui';
import { getApiErrorMessage } from '@/lib/api';
import { SocketAckError } from '@/lib/socket';
import { useAuthStore } from '@/stores/auth.store';
import { useGame, useGameChat, useGameCommand } from './hooks';
import { GameChatPanel } from './GameChatPanel';
import { GameDetailView } from './GameDetailView';
import {
  ATTACK_DROP_ID_PREFIX,
  GameTable,
  TABLE_DROP_ID,
} from './GameTable';
import { HAND_CARD_DRAG_ID_PREFIX, PlayerHand } from './PlayerHand';
import { PlayingCard } from './PlayingCard';
import { OpponentSeat, CheatAttemptsBadge } from './OpponentSeat';
import { TrumpIndicator } from './TrumpIndicator';
import { DiscardPile } from './DiscardPile';
import { ActionBar } from './ActionBar';
import { GameOverModal } from './GameOverModal';
import { GameSettingsModal } from './GameSettingsModal';
import { GameStatusBar } from './GameStatusBar';
import {
  canAttackWith,
  canBeatCard,
  canPlayerNoticeEntry,
  canTranslateWith,
} from './legality';
import type {
  AttackEntry,
  Card as PlayingCardType,
  ClientGameState,
  ClientGamePlayer,
  DomainEvent,
  GameCommand,
} from './types';

export function GamePage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  // Phase 7B — the hook now discriminates between live and finished games.
  // We always call it so the rules of hooks are respected; the `id` guard
  // below short-circuits the render path.
  const game = useGame(id);

  if (!id) {
    return <Navigate to="/" replace />;
  }

  switch (game.kind) {
    case 'loading':
      return (
        <div className="flex justify-center py-12">
          <Spinner className="text-accent" />
        </div>
      );
    case 'not_found':
      return <NotFound />;
    case 'error':
      return (
        <Alert variant="error">
          {getApiErrorMessage(game.error, t('errors.generic'))}
        </Alert>
      );
    case 'finished':
      return <GameDetailView detail={game.detail} />;
    case 'live':
      return (
        <GameRoom
          gameId={id}
          state={game.state}
          unseenEvents={game.unseenEvents}
          onAcknowledgeEvents={game.acknowledgeEvents}
          subscribeError={game.subscribeError}
        />
      );
  }
}

interface GameRoomProps {
  gameId: string;
  state: ClientGameState;
  unseenEvents: DomainEvent[];
  onAcknowledgeEvents: (count: number) => void;
  subscribeError: { code: string; message: string } | null;
}

function GameRoom({
  gameId,
  state,
  unseenEvents,
  onAcknowledgeEvents,
  subscribeError,
}: GameRoomProps) {
  const { t } = useTranslation();
  const me = useAuthStore((s) => s.user);
  const sendCommand = useGameCommand(gameId);
  const [error, setError] = useState<string | null>(null);
  const [gameOverDismissed, setGameOverDismissed] = useState(false);
  const [sending, setSending] = useState(false);
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  // Short-lived inline hint shown when a drop was captured but rejected
  // client-side (e.g. an illegal beat). Surfaces silent returns so the player
  // gets feedback instead of an unexplained card-bounce.
  const [transientHint, setTransientHint] = useState<string | null>(null);
  const transientHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showTransientHint = useCallback((msg: string) => {
    setTransientHint(msg);
    if (transientHintTimer.current) clearTimeout(transientHintTimer.current);
    transientHintTimer.current = setTimeout(
      () => setTransientHint(null),
      2200,
    );
  }, []);
  useEffect(
    () => () => {
      if (transientHintTimer.current) clearTimeout(transientHintTimer.current);
    },
    [],
  );

  const myUserId = state.myUserId || me?.id || '';
  const mySeat = useMemo(
    () => state.players.find((p) => p.id === myUserId) ?? null,
    [state.players, myUserId],
  );
  const myHand = useMemo<PlayingCardType[]>(
    () => mySeat?.hand ?? [],
    [mySeat],
  );
  const handById = useMemo(() => {
    const m = new Map<string, PlayingCardType>();
    for (const c of myHand) m.set(c.id, c);
    return m;
  }, [myHand]);

  const isAttacker = state.currentAttackerId === myUserId;
  const isDefender = state.currentDefenderId === myUserId;
  const status = state.status;
  const settings = state.settings;
  const cheatingOn = settings.cheatingEnabled === true;

  // ----- notice-cheat confirm modal state ----------------------------------
  // Holds the entry being flagged + a snapshot of whether it's a beat-cheat at
  // the moment the modal was opened. We snapshot so the confirmation copy
  // doesn't suddenly switch under the user if the table updates while the
  // modal is open.
  const [pendingCheatEntry, setPendingCheatEntry] = useState<{
    entryId: string;
    isBeat: boolean;
  } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  // We need the unread badge in the header even while the panel is closed —
  // pull it via the same hook the panel uses (same TanStack-Query cache key, so
  // there's no duplicate subscription cost).
  const chat = useGameChat(gameId);
  const onOpenChat = useCallback(() => {
    setChatOpen(true);
    chat.markAllRead();
  }, [chat]);

  const tableHasUnbeaten = useMemo(
    () => state.table.attacks.some((a) => a.beatenBy === null),
    [state.table.attacks],
  );

  // ----- DnD sensors (touch + mouse with small activation distance) ------
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 80, tolerance: 5 },
    }),
  );

  // -------- command runner --------
  const run = useCallback(
    async (command: GameCommand) => {
      if (sending) return;
      setSending(true);
      setError(null);
      try {
        await sendCommand(command);
      } catch (err: unknown) {
        setError(formatCommandError(err, t));
      } finally {
        setSending(false);
      }
    },
    [sendCommand, t, sending],
  );

  // -------- which drop zones are "active" right now --------
  // These flags decide whether the centre / per-attack droppables register.
  // When cheating is ON every zone the role could conceivably drop on is
  // active so the server gets the chance to log the cheat attempt.
  const canDropOnCenter = useMemo(() => {
    if (status === 'dealing' || status === 'game_over') return false;
    if (isDefender && status === 'bout_defense') {
      // Defender can translate via centre.
      return true;
    }
    // Attacker / throw-in / defender-translates-via-attack on settle.
    if (isDefender) return false;
    if (status === 'bout_attack') return isAttacker;
    if (
      status === 'bout_defense' ||
      status === 'bout_settle' ||
      status === 'bout_take_pending'
    ) {
      return settings.attackerScope === 'all' || isAttacker;
    }
    return false;
  }, [status, isAttacker, isDefender, settings.attackerScope]);

  // Set of attack entry ids that should glow as legal beat targets. We
  // compute this without knowing which card is being dragged — it's just the
  // set of "this is a place a beat could conceivably land". With cheating off
  // we further narrow it down per-card below.
  const highlightedAttackIds = useMemo<ReadonlySet<string>>(() => {
    if (!isDefender || status !== 'bout_defense') return new Set();
    const ids = new Set<string>();
    // No card dragged → highlight every unbeaten entry as a hint.
    if (draggingCardId === null) {
      for (const a of state.table.attacks) {
        if (a.beatenBy === null) ids.add(a.id);
      }
      return ids;
    }
    const dragCard = handById.get(draggingCardId);
    if (!dragCard) return ids;
    for (const a of state.table.attacks) {
      if (a.beatenBy !== null) continue;
      if (cheatingOn || canBeatCard(dragCard, a.card, state.trumpSuit)) {
        ids.add(a.id);
      }
    }
    return ids;
  }, [
    isDefender,
    status,
    draggingCardId,
    state.table.attacks,
    state.trumpSuit,
    handById,
    cheatingOn,
  ]);

  // Set of unbeaten attack ids that should *accept drops at all*. This is
  // broader than `highlightedAttackIds`: when the defender is in defense, we
  // want every unbeaten entry to grab the drop so a slightly-off release
  // doesn't fall through to the centre zone and get misinterpreted as a fresh
  // attack / translate (which then returns ATTACK_LIMIT_REACHED if the cap is
  // hit). The handler still validates the move and shows feedback if the card
  // can't actually beat the targeted attack.
  const droppableAttackIds = useMemo<ReadonlySet<string>>(() => {
    if (!isDefender || status !== 'bout_defense') return new Set();
    const ids = new Set<string>();
    for (const a of state.table.attacks) {
      if (a.beatenBy === null) ids.add(a.id);
    }
    return ids;
  }, [isDefender, status, state.table.attacks]);

  // -------- notice-cheat eligibility per entry ----------------------------
  // Split into two sets so the table can decide independently whether to
  // render the icon on the *attack* card or the *beat* (defense) card. Both
  // are recomputed only when settings/table/current-defender shift.
  const noticeableAttackIds = useMemo<ReadonlySet<string>>(() => {
    if (!cheatingOn) return new Set();
    const ids = new Set<string>();
    for (const a of state.table.attacks) {
      if (a.beatenBy !== null) continue;
      if (canPlayerNoticeEntry(state, a, myUserId)) ids.add(a.id);
    }
    return ids;
  }, [cheatingOn, state, myUserId]);
  const noticeableBeatIds = useMemo<ReadonlySet<string>>(() => {
    if (!cheatingOn) return new Set();
    const ids = new Set<string>();
    for (const a of state.table.attacks) {
      if (a.beatenBy === null) continue;
      if (canPlayerNoticeEntry(state, a, myUserId)) ids.add(a.id);
    }
    return ids;
  }, [cheatingOn, state, myUserId]);

  const onNoticeCheat = useCallback(
    (attackEntryId: string) => {
      const entry = state.table.attacks.find(
        (a: AttackEntry) => a.id === attackEntryId,
      );
      if (!entry) return;
      setPendingCheatEntry({ entryId: entry.id, isBeat: entry.beatenBy !== null });
    },
    [state.table.attacks],
  );
  const confirmNoticeCheat = useCallback(() => {
    if (!pendingCheatEntry) return;
    const cmd: GameCommand = {
      type: 'notice_cheat',
      playerId: myUserId,
      attackEntryId: pendingCheatEntry.entryId,
    };
    setPendingCheatEntry(null);
    void run(cmd);
  }, [pendingCheatEntry, myUserId, run]);

  // Is the centre zone *visually* highlighted? Mirrors the legality the same
  // way attack zones do.
  const centerActive = useMemo(() => {
    if (!canDropOnCenter) return false;
    if (draggingCardId === null) return true;
    const card = handById.get(draggingCardId);
    if (!card) return false;
    if (cheatingOn) return true;
    if (isDefender && status === 'bout_defense') {
      return canTranslateWith(card, state.table.attacks);
    }
    return canAttackWith(card, state.table.attacks);
  }, [
    canDropOnCenter,
    draggingCardId,
    handById,
    cheatingOn,
    isDefender,
    status,
    state.table.attacks,
  ]);

  // -------- drag handlers --------
  const onDragStart = useCallback((ev: DragStartEvent) => {
    const id = String(ev.active.id);
    if (id.startsWith(HAND_CARD_DRAG_ID_PREFIX)) {
      setDraggingCardId(id.slice(HAND_CARD_DRAG_ID_PREFIX.length));
    }
    setOverId(null);
  }, []);

  const onDragOver = useCallback((ev: DragOverEvent) => {
    setOverId(ev.over ? String(ev.over.id) : null);
  }, []);

  const onDragCancel = useCallback(() => {
    setDraggingCardId(null);
    setOverId(null);
  }, []);

  const onDragEnd = useCallback(
    (ev: DragEndEvent) => {
      const activeId = String(ev.active.id);
      setDraggingCardId(null);
      setOverId(null);
      if (!activeId.startsWith(HAND_CARD_DRAG_ID_PREFIX)) return;
      const cardId = activeId.slice(HAND_CARD_DRAG_ID_PREFIX.length);
      const card = handById.get(cardId);
      if (!card) return;

      // Dropped outside any zone → return to hand silently.
      if (!ev.over) return;
      const dropId = String(ev.over.id);

      // Beat a specific attack entry.
      if (dropId.startsWith(ATTACK_DROP_ID_PREFIX)) {
        const attackEntryId = dropId.slice(ATTACK_DROP_ID_PREFIX.length);
        const entry = state.table.attacks.find((a) => a.id === attackEntryId);
        if (!entry) return;
        if (entry.beatenBy !== null) {
          // Beaten entries are no longer droppable (see GameTable), but guard
          // anyway in case props get out of sync.
          showTransientHint(t('game.hints.alreadyBeaten'));
          return;
        }
        if (!cheatingOn && !canBeatCard(card, entry.card, state.trumpSuit)) {
          showTransientHint(t('game.hints.cantBeat'));
          return;
        }
        void run({
          type: 'beat',
          playerId: myUserId,
          attackEntryId,
          defenseCardId: cardId,
        });
        return;
      }

      // Centre = attack / throw-in / translate.
      if (dropId === TABLE_DROP_ID) {
        if (isDefender && status === 'bout_defense') {
          // Defender at centre → translate. Illegal-rank drops bounce back.
          if (!cheatingOn && !canTranslateWith(card, state.table.attacks)) {
            showTransientHint(t('game.hints.cantTranslate'));
            return;
          }
          void run({ type: 'translate', playerId: myUserId, cardId });
          return;
        }
        // Non-defender → attack/throw-in.
        if (!cheatingOn && !canAttackWith(card, state.table.attacks)) {
          showTransientHint(t('game.hints.cantAttack'));
          return;
        }
        void run({ type: 'attack', playerId: myUserId, cardId });
        return;
      }
    },
    [
      handById,
      cheatingOn,
      isDefender,
      status,
      state.table.attacks,
      state.trumpSuit,
      run,
      myUserId,
      showTransientHint,
      t,
    ],
  );

  // -------- action buttons (Беру / Бито only — attack via drag) --------
  const showTake =
    status === 'bout_defense' && isDefender && tableHasUnbeaten && !!mySeat;
  const canPass = useMemo(
    () => playerCanPass(state, myUserId),
    [state, myUserId],
  );
  const showPass = canPass;

  const onTake = () =>
    void run({ type: 'take', playerId: myUserId });
  const onPass = () =>
    void run({ type: 'pass', playerId: myUserId });

  // -------- opponents arrangement --------
  // Order opponents by seat going clockwise from the viewer. Engine's
  // state.players array is already in stable seat order around the table, so
  // we just rotate it so that "me" sits at index 0 and the player to my left
  // (next clockwise) is first in the opponents list. This gives every viewer
  // the SAME relative geometry — the active attacker/defender highlight is
  // still drawn via colored rings, but their visual slot doesn't move.
  const opponents = useMemo(() => {
    const myIndex = state.players.findIndex((p) => p.id === myUserId);
    if (myIndex < 0) return state.players.filter((p) => p.id !== myUserId);
    const ordered: ClientGamePlayer[] = [];
    for (let i = 1; i < state.players.length; i++) {
      ordered.push(state.players[(myIndex + i) % state.players.length]);
    }
    return ordered;
  }, [state.players, myUserId]);
  const seats = arrangeOpponents(opponents);

  // -------- default status (used by status-bar fallback + header chip) ----
  const defaultStatus = useMemo(() => {
    const attackerName =
      state.players.find((p) => p.id === state.currentAttackerId)?.nickname ??
      '?';
    const defenderName =
      state.players.find((p) => p.id === state.currentDefenderId)?.nickname ??
      '?';
    switch (status) {
      case 'dealing':
        return t('game.status.dealing');
      case 'bout_attack':
        return t('game.status.attacking', { nickname: attackerName });
      case 'bout_defense':
        return t('game.status.defending', { nickname: defenderName });
      case 'bout_settle':
        return t('game.status.settling');
      case 'bout_take_pending':
        return t('game.status.takePending', { nickname: defenderName });
      case 'game_over':
        return t('game.status.over');
      default:
        return '';
    }
  }, [
    status,
    state.players,
    state.currentAttackerId,
    state.currentDefenderId,
    t,
  ]);

  const isGameOver = status === 'game_over';
  const dragOverlayCard = draggingCardId ? handById.get(draggingCardId) : null;

  // -------- drag-intent badge (shown next to the floating overlay) --------
  // Mirrors what the drop handler would do given the current `over` target,
  // so the player can tell whether release means "beat", "throw-in", "translate"
  // or no-op. Computed inline rather than memoised — it changes on every
  // pointer move while a card is in flight and there's nothing expensive here.
  let dragIntent: 'beat' | 'attack' | 'translate' | 'none' = 'none';
  if (dragOverlayCard && overId) {
    if (overId.startsWith(ATTACK_DROP_ID_PREFIX)) {
      const attackEntryId = overId.slice(ATTACK_DROP_ID_PREFIX.length);
      const entry = state.table.attacks.find((a) => a.id === attackEntryId);
      if (entry && entry.beatenBy === null) {
        const legal =
          cheatingOn ||
          canBeatCard(dragOverlayCard, entry.card, state.trumpSuit);
        if (legal) dragIntent = 'beat';
      }
    } else if (overId === TABLE_DROP_ID) {
      if (isDefender && status === 'bout_defense') {
        const legal =
          cheatingOn ||
          canTranslateWith(dragOverlayCard, state.table.attacks);
        if (legal) dragIntent = 'translate';
      } else {
        const legal =
          cheatingOn || canAttackWith(dragOverlayCard, state.table.attacks);
        if (legal) dragIntent = 'attack';
      }
    }
  }

  if (subscribeError && !state) {
    if (subscribeError.code === 'GAME_NOT_FOUND') return <NotFound />;
    return (
      <Alert variant="error">
        {t(`errors.${subscribeError.code}`, {
          defaultValue: subscribeError.message,
        })}
      </Alert>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div className="flex flex-col gap-3" data-testid="game-room">
        <header className="flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-textMuted">
            <span>{t('game.bout', { number: state.boutNumber })}</span>
            {cheatingOn && mySeat ? (
              <CheatAttemptsBadge
                remaining={mySeat.cheatAttemptsRemaining}
                ariaLabel={t('game.cheat.attemptsRemaining', {
                  count: mySeat.cheatAttemptsRemaining,
                })}
              />
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-md bg-surfaceAlt px-2 py-1 font-medium">
              {defaultStatus}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onOpenChat}
              aria-label={t('game.chat.openAria')}
              data-testid="open-game-chat"
              className="relative !h-8 gap-1 !px-2"
            >
              <MessageCircle className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">
                {t('game.chat.openButton')}
              </span>
              {chat.unreadCount > 0 ? (
                <span
                  className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white"
                  aria-label={t('game.chat.unreadAria', {
                    count: chat.unreadCount,
                  })}
                  data-testid="chat-unread-badge"
                >
                  {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
                </span>
              ) : null}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSettingsOpen(true)}
              aria-label={t('game.settings.openAria')}
              data-testid="open-game-settings"
              className="!h-8 gap-1 !px-2"
            >
              <Settings2 className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">
                {t('game.settings.openButton')}
              </span>
            </Button>
          </div>
        </header>

        {error ? (
          <Alert
            variant="error"
            className="sticky top-2 z-30 cursor-pointer text-sm font-semibold shadow-lg"
            onClick={() => setError(null)}
            data-testid="command-error"
          >
            {error}
          </Alert>
        ) : null}

        {/* Opponents row + corner meta */}
        <div className="grid grid-cols-12 items-start gap-2">
          <div className="col-span-2 flex flex-col items-center gap-2">
            <TrumpIndicator
              trumpCard={state.trumpCard}
              trumpSuit={state.trumpSuit}
              deckSize={state.deckSize}
            />
          </div>
          <div className="col-span-8 flex flex-wrap items-start justify-center gap-2">
            {seats.top.map((p) => (
              <OpponentSeat
                key={p.id}
                player={p}
                isAttacker={p.id === state.currentAttackerId}
                isDefender={p.id === state.currentDefenderId}
                showCheatBadge={cheatingOn}
              />
            ))}
          </div>
          <div className="col-span-2 flex flex-col items-center gap-2">
            <DiscardPile discardSize={state.discardSize} />
          </div>
        </div>

        {/* Side seats (only for 5-6 players) */}
        {(seats.left.length > 0 || seats.right.length > 0) && (
          <div className="grid grid-cols-12 items-start gap-2">
            <div className="col-span-2 flex flex-col gap-2">
              {seats.left.map((p) => (
                <OpponentSeat
                  key={p.id}
                  player={p}
                  isAttacker={p.id === state.currentAttackerId}
                  isDefender={p.id === state.currentDefenderId}
                  compact
                  showCheatBadge={cheatingOn}
                />
              ))}
            </div>
            <div className="col-span-8" />
            <div className="col-span-2 flex flex-col gap-2">
              {seats.right.map((p) => (
                <OpponentSeat
                  key={p.id}
                  player={p}
                  isAttacker={p.id === state.currentAttackerId}
                  isDefender={p.id === state.currentDefenderId}
                  compact
                  showCheatBadge={cheatingOn}
                />
              ))}
            </div>
          </div>
        )}

        <GameTable
          attacks={state.table.attacks}
          centerActive={centerActive}
          highlightedAttackIds={highlightedAttackIds}
          droppableAttackIds={droppableAttackIds}
          noticeableAttackIds={noticeableAttackIds}
          noticeableBeatIds={noticeableBeatIds}
          onNoticeCheat={onNoticeCheat}
        />

        <ActionBar
          showTake={showTake}
          showPass={showPass}
          passLabelKey={
            status === 'bout_take_pending'
              ? 'game.actions.passTake'
              : 'game.actions.pass'
          }
          onTake={onTake}
          onPass={onPass}
          disabled={sending}
        />

        <GameStatusBar
          unseenEvents={unseenEvents}
          state={state}
          onConsume={onAcknowledgeEvents}
          defaultStatus={defaultStatus}
          transientHint={transientHint}
        />

        <PlayerHand
          hand={myHand}
          trumpSuit={state.trumpSuit}
          draggingCardId={draggingCardId}
        />

        <DragOverlay dropAnimation={null}>
          {dragOverlayCard ? (
            <div
              className="pointer-events-none relative"
              data-testid="drag-overlay"
            >
              <PlayingCard
                card={dragOverlayCard}
                size="lg"
                className="shadow-2xl"
              />
              {dragIntent !== 'none' ? (
                <span
                  className="pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-white shadow"
                  data-testid={`drag-intent-${dragIntent}`}
                >
                  {t(`game.actions.${dragIntent}`)}
                </span>
              ) : null}
            </div>
          ) : null}
        </DragOverlay>

        {isGameOver ? (
          <GameOverModal
            state={state}
            open={!gameOverDismissed}
            onClose={() => setGameOverDismissed(true)}
          />
        ) : null}

        <GameSettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          settings={state.settings}
          playerCount={state.players.length}
        />

        <GameChatPanel
          gameId={gameId}
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          myUserId={myUserId}
        />

        <Modal
          open={pendingCheatEntry !== null}
          onClose={() => setPendingCheatEntry(null)}
          dismissible={!sending}
          title={t('game.cheat.confirmTitle')}
          footer={
            <>
              <Button
                variant="ghost"
                onClick={() => setPendingCheatEntry(null)}
                disabled={sending}
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="danger"
                onClick={confirmNoticeCheat}
                disabled={sending}
                data-testid="confirm-notice-cheat"
              >
                {t('game.cheat.confirmAction')}
              </Button>
            </>
          }
        >
          <p className="text-sm">
            {pendingCheatEntry?.isBeat
              ? t('game.cheat.confirmBeatBody')
              : t('game.cheat.confirmAttackBody')}
          </p>
        </Modal>
      </div>
    </DndContext>
  );
}

// ---------- helpers ----------

function NotFound() {
  const { t } = useTranslation();
  return (
    <Card className="text-center">
      <h1 className="text-xl font-semibold">{t('game.notFoundTitle')}</h1>
      <p className="mt-2 text-sm text-textMuted">
        {t('game.notFoundDescription')}
      </p>
      <div className="mt-4">
        <Link to="/">
          <Button variant="secondary">{t('game.backToHome')}</Button>
        </Link>
      </div>
    </Card>
  );
}

/**
 * `pass` is the "Бито"/"Пусть берёт" action. Rough client-side gating:
 *  - bout_settle: anyone with throw-in rights who hasn't passed yet.
 *  - bout_take_pending: anyone with throw-in rights who hasn't passed yet —
 *    confirms "Пусть берёт" so the defender can finally take.
 *  - bout_defense: pass not available (the engine has separate beat/take paths).
 */
function playerCanPass(state: ClientGameState, myUserId: string): boolean {
  const me = state.players.find((p) => p.id === myUserId);
  if (!me || me.isFinished || me.isPassed) return false;
  if (state.status !== 'bout_settle' && state.status !== 'bout_take_pending') {
    return false;
  }
  // attacker_only policy lets only the rotating attacker pass; `all` allows
  // anyone but the defender (who passes implicitly).
  const isDefender = state.currentDefenderId === myUserId;
  if (isDefender) return false;
  if (state.settings.attackerScope === 'attacker_only') {
    return state.currentAttackerId === myUserId;
  }
  return true;
}

interface SeatLayout {
  top: ClientGamePlayer[];
  left: ClientGamePlayer[];
  right: ClientGamePlayer[];
}

/**
 * Mobile-first opponent layout. Opponents arrive already ordered clockwise
 * from the viewer (player to my left first, around to player on my right last).
 * Up to 4 opponents go across the top; 5+ opponents (only in a 6-player game)
 * split into top row + side columns. The leftmost slot is always the player
 * to the viewer's left so seating is consistent across all clients.
 */
function arrangeOpponents(opponents: ClientGamePlayer[]): SeatLayout {
  if (opponents.length <= 4) {
    return { top: opponents, left: [], right: [] };
  }
  if (opponents.length === 5) {
    // Left seat = next-clockwise neighbour, right seat = previous-clockwise.
    return {
      top: opponents.slice(1, 4),
      left: [opponents[0]],
      right: [opponents[4]],
    };
  }
  // 6 opponents (7-player game — not in scope per spec, max is 6 total).
  return {
    top: opponents.slice(2, 4),
    left: opponents.slice(0, 2),
    right: opponents.slice(4, 6),
  };
}

function formatCommandError(err: unknown, t: TFunction): string {
  if (err instanceof SocketAckError) {
    return t(`game.errors.${err.code}`, {
      defaultValue: t(`errors.${err.code}`, { defaultValue: err.message }),
    });
  }
  if (err instanceof Error) return err.message;
  return t('errors.generic');
}
