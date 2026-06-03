import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Alert, Button, Card, Spinner } from '@/components/ui';
import { getApiErrorCode, getApiErrorMessage } from '@/lib/api';
import { SocketAckError } from '@/lib/socket';
import { useAuthStore } from '@/stores/auth.store';
import { useGameCommand, useGameState } from './hooks';
import { GameTable } from './GameTable';
import { PlayerHand, type HandCardIntent, type HandCardState } from './PlayerHand';
import { OpponentSeat } from './OpponentSeat';
import { TrumpIndicator } from './TrumpIndicator';
import { DiscardPile } from './DiscardPile';
import { ActionBar } from './ActionBar';
import { GameOverModal } from './GameOverModal';
import { EventToastFeed } from './EventToastFeed';
import type {
  Card as PlayingCardType,
  ClientGameState,
  ClientGamePlayer,
  DomainEvent,
  GameCommand,
  GameStatus,
} from './types';

export function GamePage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const live = useGameState(id);

  if (!id) {
    return <Navigate to="/" replace />;
  }

  if (live.snapshotPending && !live.data) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="text-accent" />
      </div>
    );
  }

  if (live.snapshotError && !live.data) {
    const code = getApiErrorCode(live.snapshotError);
    if (code === 'GAME_NOT_FOUND') {
      return <NotFound />;
    }
    return (
      <Alert variant="error">
        {getApiErrorMessage(live.snapshotError, t('errors.generic'))}
      </Alert>
    );
  }

  if (!live.data) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="text-accent" />
      </div>
    );
  }

  return (
    <GameRoom
      gameId={id}
      state={live.data.state}
      unseenEvents={live.data.unseenEvents}
      onAcknowledgeEvents={live.acknowledgeEvents}
      subscribeError={live.subscribeError}
    />
  );
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
  const [selectedAttackId, setSelectedAttackId] = useState<string | null>(null);
  const [gameOverDismissed, setGameOverDismissed] = useState(false);
  const [sending, setSending] = useState(false);

  const myUserId = state.myUserId || me?.id || '';
  const mySeat = useMemo(
    () => state.players.find((p) => p.id === myUserId) ?? null,
    [state.players, myUserId],
  );
  const myHand = useMemo<PlayingCardType[]>(
    () => mySeat?.hand ?? [],
    [mySeat],
  );

  const isAttacker = state.currentAttackerId === myUserId;
  const isDefender = state.currentDefenderId === myUserId;
  const status = state.status;
  const settings = state.settings;

  // -------- legality helpers --------
  const tableRanks = useMemo(() => collectTableRanks(state), [state]);
  const tableHasUnbeaten = useMemo(
    () => state.table.attacks.some((a) => a.beatenBy === null),
    [state.table.attacks],
  );
  const selectedAttack = useMemo(
    () =>
      selectedAttackId
        ? state.table.attacks.find((a) => a.id === selectedAttackId) ?? null
        : null,
    [state.table.attacks, selectedAttackId],
  );

  // Clear stale selection when the targeted attack disappears or is beaten.
  useEffect(() => {
    if (!selectedAttackId) return;
    const found = state.table.attacks.find((a) => a.id === selectedAttackId);
    if (!found || found.beatenBy !== null) {
      setSelectedAttackId(null);
    }
  }, [state.table.attacks, selectedAttackId]);

  // -------- intents per hand card --------
  const handStates: Record<string, HandCardState> = useMemo(() => {
    const out: Record<string, HandCardState> = {};
    for (const c of myHand) {
      out[c.id] = computeIntent(c, {
        myUserId,
        status,
        isAttacker,
        isDefender,
        attackerScope: settings.attackerScope,
        tableHasUnbeaten,
        tableRanks,
        selectedAttack,
        attacks: state.table.attacks,
        trumpSuit: state.trumpSuit,
      });
    }
    return out;
  }, [
    myHand,
    myUserId,
    status,
    isAttacker,
    isDefender,
    settings.attackerScope,
    tableHasUnbeaten,
    tableRanks,
    selectedAttack,
    state.table.attacks,
    state.trumpSuit,
  ]);

  // -------- command runner --------
  const run = useCallback(
    async (command: GameCommand) => {
      if (sending) return;
      setSending(true);
      setError(null);
      try {
        await sendCommand(command);
        if (command.type === 'beat') {
          setSelectedAttackId(null);
        }
      } catch (err: unknown) {
        setError(formatCommandError(err, t));
      } finally {
        setSending(false);
      }
    },
    [sendCommand, t, sending],
  );

  // -------- hand-tap handler --------
  const onHandTap = useCallback(
    (card: PlayingCardType, intent: HandCardIntent) => {
      if (intent === 'idle') return;
      switch (intent) {
        case 'attack':
          void run({
            type: 'attack',
            playerId: myUserId,
            cardId: card.id,
          });
          break;
        case 'translate':
          void run({
            type: 'translate',
            playerId: myUserId,
            cardId: card.id,
          });
          break;
        case 'beat':
          if (!selectedAttack) {
            setError(t('game.errors.selectAttackFirst'));
            return;
          }
          void run({
            type: 'beat',
            playerId: myUserId,
            attackEntryId: selectedAttack.id,
            defenseCardId: card.id,
          });
          break;
      }
    },
    [run, myUserId, selectedAttack, t],
  );

  // -------- action buttons --------
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
  const opponents = useMemo(
    () => state.players.filter((p) => p.id !== myUserId),
    [state.players, myUserId],
  );
  const seats = arrangeOpponents(opponents, state.currentAttackerId, state.currentDefenderId);

  // -------- banner --------
  const banner = useMemo(() => {
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
    <div className="flex flex-col gap-3" data-testid="game-room">
      <header className="flex items-center justify-between gap-2 text-xs">
        <div className="text-textMuted">
          {t('game.bout', { number: state.boutNumber })}
        </div>
        <div className="rounded-md bg-surfaceAlt px-2 py-1 font-medium">
          {banner}
        </div>
      </header>

      {error ? (
        <Alert
          variant="error"
          className="cursor-pointer"
          onClick={() => setError(null)}
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
              />
            ))}
          </div>
        </div>
      )}

      <GameTable
        attacks={state.table.attacks}
        selectedAttackId={selectedAttackId}
        onSelectAttack={(id) => setSelectedAttackId(id)}
        defenderInteractive={status === 'bout_defense' && isDefender}
      />

      <ActionBar
        showTake={showTake}
        showPass={showPass}
        onTake={onTake}
        onPass={onPass}
        disabled={sending}
        hint={selectedAttack ? t('game.hints.pickBeater') : null}
      />

      <PlayerHand
        hand={myHand}
        trumpSuit={state.trumpSuit}
        states={handStates}
        onCardTap={onHandTap}
      />

      <EventToastFeed
        unseenEvents={unseenEvents}
        state={state}
        onConsume={onAcknowledgeEvents}
      />

      {isGameOver ? (
        <GameOverModal
          state={state}
          open={!gameOverDismissed}
          onClose={() => setGameOverDismissed(true)}
        />
      ) : null}
    </div>
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

function collectTableRanks(state: ClientGameState): Set<number | 'joker'> {
  const ranks = new Set<number | 'joker'>();
  for (const a of state.table.attacks) {
    if (a.card.kind === 'joker') ranks.add('joker');
    else ranks.add(a.card.rank);
    if (a.beatenBy) {
      if (a.beatenBy.kind === 'joker') ranks.add('joker');
      else ranks.add(a.beatenBy.rank);
    }
  }
  return ranks;
}

interface IntentCtx {
  myUserId: string;
  status: GameStatus;
  isAttacker: boolean;
  isDefender: boolean;
  attackerScope: 'all' | 'attacker_only';
  tableHasUnbeaten: boolean;
  tableRanks: Set<number | 'joker'>;
  selectedAttack: {
    id: string;
    card: PlayingCardType;
    beatenBy: PlayingCardType | null;
  } | null;
  attacks: Array<{
    id: string;
    card: PlayingCardType;
    beatenBy: PlayingCardType | null;
  }>;
  trumpSuit: ClientGameState['trumpSuit'];
}

/**
 * Determines what tapping a given card in the player's hand should do. This
 * is purely client-side guidance — the server is the source of truth and will
 * reject illegal moves. We intentionally bias toward enabling actions: if a
 * card is legal-LOOKING we offer it, even if a corner case (e.g. attack limit)
 * would have the server reject it.
 */
function computeIntent(
  card: PlayingCardType,
  ctx: IntentCtx,
): HandCardState {
  const cardRank: number | 'joker' =
    card.kind === 'joker' ? 'joker' : card.rank;

  // Defender during defense: prefer beat / translate.
  if (ctx.status === 'bout_defense' && ctx.isDefender) {
    // Translate: all attacks must be of this rank, none beaten yet.
    const canTranslate =
      ctx.attacks.length > 0 &&
      ctx.attacks.every(
        (a) =>
          a.beatenBy === null &&
          ((a.card.kind === 'standard' && card.kind === 'standard' && a.card.rank === card.rank) ||
            (a.card.kind === 'joker' && card.kind === 'joker')),
      );
    // Beat: a target attack is selected (and unbeaten) and this card *could*
    // beat it. We do a soft check: jokers always work; same-suit higher-rank
    // or trump-suit cards always work; otherwise dim.
    if (ctx.selectedAttack && ctx.selectedAttack.beatenBy === null) {
      const beatable = couldBeat(card, ctx.selectedAttack.card, ctx.trumpSuit);
      if (beatable) {
        return { intent: 'beat' };
      }
      if (canTranslate) {
        return { intent: 'translate' };
      }
      return { intent: 'idle', dimmed: true };
    }
    if (canTranslate) {
      return { intent: 'translate' };
    }
    // No selection but defender could still pick a translate or wait.
    return { intent: 'idle', dimmed: true };
  }

  // Attacker / throw-in during attack/defense/settle: only `attack` makes sense.
  if (
    ctx.status === 'bout_attack' ||
    ctx.status === 'bout_defense' ||
    ctx.status === 'bout_settle'
  ) {
    // Defender cannot attack in their own bout (they're being attacked).
    if (ctx.isDefender) return { intent: 'idle', dimmed: true };

    // attacker_only policy: only the rotating attacker may throw extras.
    const canThrowExtras =
      ctx.attackerScope === 'all' || ctx.isAttacker;
    if (!canThrowExtras) return { intent: 'idle', dimmed: true };

    // First card of a bout (no attacks yet, must be attacker, not in settle).
    if (ctx.attacks.length === 0) {
      if (ctx.isAttacker && ctx.status === 'bout_attack') {
        return { intent: 'attack' };
      }
      return { intent: 'idle', dimmed: true };
    }

    // Subsequent throws: rank must already be on the table.
    if (ctx.tableRanks.has(cardRank)) {
      return { intent: 'attack' };
    }
    return { intent: 'idle', dimmed: true };
  }

  // dealing / game_over → no actions on cards.
  return { intent: 'idle', dimmed: true };
}

/**
 * Heuristic beat-feasibility check. Mirrors the engine's `DefaultBeatRule`
 * coarsely: jokers beat anything; trump beats non-trump; same-suit higher
 * rank beats lower. We deliberately do not import the engine's rule at
 * runtime — the server is authoritative anyway.
 */
function couldBeat(
  defense: PlayingCardType,
  attack: PlayingCardType,
  trumpSuit: ClientGameState['trumpSuit'],
): boolean {
  if (defense.kind === 'joker') return true;
  if (attack.kind === 'joker') return false; // can't beat a joker with a normal card
  const defIsTrump = trumpSuit != null && defense.suit === trumpSuit;
  const atkIsTrump = trumpSuit != null && attack.suit === trumpSuit;
  if (defIsTrump && !atkIsTrump) return true;
  if (!defIsTrump && atkIsTrump) return false;
  return defense.suit === attack.suit && defense.rank > attack.rank;
}

/**
 * `pass` is the "Бито"/"скажи пас" action. Rough client-side gating:
 *  - bout_settle: anyone with throw-in rights who hasn't passed yet.
 *  - bout_defense: only when all attacks are beaten and the defender wants to
 *    say pass too (rare — server usually auto-pass)
 */
function playerCanPass(state: ClientGameState, myUserId: string): boolean {
  const me = state.players.find((p) => p.id === myUserId);
  if (!me || me.isFinished || me.isPassed) return false;
  if (state.status !== 'bout_settle') return false;
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
 * Mobile-first opponent layout. Up to 4 opponents go across the top; 5+
 * opponents (only in a 6-player game) split into top row + side columns. The
 * order inside the layout puts the active attacker first (centre-top when
 * possible), then the defender, then everyone else in engine order — this
 * keeps the player's attention on whoever is acting right now.
 */
function arrangeOpponents(
  opponents: ClientGamePlayer[],
  currentAttackerId: string,
  currentDefenderId: string,
): SeatLayout {
  // Stable prioritisation: attacker first, defender second, rest preserve
  // their original engine ordering.
  const head: ClientGamePlayer[] = [];
  const tail: ClientGamePlayer[] = [];
  const attacker = opponents.find((p) => p.id === currentAttackerId);
  const defender = opponents.find((p) => p.id === currentDefenderId);
  if (attacker) head.push(attacker);
  if (defender && defender.id !== attacker?.id) head.push(defender);
  for (const p of opponents) {
    if (p.id === attacker?.id || p.id === defender?.id) continue;
    tail.push(p);
  }
  const list = [...head, ...tail];

  if (list.length <= 4) {
    return { top: list, left: [], right: [] };
  }
  // 5: 3 top, 1 left, 1 right. 6: 2 top, 2 left, 2 right (rare).
  if (list.length === 5) {
    return {
      top: list.slice(0, 3),
      left: list.slice(3, 4),
      right: list.slice(4, 5),
    };
  }
  return {
    top: list.slice(0, 2),
    left: list.slice(2, 4),
    right: list.slice(4, 6),
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
