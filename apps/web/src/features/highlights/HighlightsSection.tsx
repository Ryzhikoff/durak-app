import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import type { Highlight, HighlightCategory } from '@durak/shared-types';
import { Alert, Card, Spinner } from '@/components/ui';
import { Avatar } from '@/components/Avatar';
import { getApiErrorMessage } from '@/lib/api';
import { useHighlights } from './hooks';

/**
 * "Интересное" section on the home page — a grid of small leaderboard cards
 * (Жулик дня, Шериф недели, etc.). The whole section is hidden when the API
 * returns zero highlights so the page stays clean during the cold-start
 * window.
 */
export function HighlightsSection() {
  const { t } = useTranslation();
  const query = useHighlights();

  if (query.isPending) {
    return (
      <section aria-labelledby="highlights-section" className="flex flex-col gap-3">
        <h2 id="highlights-section" className="text-lg font-semibold">
          {t('highlights.title')}
        </h2>
        <Card>
          <div className="flex justify-center py-6">
            <Spinner className="text-accent" />
          </div>
        </Card>
      </section>
    );
  }

  if (query.isError) {
    return (
      <section aria-labelledby="highlights-section" className="flex flex-col gap-3">
        <h2 id="highlights-section" className="text-lg font-semibold">
          {t('highlights.title')}
        </h2>
        <Alert variant="error">
          {getApiErrorMessage(query.error, t('errors.generic'))}
        </Alert>
      </section>
    );
  }

  // Hide the whole block when the backend has nothing interesting to show.
  if (query.data.items.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="highlights-section" className="flex flex-col gap-3">
      <h2 id="highlights-section" className="text-lg font-semibold">
        {t('highlights.title')}
      </h2>
      <div
        className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
        data-testid="highlights-grid"
      >
        {query.data.items.map((h) => (
          <HighlightCard key={h.id} highlight={h} />
        ))}
      </div>
    </section>
  );
}

const CATEGORY_RING: Record<HighlightCategory, string> = {
  cheating: 'ring-rose-500/30',
  wins: 'ring-amber-400/40',
  losses: 'ring-zinc-500/30',
  translates: 'ring-sky-500/30',
  takes: 'ring-emerald-500/30',
  streak: 'ring-emerald-400/40',
};

function HighlightCard({ highlight }: { highlight: Highlight }) {
  const { t } = useTranslation();
  // Backend ships fallback title/icon; the i18n key takes precedence when
  // present so future renames stay in the locale bundle.
  const titleKey = `highlights.titles.${highlight.id}`;
  const localised = t(titleKey, { defaultValue: '' });
  const title = localised || `${highlight.icon} ${highlight.title}`;
  const periodLabel = t(
    highlight.period === 'day' ? 'highlights.period.day' : 'highlights.period.week',
  );
  return (
    <Card
      className={clsx('!p-4 ring-1', CATEGORY_RING[highlight.category])}
      data-testid={`highlight-card-${highlight.id}`}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="truncate text-base font-semibold">{title}</div>
        <div className="shrink-0 text-xs text-textMuted">{periodLabel}</div>
      </div>
      <ul className="flex flex-col gap-1.5">
        {highlight.entries.map((entry, idx) => (
          <li key={entry.userId} className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-center text-xs text-textMuted tabular-nums">
              {idx + 1}
            </span>
            <Avatar
              src={entry.avatarUrl}
              nickname={entry.nickname}
              size={28}
            />
            <Link
              to={`/u/${entry.userId}`}
              className="min-w-0 flex-1 truncate text-sm hover:text-accent"
            >
              {entry.nickname}
            </Link>
            <span className="shrink-0 text-sm font-semibold tabular-nums">
              {formatValue(t, highlight.id, entry.value, entry.valueLabel)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * Picks an i18n key based on the highlight id so the unit (раз / побед / игр)
 * stays consistent. Falls back to the raw value if the key is missing.
 */
function formatValue(
  t: (key: string, opts?: Record<string, unknown>) => string,
  highlightId: string,
  value: number,
  override: string | undefined,
): string {
  if (override) return override;
  // The first prefix that matches wins. Keep this small — there are only a
  // handful of highlight ids today.
  const unitKey = pickUnitKey(highlightId);
  if (!unitKey) return String(value);
  return t(unitKey, { count: value });
}

function pickUnitKey(id: string): string | null {
  if (id.startsWith('winner_')) return 'highlights.value.wins';
  if (id.startsWith('cheater_') || id === 'sneaky_week' || id === 'sheriff_week') {
    return 'highlights.value.cheats';
  }
  if (id === 'dunce_week') return 'highlights.value.losses';
  if (id === 'translator_week') return 'highlights.value.translates';
  if (id.startsWith('no_loss_')) return 'highlights.value.games';
  return null;
}
