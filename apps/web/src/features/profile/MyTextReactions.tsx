import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import {
  TEXT_REACTION_MAX_LENGTH,
  USER_TEXT_REACTION_MAX_PER_USER,
} from '@durak/shared-types';
import { Alert, Button, Card, Input, Spinner } from '@/components/ui';
import { getApiErrorCode, getApiErrorMessage } from '@/lib/api';
import {
  useCreateMyTextReaction,
  useDeleteMyTextReaction,
  useMyTextReactions,
} from '@/features/games/hooks';

/**
 * Profile section for managing the current user's custom text reactions. Sits
 * alongside avatar / card-back settings; reuses the same Card+Alert+Input
 * primitives so visual rhythm is unchanged.
 *
 * Surfaces server-side caps:
 *   - `USER_TEXT_REACTION_LIMIT_REACHED` → input disabled with a help string.
 *   - `TEXT_REACTION_EMPTY` / `TEXT_REACTION_TOO_LONG` → inline error alert.
 *
 * The picker on the game page reads the same query (`useMyTextReactions`) so
 * an add/delete here is reflected without manually refetching.
 */
export function MyTextReactions() {
  const { t } = useTranslation();
  const list = useMyTextReactions();
  const createMutation = useCreateMyTextReaction();
  const deleteMutation = useDeleteMyTextReaction();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const items = list.data ?? [];
  const atCap = items.length >= USER_TEXT_REACTION_MAX_PER_USER;
  const busy = createMutation.isPending || deleteMutation.isPending;
  const trimmed = draft.trim();
  const submitDisabled = busy || atCap || trimmed.length === 0;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (trimmed.length === 0) return;
    try {
      await createMutation.mutateAsync({ text: trimmed });
      setDraft('');
    } catch (err) {
      setError(translateError(err, t));
    }
  };

  const onDelete = async (id: string) => {
    setError(null);
    try {
      await deleteMutation.mutateAsync(id);
    } catch (err) {
      setError(translateError(err, t));
    }
  };

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-textMuted">
          {t('profile.myTextReactions.title')}
        </div>
        <div className="text-xs text-textMuted tabular-nums" data-testid="my-text-reactions-counter">
          {items.length} / {USER_TEXT_REACTION_MAX_PER_USER}
        </div>
      </div>
      <p className="mb-3 text-xs text-textMuted">
        {t('profile.myTextReactions.subtitle')}
      </p>

      {error ? (
        <Alert variant="error" className="mb-3">
          {error}
        </Alert>
      ) : null}

      <form
        onSubmit={onSubmit}
        className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start"
        noValidate
      >
        <div className="flex-1">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('profile.myTextReactions.placeholder')}
            maxLength={TEXT_REACTION_MAX_LENGTH}
            disabled={busy || atCap}
            data-testid="my-text-reactions-input"
            aria-label={t('profile.myTextReactions.placeholder')}
          />
          <div
            className="mt-1 flex items-center justify-between text-[11px] text-textMuted"
            aria-live="polite"
          >
            <span>
              {trimmed.length} / {TEXT_REACTION_MAX_LENGTH}
            </span>
            {atCap ? (
              <span data-testid="my-text-reactions-limit">
                {t('profile.myTextReactions.limitReached')}
              </span>
            ) : null}
          </div>
        </div>
        <Button
          type="submit"
          disabled={submitDisabled}
          data-testid="my-text-reactions-add"
        >
          {createMutation.isPending
            ? t('profile.saving')
            : t('profile.myTextReactions.add')}
        </Button>
      </form>

      {list.isPending ? (
        <div className="flex justify-center py-4">
          <Spinner className="text-accent" />
        </div>
      ) : list.isError ? (
        <Alert variant="error">
          {getApiErrorMessage(list.error, t('errors.generic'))}
        </Alert>
      ) : items.length === 0 ? (
        <p
          className="py-3 text-center text-sm text-textMuted"
          data-testid="my-text-reactions-empty"
        >
          {t('profile.myTextReactions.empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="my-text-reactions-list">
          {items.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-border bg-surfaceAlt/40 px-3 py-2"
              data-testid={`my-text-reactions-row-${r.id}`}
            >
              <span className="break-words text-sm">{r.text}</span>
              <button
                type="button"
                onClick={() => void onDelete(r.id)}
                disabled={busy}
                aria-label={t('profile.myTextReactions.delete')}
                title={t('profile.myTextReactions.delete')}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-text transition-colors hover:bg-danger hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
                data-testid={`my-text-reactions-delete-${r.id}`}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function translateError(
  err: unknown,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const code = getApiErrorCode(err);
  if (code) {
    const translated = t(`errors.${code}`, { defaultValue: '' });
    if (translated) return translated;
  }
  return getApiErrorMessage(err, t('errors.generic'));
}
