/**
 * Phase 7B — finished-game "score sheet" view.
 *
 * Renders a `GameDetail` (the `{ detail }` shape returned by `GET /games/:id`
 * for finished games). Three sections + an extras block:
 *  1. Header (date, duration, bout count).
 *  2. Results (podium + full standings with rating delta).
 *  3. Per-participant metrics (collapsible details).
 *  4. Rules used (collapsible — reuses the in-game settings rows).
 *  5. Past games played by the same set of users (REST `/same-composition`).
 *
 * Mobile-first: every section degrades to a vertical stack of cards on narrow
 * screens; the podium becomes a 3-column row of medals.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ChevronDown, Crown, Trophy } from 'lucide-react';
import clsx from 'clsx';
import type {
  GameDetail,
  GameParticipantMetrics,
  GameParticipantPublic,
  GameSummary,
  LobbySettings,
} from '@durak/shared-types';
import { REMATCH_WINDOW_MINUTES } from '@durak/shared-types';
import { Alert, Button, Card, Spinner } from '@/components/ui';
import { Avatar } from '@/components/Avatar';
import { getApiErrorCode, getApiErrorMessage } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';
import { useRematch, useSameComposition } from './hooks';

/** All metric keys we expose in the metrics breakdown. */
const METRIC_KEYS = [
  'attacksMade',
  'beatsMade',
  'translatesMade',
  'takesAsked',
  'cardsTaken',
  'boutsAttacked',
  'boutsDefended',
  'cheatAttemptedTotal',
  'cheatCaught',
  'cheatEscaped',
  'noticesIssued',
  'noticesCorrect',
  'noticesWrong',
] as const satisfies ReadonlyArray<keyof GameParticipantMetrics>;

/** Groups for the metrics breakdown in display order. */
const METRIC_GROUPS: ReadonlyArray<{
  id: 'actions' | 'cheat';
  keys: ReadonlyArray<keyof GameParticipantMetrics>;
}> = [
  {
    id: 'actions',
    keys: [
      'attacksMade',
      'beatsMade',
      'translatesMade',
      'takesAsked',
      'cardsTaken',
      'boutsAttacked',
      'boutsDefended',
    ],
  },
  {
    id: 'cheat',
    keys: [
      'cheatAttemptedTotal',
      'cheatCaught',
      'cheatEscaped',
      'noticesIssued',
      'noticesCorrect',
      'noticesWrong',
    ],
  },
];

interface GameDetailViewProps {
  detail: GameDetail;
}

export function GameDetailView({ detail }: GameDetailViewProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6" data-testid="game-detail-view">
      <Header detail={detail} t={t} />
      <ResultsSection detail={detail} t={t} />
      <MetricsSection detail={detail} t={t} />
      <RulesSection settings={detail.settings} t={t} />
      <SameCompositionSection detail={detail} t={t} />
      <FooterCta detail={detail} t={t} />
    </div>
  );
}

interface SectionProps {
  detail: GameDetail;
  t: TFunction;
}

// -------- Header --------

function Header({ detail, t }: SectionProps) {
  // Memoise the formatter — Intl.DateTimeFormat is allocation-heavy and rarely
  // cheap on first render. Stable as long as the locale stays Russian.
  const fmt = useMemo(
    () =>
      new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [],
  );
  const dateLabel = fmt.format(new Date(detail.finishedAt));
  // Sub-minute games would otherwise round up to "1 minute" which is misleading
  // for quick concedes / forfeits. Surface a dedicated "< 1 min" copy instead.
  const durationLabel =
    detail.durationSec < 60
      ? t('gameDetail.durationLessThanMinute')
      : t('gameDetail.duration', {
          count: Math.round(detail.durationSec / 60),
        });
  return (
    <Card className="!p-5">
      <h1 className="text-xl font-bold sm:text-2xl" data-testid="game-detail-title">
        {t('gameDetail.title', { date: dateLabel })}
      </h1>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-textMuted">
        <span>{durationLabel}</span>
        <span>{t('gameDetail.bouts', { count: detail.totalBouts })}</span>
      </div>
    </Card>
  );
}

// -------- Results (podium + standings) --------

function ResultsSection({ detail, t }: SectionProps) {
  const ranked = useMemo(
    () => [...detail.participants].sort((a, b) => a.place - b.place),
    [detail.participants],
  );
  const podium = ranked.slice(0, 3);
  return (
    <section
      aria-labelledby="game-detail-results"
      className="flex flex-col gap-4"
      data-testid="game-detail-results"
    >
      <h2 id="game-detail-results" className="text-lg font-semibold">
        {t('gameDetail.resultsTitle')}
      </h2>
      <Podium players={podium} t={t} />
      <Standings players={ranked} loserId={detail.loserId} t={t} />
    </section>
  );
}

function Podium({ players, t }: { players: GameParticipantPublic[]; t: TFunction }) {
  if (players.length === 0) return null;
  return (
    <ol
      className="grid grid-cols-3 gap-2 sm:gap-3"
      data-testid="game-detail-podium"
    >
      {players.map((p) => {
        const place = p.place;
        const accent = place === 1 ? 'amber' : place === 2 ? 'slate' : 'orange';
        const Icon = place === 1 ? Crown : Trophy;
        return (
          <li
            key={p.userId}
            className={clsx(
              'flex flex-col items-center gap-1.5 rounded-2xl border border-border bg-surface p-3',
              'text-center',
            )}
            data-testid={`podium-${place}`}
          >
            <Icon
              className={clsx(
                'h-5 w-5',
                accent === 'amber' && 'text-amber-400',
                accent === 'slate' && 'text-slate-300',
                accent === 'orange' && 'text-orange-400',
              )}
              aria-hidden="true"
            />
            <Link to={`/u/${p.userId}`} className="block">
              <Avatar
                src={p.avatarUrl}
                nickname={p.nickname}
                size={56}
                className="mx-auto"
              />
            </Link>
            <Link
              to={`/u/${p.userId}`}
              className="line-clamp-1 text-sm font-semibold hover:text-accent"
            >
              {p.nickname}
            </Link>
            <div className="text-xs text-textMuted">
              {t('gameDetail.place', { place })}
            </div>
            <RatingDelta delta={p.deltaDisplay} />
          </li>
        );
      })}
    </ol>
  );
}

function Standings({
  players,
  loserId,
  t,
}: {
  players: GameParticipantPublic[];
  loserId: string | null;
  t: TFunction;
}) {
  return (
    <ul className="flex flex-col gap-2" data-testid="game-detail-standings">
      {players.map((p) => {
        const isLoser = p.isLoser || p.userId === loserId;
        return (
          <li key={p.userId}>
            <Card className="!p-3">
              <div className="flex items-center gap-3">
                <span
                  className="w-6 shrink-0 text-center text-base font-bold tabular-nums"
                  aria-hidden="true"
                >
                  {p.place}
                </span>
                <Link to={`/u/${p.userId}`}>
                  <Avatar src={p.avatarUrl} nickname={p.nickname} size={40} />
                </Link>
                <div className="flex min-w-0 flex-1 flex-col">
                  <Link
                    to={`/u/${p.userId}`}
                    className="truncate text-sm font-semibold hover:text-accent"
                  >
                    {p.nickname}
                  </Link>
                  <div className="text-xs text-textMuted">
                    {isLoser
                      ? t('gameDetail.loserBadge')
                      : t('gameDetail.place', { place: p.place })}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <RatingDelta delta={p.deltaDisplay} />
                  <div className="text-[10px] uppercase tracking-wide text-textMuted">
                    {t('gameDetail.ratingAfter', {
                      rating: ratingFromMuSigma(p.muAfter, p.sigmaAfter),
                    })}
                  </div>
                </div>
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

function RatingDelta({ delta }: { delta: number }) {
  const rounded = Math.round(delta);
  const sign = rounded > 0 ? '+' : '';
  const color =
    rounded > 0 ? 'text-success' : rounded < 0 ? 'text-danger' : 'text-textMuted';
  return (
    <span
      className={clsx('text-sm font-bold tabular-nums', color)}
      data-testid="rating-delta"
    >
      {sign}
      {rounded}
    </span>
  );
}

// Conservative rating snapshot (same formula as backend: mu - 3*sigma rounded).
function ratingFromMuSigma(mu: number, sigma: number): number {
  return Math.round(mu - 3 * sigma);
}

// -------- Metrics (collapsible per player) --------

function MetricsSection({ detail, t }: SectionProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const toggle = (id: string) =>
    setExpandedId((prev) => (prev === id ? null : id));
  return (
    <section
      aria-labelledby="game-detail-metrics"
      className="flex flex-col gap-3"
      data-testid="game-detail-metrics"
    >
      <h2 id="game-detail-metrics" className="text-lg font-semibold">
        {t('gameDetail.metricsTitle')}
      </h2>
      <ul className="flex flex-col gap-2">
        {detail.participants.map((p) => {
          const open = expandedId === p.userId;
          return (
            <li key={p.userId}>
              <Card className="!p-0 overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggle(p.userId)}
                  aria-expanded={open}
                  aria-controls={`metrics-${p.userId}`}
                  className={clsx(
                    'flex w-full items-center gap-3 px-3 py-2 text-left',
                    'hover:bg-surfaceAlt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  )}
                  data-testid={`metrics-toggle-${p.userId}`}
                >
                  <Avatar
                    src={p.avatarUrl}
                    nickname={p.nickname}
                    size={32}
                  />
                  <span className="flex-1 truncate text-sm font-medium">
                    {p.nickname}
                  </span>
                  <ChevronDown
                    className={clsx(
                      'h-4 w-4 shrink-0 text-textMuted transition-transform',
                      open && 'rotate-180',
                    )}
                    aria-hidden="true"
                  />
                </button>
                {open ? (
                  <div
                    id={`metrics-${p.userId}`}
                    className="border-t border-border bg-surfaceAlt/40 p-3"
                  >
                    <MetricsBreakdown metrics={p.metrics} t={t} />
                  </div>
                ) : null}
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function MetricsBreakdown({
  metrics,
  t,
}: {
  metrics: GameParticipantMetrics;
  t: TFunction;
}) {
  return (
    <div className="flex flex-col gap-4">
      {METRIC_GROUPS.map((group) => {
        // Only render the group if at least one metric in it is non-zero, to
        // keep cheating block hidden when cheating was disabled this game.
        const hasAny = group.keys.some((k) => metrics[k] > 0);
        if (!hasAny && group.id === 'cheat') return null;
        return (
          <div key={group.id} className="flex flex-col gap-1.5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-textMuted">
              {t(`gameDetail.metricsGroups.${group.id}`)}
            </h3>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {group.keys.map((k) => (
                <div
                  key={k}
                  className="flex items-center justify-between gap-2 rounded-lg bg-surface px-2 py-1.5"
                >
                  <dt className="text-xs text-textMuted">
                    {t(`gameDetail.metrics.${k}`)}
                  </dt>
                  <dd
                    className="text-sm font-bold tabular-nums"
                    data-testid={`metric-${k}`}
                  >
                    {metrics[k]}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}
    </div>
  );
}

// -------- Rules (collapsible) --------

function RulesSection({
  settings,
  t,
}: {
  settings: LobbySettings;
  t: TFunction;
}) {
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => buildSettingsRows(settings, t), [settings, t]);
  return (
    <section
      aria-labelledby="game-detail-rules"
      className="flex flex-col gap-3"
      data-testid="game-detail-rules"
    >
      <h2 id="game-detail-rules" className="text-lg font-semibold">
        {t('gameDetail.rulesTitle')}
      </h2>
      <Card className="!p-0 overflow-hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="game-detail-rules-body"
          className={clsx(
            'flex w-full items-center gap-3 px-3 py-2 text-left text-sm',
            'hover:bg-surfaceAlt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          )}
          data-testid="rules-toggle"
        >
          <span className="flex-1">{t('gameDetail.rulesToggle')}</span>
          <ChevronDown
            className={clsx(
              'h-4 w-4 shrink-0 text-textMuted transition-transform',
              open && 'rotate-180',
            )}
            aria-hidden="true"
          />
        </button>
        {open ? (
          <dl
            id="game-detail-rules-body"
            className="flex flex-col divide-y divide-border border-t border-border"
          >
            {rows.map((row) => (
              <div
                key={row.label}
                className="flex items-start justify-between gap-3 px-3 py-2 text-sm"
              >
                <dt className="text-textMuted">{row.label}</dt>
                <dd className="max-w-[55%] text-right font-medium">{row.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </Card>
    </section>
  );
}

interface SettingsRow {
  label: string;
  value: string;
}

/**
 * Mirror of `GameSettingsModal.buildRows` — we don't import it directly so
 * the modal stays focused on its in-game role.
 */
function buildSettingsRows(settings: LobbySettings, t: TFunction): SettingsRow[] {
  const rows: SettingsRow[] = [];
  rows.push({
    label: t('game.settings.players'),
    value: String(settings.maxPlayers),
  });
  rows.push({
    label: t('game.settings.deck'),
    value: t('game.settings.deckValue', {
      size: settings.deckSize,
      jokers: settings.jokers
        ? t('game.settings.jokersOn')
        : t('game.settings.jokersOff'),
    }),
  });
  rows.push({
    label: t('lobbySettings.firstBoutLimit.label'),
    value:
      settings.firstBoutLimit === 5
        ? t('lobbySettings.firstBoutLimit.five')
        : settings.firstBoutLimit === 6
          ? t('lobbySettings.firstBoutLimit.six')
          : t('lobbySettings.firstBoutLimit.defenderHand'),
  });
  rows.push({
    label: t('lobbySettings.attackerScope.label'),
    value:
      settings.attackerScope === 'all'
        ? t('lobbySettings.attackerScope.all')
        : t('lobbySettings.attackerScope.attackerOnly'),
  });
  rows.push({
    label: t('lobbySettings.cheating.label'),
    value: settings.cheatingEnabled
      ? t('game.settings.on')
      : t('game.settings.off'),
  });
  if (settings.cheatingEnabled) {
    rows.push({
      label: t('lobbySettings.cheatAttempts'),
      value: String(settings.cheatAttempts),
    });
    rows.push({
      label: t('lobbySettings.cheatNoticeScope.label'),
      value:
        settings.cheatNoticeScope === 'defender_only'
          ? t('lobbySettings.cheatNoticeScope.defenderOnly')
          : t('lobbySettings.cheatNoticeScope.all'),
    });
  }
  rows.push({
    label: t('lobbySettings.layoutOnRepeat.label'),
    value:
      settings.layoutOnRepeat === 'random'
        ? t('lobbySettings.layoutOnRepeat.random')
        : t('lobbySettings.layoutOnRepeat.preserve'),
  });
  rows.push({
    label: t('lobbySettings.firstTurn.label'),
    value:
      settings.firstTurn === 'lowest_trump'
        ? t('lobbySettings.firstTurn.lowestTrump')
        : settings.firstTurn === 'random'
          ? t('lobbySettings.firstTurn.random')
          : t('lobbySettings.firstTurn.previousLoser'),
  });
  rows.push({
    label: t('lobbySettings.turnTimer.label'),
    value:
      settings.turnTimer === null
        ? t('lobbySettings.turnTimer.off')
        : t('lobbySettings.turnTimer.seconds', { count: settings.turnTimer }),
  });
  return rows;
}

// -------- Past games with the same set of users --------

function SameCompositionSection({ detail, t }: SectionProps) {
  const query = useSameComposition(detail.id);
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
    <section
      aria-labelledby="game-detail-same-composition"
      className="flex flex-col gap-3"
      data-testid="game-detail-same-composition"
    >
      <h2 id="game-detail-same-composition" className="text-lg font-semibold">
        {t('gameDetail.sameCompositionTitle')}
      </h2>
      {query.isPending ? (
        <div className="flex justify-center py-4">
          <Spinner className="text-accent" />
        </div>
      ) : query.isError ? (
        <Alert variant="error">
          {getApiErrorMessage(query.error, t('errors.generic'))}
        </Alert>
      ) : query.data.items.length === 0 ? (
        <Card>
          <p className="text-center text-textMuted">
            {t('gameDetail.sameCompositionEmpty')}
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {query.data.items.map((g) => (
            <SameCompositionRow key={g.id} game={g} fmt={fmt} t={t} />
          ))}
        </ul>
      )}
    </section>
  );
}

function SameCompositionRow({
  game,
  fmt,
  t,
}: {
  game: GameSummary;
  fmt: Intl.DateTimeFormat;
  t: TFunction;
}) {
  const winner = game.players.find((p) => p.isWinner ?? p.place === 1);
  const dateSource = game.finishedAt ?? game.endedAt ?? game.startedAt;
  const dateLabel = fmt.format(new Date(dateSource));
  return (
    <li>
      <Link to={`/games/${game.id}`}>
        <Card className="!p-3 transition-colors hover:bg-surfaceAlt/60">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium">{dateLabel}</div>
            {winner ? (
              <div className="text-xs text-textMuted">
                {t('gameDetail.sameCompositionWinner', {
                  nickname: winner.nickname,
                })}
              </div>
            ) : null}
          </div>
        </Card>
      </Link>
    </li>
  );
}

// -------- Footer CTA --------

function FooterCta({ detail, t }: SectionProps) {
  // "Create another lobby" only makes sense for someone who actually played
  // this game — surfacing it for spectators / random viewers would be noise.
  const myUserId = useAuthStore((s) => s.user?.id);
  const isParticipant = myUserId
    ? detail.participants.some((p) => p.userId === myUserId)
    : false;
  const recent = isRecent(detail.finishedAt);
  // "Rematch" stays available for the longer REMATCH_WINDOW_MINUTES window so
  // a participant who navigates back to the recap a few minutes later can
  // still trigger one without having to manually rebuild the lobby.
  const rematchOpen = isWithinRematchWindow(detail.finishedAt);
  const rematch = useRematch();
  const [rematchError, setRematchError] = useState<string | null>(null);

  const onRematch = async () => {
    setRematchError(null);
    try {
      await rematch.mutateAsync(detail.id);
      // The session is now in the TanStack cache; the global
      // <RematchListener> renders the coordinator modal on top of this page.
    } catch (err) {
      const code = getApiErrorCode(err);
      setRematchError(
        code
          ? t(`errors.${code}`, { defaultValue: getApiErrorMessage(err, t('errors.generic')) })
          : getApiErrorMessage(err, t('errors.generic')),
      );
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {rematchError ? <Alert variant="error">{rematchError}</Alert> : null}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Link to="/" className="flex-1">
          <Button block variant="secondary">
            {t('gameDetail.backToHome')}
          </Button>
        </Link>
        {rematchOpen && isParticipant ? (
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
        ) : recent && isParticipant ? (
          <Link to="/" className="flex-1">
            <Button block variant="primary">
              {t('gameDetail.createLobby')}
            </Button>
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/** "Just played" window — anything closed within the last 5 minutes. */
function isRecent(iso: string): boolean {
  const finished = new Date(iso).getTime();
  if (!Number.isFinite(finished)) return false;
  return Date.now() - finished < 5 * 60 * 1000;
}

/** Backend will accept rematch within this window — keep the CTA in sync. */
function isWithinRematchWindow(iso: string): boolean {
  const finished = new Date(iso).getTime();
  if (!Number.isFinite(finished)) return false;
  return Date.now() - finished < REMATCH_WINDOW_MINUTES * 60 * 1000;
}

// Expose for tests so they can validate the metric key list. Keeping this on
// the module surface keeps it easy to assert "we render every metric".
export const _GAME_DETAIL_METRIC_KEYS = METRIC_KEYS;
