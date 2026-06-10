import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MessageCircle, MessageSquareText, Settings2, Smile } from 'lucide-react';
import { EMOJI_REACTIONS } from '@durak/shared-types';
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
import {
  useFaceCardAssets,
  useGame,
  useGameChat,
  useGameCommand,
  useGameReactions,
  useGameTextReactions,
  usePauseVote,
  useTextReactions,
} from './hooks';
import { GameChatPanel } from './GameChatPanel';
import { ReactionBubble } from './ReactionBubble';
import { GameDetailView } from './GameDetailView';
import { PauseOverlay } from './PauseOverlay';
import {
  ATTACK_DROP_ID_PREFIX,
  GameTable,
  TABLE_DROP_ID,
} from './GameTable';
import { HAND_CARD_DRAG_ID_PREFIX, PlayerHand } from './PlayerHand';
import { PlayingCard } from './PlayingCard';
import { CheatAttemptsBadge } from './OpponentSeat';
import { PlayerChip } from './PlayerChip';
import { RadialOpponents } from './RadialOpponents';
import { DeckStack } from './DeckStack';
import { ActionBar } from './ActionBar';
import { GameOverModal } from './GameOverModal';
import { GameSettingsModal } from './GameSettingsModal';
import { GameStatusBar } from './GameStatusBar';
import {
  canAttackWith,
  canBeatCard,
  canPlayerNoticeEntry,
  canTranslateWith,
  isExclusiveThrowInLocked,
} from './legality';
import type {
  AttackEntry,
  Card as PlayingCardType,
  ClientGameState,
  ClientGamePlayer,
  DomainEvent,
  GameCommand,
  PauseInfo,
  TurnTimerState,
} from './types';

export function GamePage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  // Prefetch the global face-card asset map so every PlayingCard in the tree
  // can read uploaded J/Q/K images straight from the TanStack cache on first
  // render. Cheap — staleTime is 5 min, the page-shell calls it once.
  useFaceCardAssets();
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
          pauseInfo={game.pauseInfo}
          turnTimer={game.turnTimer}
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
  pauseInfo: PauseInfo | null;
  turnTimer: TurnTimerState | null;
}

function GameRoom({
  gameId,
  state,
  unseenEvents,
  onAcknowledgeEvents,
  subscribeError,
  pauseInfo,
  turnTimer,
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

  // Spectators receive a redacted snapshot where `myUserId` is set to a
  // sentinel ('__spectator__'). The page must treat them as read-only — no
  // commands, no drag, no chat input, no reactions. The PauseOverlay still
  // renders (informational); the GameOverModal still renders.
  const isSpectator = state.isSpectator === true;
  const myUserId = isSpectator ? '' : state.myUserId || me?.id || '';
  const pauseVote = usePauseVote(gameId, myUserId);
  const mySeat = useMemo(
    () =>
      isSpectator
        ? null
        : (state.players.find((p) => p.id === myUserId) ?? null),
    [state.players, myUserId, isSpectator],
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
  // Mirrors `ExclusiveThrowInPolicy` — true when the viewer is currently
  // locked out of throwing because the primary attacker hasn't said "бито"
  // yet. Used to disable drag drops + show a transient hint, and to dim
  // cards in the hand. The server is still authoritative.
  const exclusiveLocked = useMemo(
    () => isExclusiveThrowInLocked(state, myUserId),
    [state, myUserId],
  );
  // Nickname of the player who currently holds the throw-in lock — used in
  // the transient hint and PlayerHand tooltip.
  const primaryAttackerNickname = useMemo(() => {
    if (!exclusiveLocked) return '';
    return (
      state.players.find((p) => p.id === state.currentAttackerId)?.nickname ?? ''
    );
  }, [exclusiveLocked, state.players, state.currentAttackerId]);

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
  // We need the unread badge in the header even while the drawer is closed —
  // pull it via the same hook the panel uses (same TanStack-Query cache key, so
  // there's no duplicate subscription cost). On desktop (xl+) the chat sidebar
  // is permanently visible and calls `markAllRead` on its own — the badge there
  // is hidden via CSS so the bookkeeping mismatch is harmless.
  const chat = useGameChat(gameId);
  const onOpenChat = useCallback(() => {
    setChatOpen(true);
    chat.markAllRead();
  }, [chat]);

  // In-game seat reactions. Listens for `game:player_reaction` and keeps a
  // per-userId map of what's currently floating; the bubble itself auto-fades
  // via the CSS keyframe. `send(emoji)` round-trips the picker selection.
  const reactionsHook = useGameReactions(gameId);
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  // Outside-click + Escape close the reaction picker so the user doesn't have
  // to tap the trigger again to dismiss it.
  const reactionPickerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!reactionPickerOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const root = reactionPickerRef.current;
      if (root && e.target instanceof Node && !root.contains(e.target)) {
        setReactionPickerOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setReactionPickerOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [reactionPickerOpen]);
  const onPickReaction = useCallback(
    async (emoji: string) => {
      setReactionPickerOpen(false);
      try {
        await reactionsHook.send(emoji);
      } catch (err: unknown) {
        if (err instanceof SocketAckError) {
          setError(
            t(`game.errors.${err.code}`, {
              defaultValue: t(`errors.${err.code}`, { defaultValue: err.message }),
            }),
          );
        }
      }
    },
    [reactionsHook, t],
  );
  const myReaction = reactionsHook.reactions[myUserId] ?? null;

  // Sibling state for the admin-managed TEXT reactions. Picker, list and
  // outside-click close mirror the emoji picker above; the bubbles stack
  // on a separate per-user slot so an emoji + text bubble can coexist.
  const textReactionsHook = useGameTextReactions(gameId);
  const textReactionsList = useTextReactions();
  const [textReactionPickerOpen, setTextReactionPickerOpen] = useState(false);
  const textReactionPickerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!textReactionPickerOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const root = textReactionPickerRef.current;
      if (root && e.target instanceof Node && !root.contains(e.target)) {
        setTextReactionPickerOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTextReactionPickerOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [textReactionPickerOpen]);
  const onPickTextReaction = useCallback(
    async (textReactionId: string) => {
      setTextReactionPickerOpen(false);
      try {
        await textReactionsHook.send(textReactionId);
      } catch (err: unknown) {
        if (err instanceof SocketAckError) {
          setError(
            t(`game.errors.${err.code}`, {
              defaultValue: t(`errors.${err.code}`, { defaultValue: err.message }),
            }),
          );
        }
      }
    },
    [textReactionsHook, t],
  );
  const myTextReaction = textReactionsHook.textReactions[myUserId] ?? null;

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
      // Spectators have no commands to send — the UI shouldn't be wired up to
      // call this in the first place, but guard defensively so a stale event
      // never reaches the server.
      if (isSpectator) return;
      // Phase 8 — short-circuit while the game is paused. The server would
      // reject with GAME_PAUSED anyway; bailing here avoids a needless
      // round-trip and shows the user immediate feedback in the same
      // error slot the regular path uses.
      if (pauseInfo) {
        setError(t('game.errors.GAME_PAUSED'));
        return;
      }
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
    [sendCommand, t, sending, pauseInfo, isSpectator],
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
    // Defender's translate path is unaffected by the exclusive-throw-in lock
    // (the lock only gates the *attack* command). Non-defenders who are
    // currently locked out get a dim centre so the disabled state is
    // visible at a glance.
    if (exclusiveLocked && !(isDefender && status === 'bout_defense')) {
      return false;
    }
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
    exclusiveLocked,
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
        // Exclusive-throw-in lock: only the primary attacker may pile in
        // before they say "бито". Anyone else is bounced with a hint.
        if (exclusiveLocked) {
          showTransientHint(
            t('game.exclusiveThrowInWait', {
              nickname: primaryAttackerNickname || '?',
            }),
          );
          return;
        }
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
      exclusiveLocked,
      primaryAttackerNickname,
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

  // -------- players row ordering (clockwise from viewer) -----------------
  // Engine's `state.players` is already in stable seat order around the
  // table. We rotate the array so that "me" sits first and the player to my
  // left (next clockwise) follows immediately. The new layout collapses the
  // top/side seat grid into one horizontal strip — every viewer sees the
  // same relative geometry: themselves on the left, then clockwise round.
  // Opponents only: skip the viewer themselves and rotate the engine seat
  // order so the first chip is the next clockwise neighbour. Every client sees
  // the same physical seating relative to themselves.
  // Spectators are not in `state.players`, so we render every seat in raw
  // engine order — there's no "me" to anchor against.
  const playersInOrder = useMemo<ClientGamePlayer[]>(() => {
    if (isSpectator) return state.players;
    const myIndex = state.players.findIndex((p) => p.id === myUserId);
    if (myIndex < 0) {
      // Desync fallback — show everyone in raw engine order.
      return state.players;
    }
    const ordered: ClientGamePlayer[] = [];
    for (let i = 1; i < state.players.length; i++) {
      ordered.push(state.players[(myIndex + i) % state.players.length]);
    }
    return ordered;
  }, [state.players, myUserId, isSpectator]);

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
      } else if (!exclusiveLocked) {
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
      {/* Layout (top → bottom):
          1. info-strip — bout/status pill + trump + deck/discard counters
             + Rules / Reaction / Chat buttons.
          2. players-row — every participant in clockwise order from the
             viewer, scrolls horizontally on narrow screens if it overflows.
          3. GameTable — flex-1 so it absorbs the remaining vertical room.
          4. ActionBar + GameStatusBar + PlayerHand — unchanged.
          On xl+ a fixed chat sidebar lives on the right. The game column
          reserves room for it via right padding so nothing slides under. */}
      {/* AppShell already opens the `<main>` to the full viewport width for
          `/games/:id` (see AppShell `isGameRoute`), so we don't need any
          negative-margin breakout here anymore. The chat sidebar is fixed to
          the viewport's right edge; we reserve the same width via
          `xl:pr-[22rem]` / `2xl:pr-[26rem]` so the game column never slides
          under it. */}
      <div className="flex w-full items-start gap-3 xl:pr-[22rem] 2xl:pr-[26rem]">
        <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="game-room">
          {/* Top info row: standard InfoStrip + (when a pause is active) a
              compact PauseOverlay pill that lives in the same horizontal band
              so it doesn't push the felt arena down on every reconnect. */}
          <div className="flex flex-col gap-1.5">
            <InfoStrip
              boutNumber={state.boutNumber}
              defaultStatus={defaultStatus}
              discardSize={state.discardSize}
              cheatingOn={cheatingOn}
              cheatAttemptsRemaining={mySeat?.cheatAttemptsRemaining ?? 0}
              unreadChatCount={chat.unreadCount}
              onOpenSettings={() => setSettingsOpen(true)}
              onOpenChat={onOpenChat}
            />
            {pauseInfo ? (
              <PauseOverlay
                pauseInfo={pauseInfo}
                state={state}
                myUserId={myUserId}
                myVote={pauseVote.myVote}
                isSubmitting={pauseVote.isSubmitting}
                onVote={pauseVote.vote}
              />
            ) : null}
          </div>

          {/* Mobile deck-stack — sits between the info-strip and the players
              row so the player can see the deck/trump at a glance on narrow
              viewports. Desktop uses an absolutely-positioned variant inside
              the felt-table arena below. */}
          <div
            className="flex w-full justify-center xl:hidden"
            data-testid="deck-stack-mobile-wrap"
          >
            <DeckStack
              deckSize={state.deckSize}
              trumpCard={state.trumpCard}
              trumpSuit={state.trumpSuit}
              variant="mobile"
            />
          </div>

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

          {isSpectator ? (
            <div
              className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-center text-sm font-medium text-accent"
              data-testid="spectator-banner"
              role="status"
            >
              {t('game.spectator.banner')}
            </div>
          ) : null}

          {/* Players row — single horizontal strip, clockwise from viewer.
              Hidden on xl+ where the radial-seat layout below takes over. */}
          <div
            // overflow-x: clip clips chips that overflow the viewport
            // horizontally WITHOUT demoting overflow-y to auto — so emoji
            // bubbles at -top-2 and text-reaction bubbles at -top-14 can
            // float ABOVE the row instead of being eaten by the chip frame.
            // (With the previous overflow-x-auto the spec forces y → auto too.)
            className="flex w-full items-stretch gap-1.5 overflow-x-clip pb-1 md:gap-2 md:overflow-x-visible md:flex-wrap md:justify-center xl:hidden"
            role="list"
            aria-label={t('game.playersTitle')}
            data-testid="players-row"
          >
            {playersInOrder.map((p) => (
              <PlayerChip
                key={p.id}
                player={p}
                isAttacker={p.id === state.currentAttackerId}
                isDefender={p.id === state.currentDefenderId}
                isMe={p.id === myUserId}
                showCheatBadge={cheatingOn && p.id !== myUserId}
                reaction={reactionsHook.reactions[p.id] ?? null}
                textReaction={textReactionsHook.textReactions[p.id] ?? null}
                turnTimer={turnTimer}
              />
            ))}
          </div>

          {/* Felt-table arena. On xl we widen it (negative margin breaks out
              of the parent's 5xl cap) and overlay the radial seats around the
              border. On mobile this is just the bare table card; opponents
              live in the players-row strip above.

              `xl:pt-20` reserves enough vertical room above the felt that the
              top-centre opponent seat (positioned at 4–10% of the arena
              height) stays clear of the InfoStrip sitting above this block.
              Was xl:pt-32 — too generous on shorter desktop viewports
              (1440×900 etc.) where the bottom of the player's hand was
              spilling off-screen. */}
          <div className="relative w-full xl:px-16 xl:pt-20 xl:pb-2">
            <GameTable
              attacks={state.table.attacks}
              currentDefenderId={state.currentDefenderId}
              centerActive={centerActive}
              highlightedAttackIds={highlightedAttackIds}
              droppableAttackIds={droppableAttackIds}
              noticeableAttackIds={noticeableAttackIds}
              noticeableBeatIds={noticeableBeatIds}
              onNoticeCheat={onNoticeCheat}
            />
            <RadialOpponents
              opponents={playersInOrder}
              currentAttackerId={state.currentAttackerId}
              currentDefenderId={state.currentDefenderId}
              showCheatBadge={cheatingOn}
              reactions={reactionsHook.reactions}
              textReactions={textReactionsHook.textReactions}
              turnTimer={turnTimer}
            />
            {/* Desktop-only deck-stack — pinned to the right edge of the
                felt-table arena, vertically centred against the table. (The
                dealer traditionally keeps the deck on the right.) The mobile
                variant lives above this block (see the strip wrap). */}
            {/* Anchored to the bottom-right corner of the felt so it doesn't
                collide with the right-most opponent's chip in the radial
                layout (which lands around mid-right, ~40-50% of height). */}
            <div className="pointer-events-none absolute bottom-4 right-2 hidden xl:block">
              <div className="pointer-events-auto">
                <DeckStack
                  deckSize={state.deckSize}
                  trumpCard={state.trumpCard}
                  trumpSuit={state.trumpSuit}
                  variant="desktop"
                />
              </div>
            </div>
          </div>

          <GameStatusBar
            unseenEvents={unseenEvents}
            state={state}
            onConsume={onAcknowledgeEvents}
            defaultStatus={defaultStatus}
            transientHint={transientHint}
          />

          {/* Player's own hand + a floating Reaction button on the right edge.
              The reaction-bubble anchor sits above the hand (centred) so the
              emoji floats over the cards rather than next to the nickname.
              Spectators see neither (no hand, no reactions). */}
          {!isSpectator ? (
            <div
              className="relative flex w-full items-end justify-center gap-3"
              data-testid="player-zone"
              // The throw-card animation looks up the source seat for every
              // attacker via `[data-player-id="<id>"]`. The viewer themself
              // has no PlayerChip on desktop (xl+) — only their hand strip —
              // so we tag the hand zone with the viewer's id so their own
              // attacks/beats fly from the hand instead of falling back to
              // "no source seat → skip animation".
              data-player-id={myUserId || undefined}
            >
              <div className="relative flex-1 min-w-0 max-w-3xl">
                <div className="pointer-events-none absolute inset-x-0 -top-2 flex justify-center">
                  <ReactionBubble
                    key={myReaction?.timestamp ?? 'none'}
                    emoji={myReaction?.emoji ?? null}
                  />
                </div>
                <div className="pointer-events-none absolute inset-x-0 -top-2 flex justify-center">
                  <ReactionBubble
                    key={`text-${myTextReaction?.timestamp ?? 'none'}`}
                    text={myTextReaction?.text ?? null}
                    className="!-top-14"
                  />
                </div>
                <PlayerHand
                  hand={myHand}
                  trumpSuit={state.trumpSuit}
                  draggingCardId={draggingCardId}
                  isAttacker={isAttacker}
                  isDefender={isDefender}
                  exclusiveLocked={exclusiveLocked}
                  turnTimer={
                    turnTimer && turnTimer.activeUserId === myUserId
                      ? turnTimer
                      : null
                  }
                />
              </div>

              {/* Floating side controls next to the hand: Беру / Бито pill
                  + circular reaction button. Keeping them in the same
                  shrink-0 column means the hand width stays stable when
                  the action buttons appear/disappear — no more "стол
                  съезжает вниз" effect when a Беру/Бито pops in. */}
              <div
                ref={reactionPickerRef}
                className="relative flex shrink-0 flex-col items-end gap-2 self-end pb-2"
              >
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
                <button
                  type="button"
                  onClick={() => setReactionPickerOpen((v) => !v)}
                  aria-label={t('game.reactions.send')}
                  aria-pressed={reactionPickerOpen}
                  data-testid="open-reaction-picker"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface text-text shadow-lg transition-transform hover:scale-105 hover:bg-surfaceAlt xl:h-12 xl:w-12"
                >
                  <Smile className="h-5 w-5" aria-hidden />
                </button>
                {reactionPickerOpen ? (
                  <div
                    className="absolute bottom-full right-0 z-30 mb-2 flex max-h-40 w-64 flex-wrap gap-0.5 overflow-y-auto rounded-xl border border-border bg-surface p-2 shadow-2xl md:max-h-72 md:w-96 md:gap-1 md:p-3"
                    role="toolbar"
                    aria-label={t('game.reactions.send')}
                    data-testid="reaction-picker"
                  >
                    {EMOJI_REACTIONS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => void onPickReaction(emoji)}
                        className="shrink-0 rounded px-1.5 py-0.5 text-xl leading-none transition-colors hover:bg-border md:px-2.5 md:py-1 md:text-4xl"
                        aria-label={emoji}
                        data-testid={`reaction-emoji-${emoji}`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              {/* Sibling column hosting the TEXT-reactions trigger + picker.
                  Identical positioning shape to the emoji column above (own
                  ref → outside-click hook scoped to it). The picker pops up
                  on top of the action bar so wrapping multi-line phrases
                  have room. */}
              <div
                ref={textReactionPickerRef}
                className="relative flex shrink-0 flex-col items-end self-end pb-2"
              >
                <button
                  type="button"
                  onClick={() => setTextReactionPickerOpen((v) => !v)}
                  aria-label={t('game.reactions.textPickerLabel')}
                  aria-pressed={textReactionPickerOpen}
                  data-testid="open-text-reaction-picker"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface text-text shadow-lg transition-transform hover:scale-105 hover:bg-surfaceAlt xl:h-12 xl:w-12"
                >
                  <MessageSquareText className="h-5 w-5" aria-hidden />
                </button>
                {textReactionPickerOpen ? (
                  <div
                    className="absolute bottom-full right-0 z-30 mb-2 flex max-h-64 w-72 flex-col gap-1 overflow-y-auto rounded-xl border border-border bg-surface p-2 shadow-2xl md:max-h-80 md:w-96 md:p-3"
                    role="menu"
                    aria-label={t('game.reactions.textPickerLabel')}
                    data-testid="text-reaction-picker"
                  >
                    {textReactionsList.data && textReactionsList.data.length > 0 ? (
                      textReactionsList.data.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          role="menuitem"
                          onClick={() => void onPickTextReaction(r.id)}
                          className="w-full rounded px-3 py-1.5 text-left text-sm leading-tight text-text transition-colors hover:bg-border md:text-base"
                          data-testid={`text-reaction-${r.id}`}
                        >
                          {r.text}
                        </button>
                      ))
                    ) : (
                      <div
                        className="px-3 py-2 text-center text-sm text-textMuted"
                        data-testid="text-reaction-empty"
                      >
                        {t('game.reactions.textPickerEmpty')}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

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

          {/* Mobile / tablet drawer. Hidden on xl+ where the sidebar takes over. */}
          <div className="xl:hidden">
            <GameChatPanel
              gameId={gameId}
              open={chatOpen}
              onClose={() => setChatOpen(false)}
              myUserId={myUserId}
              variant="drawer"
              readOnly={isSpectator}
            />
          </div>

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
        {/* Desktop chat sidebar — fixed to the right edge of the viewport so
            it never stretches with game content. The game container reserves
            the same width via xl:pr-[22rem] above so nothing slides under.
            Starts below the AppShell sticky header (~4rem). Hidden on mobile. */}
        <aside
          className="fixed right-0 top-16 hidden h-[calc(100vh-4rem)] w-80 z-10 xl:flex 2xl:w-96"
          data-testid="game-chat-sidebar"
        >
          <GameChatPanel
            gameId={gameId}
            open
            onClose={() => undefined}
            myUserId={myUserId}
            variant="sidebar"
            readOnly={isSpectator}
          />
        </aside>
      </div>
    </DndContext>
  );
}

// ---------- info strip ----------

interface InfoStripProps {
  boutNumber: number;
  defaultStatus: string;
  discardSize: number;
  cheatingOn: boolean;
  cheatAttemptsRemaining: number;
  unreadChatCount: number;
  onOpenSettings: () => void;
  onOpenChat: () => void;
}

/**
 * Compact game-info strip pinned above the players row. Holds bout number,
 * the current status pill, the discard counter, and the Chat / Rules buttons.
 * The trump card + deck count live in `DeckStack` instead (rendered alongside
 * the felt-table arena), so the strip no longer duplicates those visuals.
 * Mobile-first: at ≤sm the buttons render icon-only. The strip is ~48px tall
 * on mobile and ~56px on md+, with `flex-wrap` so nothing overlaps if a very
 * long status string shows up on a tiny viewport.
 */
function InfoStrip({
  boutNumber,
  defaultStatus,
  discardSize,
  cheatingOn,
  cheatAttemptsRemaining,
  unreadChatCount,
  onOpenSettings,
  onOpenChat,
}: InfoStripProps) {
  const { t } = useTranslation();
  return (
    <header
      className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-surface px-2 py-1.5 text-xs md:gap-x-4 md:px-3 md:py-2"
      data-testid="game-info-strip"
    >
      {/* Left cluster: bout + status pill + (optional) my cheat-attempts badge. */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="shrink-0 text-textMuted">
          {t('game.bout', { number: boutNumber })}
        </span>
        {cheatingOn ? (
          <CheatAttemptsBadge
            remaining={cheatAttemptsRemaining}
            ariaLabel={t('game.cheat.attemptsRemaining', {
              count: cheatAttemptsRemaining,
            })}
          />
        ) : null}
        <div
          className="min-w-0 truncate rounded-md bg-surfaceAlt px-2 py-1 font-medium"
          data-testid="game-status-pill"
        >
          {defaultStatus}
        </div>
      </div>

      {/* Centre cluster: discard count only. Trump glyph + deck count moved
          to `DeckStack` to avoid duplication. */}
      <div
        className="flex shrink-0 items-center gap-2 text-textMuted md:gap-3"
        data-testid="game-info-meta"
      >
        <span
          className="tabular-nums"
          data-testid="discard-size"
          aria-label={t('game.info.discardLabel', { count: discardSize })}
        >
          {t('game.info.discardLabel', { count: discardSize })}
        </span>
      </div>

      {/* Right cluster: Chat / Rules buttons. Reaction moved next to the
          player's own hand — see `GameRoom`'s reaction-button section below. */}
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={onOpenChat}
          aria-label={t('game.chat.openAria')}
          data-testid="open-game-chat"
          className="relative !h-8 gap-1 !px-2 xl:hidden"
        >
          <MessageCircle className="h-4 w-4" aria-hidden />
          {unreadChatCount > 0 ? (
            <span
              className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white"
              aria-label={t('game.chat.unreadAria', {
                count: unreadChatCount,
              })}
              data-testid="chat-unread-badge"
            >
              {unreadChatCount > 99 ? '99+' : unreadChatCount}
            </span>
          ) : null}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onOpenSettings}
          aria-label={t('game.settings.openAria')}
          data-testid="open-game-settings"
          className="!h-8 gap-1 !px-2"
        >
          <Settings2 className="h-4 w-4" aria-hidden />
          <span className="hidden md:inline">
            {t('game.settings.openButton')}
          </span>
        </Button>
      </div>
    </header>
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

function formatCommandError(err: unknown, t: TFunction): string {
  if (err instanceof SocketAckError) {
    return t(`game.errors.${err.code}`, {
      defaultValue: t(`errors.${err.code}`, { defaultValue: err.message }),
    });
  }
  if (err instanceof Error) return err.message;
  return t('errors.generic');
}
