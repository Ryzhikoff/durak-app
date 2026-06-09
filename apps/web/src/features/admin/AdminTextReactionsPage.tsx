import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Alert, Button, Card, Input, Modal, Spinner } from '@/components/ui';
import { getApiErrorCode, getApiErrorMessage } from '@/lib/api';
import type { AdminTextReactionDTO } from '@durak/shared-types';
import { TEXT_REACTION_MAX_LENGTH } from '@durak/shared-types';
import {
  useAdminTextReactions,
  useCreateTextReaction,
  useDeleteTextReaction,
  useUpdateTextReaction,
} from './textReactionsHooks';

interface FormState {
  text: string;
  sortOrder: string;
  enabled: boolean;
}

const EMPTY_FORM: FormState = { text: '', sortOrder: '0', enabled: true };

function fromDto(dto: AdminTextReactionDTO): FormState {
  return {
    text: dto.text,
    sortOrder: String(dto.sortOrder),
    enabled: dto.enabled,
  };
}

/**
 * Admin CRUD page for the preset text-reaction list. Mirrors
 * {@link AdminFaceCardsPage} in shell, but uses a row table + modal for
 * add/edit since the list is open-ended (vs the fixed 12 slots there).
 */
export function AdminTextReactionsPage() {
  const { t } = useTranslation();
  const list = useAdminTextReactions();
  const create = useCreateTextReaction();
  const update = useUpdateTextReaction();
  const remove = useDeleteTextReaction();

  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminTextReactionDTO | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminTextReactionDTO | null>(null);

  const handleErr = (err: unknown) => {
    const code = getApiErrorCode(err);
    const msg =
      (code && t(`errors.${code}`, { defaultValue: '' })) ||
      getApiErrorMessage(err, t('errors.generic'));
    setActionError(msg);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('admin.textReactions.title')}</h1>
          <p className="mt-1 text-sm text-textMuted">
            {t('admin.textReactions.subtitle')}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          {t('admin.textReactions.add')}
        </Button>
      </div>

      {actionError ? (
        <Alert variant="error">{actionError}</Alert>
      ) : null}

      {list.isError ? (
        <Alert variant="error">
          {getApiErrorMessage(list.error, t('errors.generic'))}
        </Alert>
      ) : null}

      {list.isPending ? (
        <Card>
          <div className="flex justify-center py-12">
            <Spinner className="text-accent" />
          </div>
        </Card>
      ) : (
        <Card>
          {list.data && list.data.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-textMuted">
                  <tr>
                    <th className="px-3 py-2">{t('admin.textReactions.text')}</th>
                    <th className="px-3 py-2 w-24">
                      {t('admin.textReactions.sortOrder')}
                    </th>
                    <th className="px-3 py-2 w-28">
                      {t('admin.textReactions.enabled')}
                    </th>
                    <th className="px-3 py-2 w-1">
                      {t('admin.textReactions.actions.edit')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-border last:border-b-0"
                      data-testid={`text-reaction-row-${row.id}`}
                    >
                      <td className="px-3 py-2">
                        <span
                          className={row.enabled ? 'text-text' : 'text-textMuted line-through'}
                        >
                          {row.text}
                        </span>
                      </td>
                      <td className="px-3 py-2 tabular-nums">{row.sortOrder}</td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            row.enabled
                              ? 'rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-400'
                              : 'rounded-full bg-textMuted/15 px-2 py-0.5 text-xs text-textMuted'
                          }
                        >
                          {t(
                            row.enabled
                              ? 'admin.textReactions.enabledOn'
                              : 'admin.textReactions.enabledOff',
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={t('admin.textReactions.actions.edit')}
                            onClick={() => setEditing(row)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={t('admin.textReactions.actions.delete')}
                            onClick={() => setDeleteTarget(row)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-3 py-8 text-center text-sm text-textMuted">
              {t('admin.textReactions.empty')}
            </div>
          )}
        </Card>
      )}

      <TextReactionFormModal
        open={createOpen}
        title={t('admin.textReactions.add')}
        initial={EMPTY_FORM}
        submitting={create.isPending}
        onClose={() => setCreateOpen(false)}
        onSubmit={async (form) => {
          setActionError(null);
          try {
            await create.mutateAsync({
              text: form.text,
              sortOrder: Number(form.sortOrder) || 0,
              enabled: form.enabled,
            });
            setCreateOpen(false);
          } catch (err) {
            handleErr(err);
          }
        }}
      />

      <TextReactionFormModal
        open={editing !== null}
        title={t('admin.textReactions.actions.edit')}
        initial={editing ? fromDto(editing) : EMPTY_FORM}
        submitting={update.isPending}
        onClose={() => setEditing(null)}
        onSubmit={async (form) => {
          if (!editing) return;
          setActionError(null);
          try {
            await update.mutateAsync({
              id: editing.id,
              patch: {
                text: form.text,
                sortOrder: Number(form.sortOrder) || 0,
                enabled: form.enabled,
              },
            });
            setEditing(null);
          } catch (err) {
            handleErr(err);
          }
        }}
      />

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={t('admin.textReactions.deleteModal.title')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              {t('admin.textReactions.deleteModal.cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={remove.isPending}
              onClick={async () => {
                if (!deleteTarget) return;
                setActionError(null);
                try {
                  await remove.mutateAsync(deleteTarget.id);
                  setDeleteTarget(null);
                } catch (err) {
                  handleErr(err);
                }
              }}
            >
              {t('admin.textReactions.deleteModal.confirm')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-textMuted">
          {t('admin.textReactions.deleteModal.description', {
            text: deleteTarget?.text ?? '',
          })}
        </p>
      </Modal>
    </div>
  );
}

interface TextReactionFormModalProps {
  open: boolean;
  title: string;
  initial: FormState;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (form: FormState) => Promise<void>;
}

function TextReactionFormModal({
  open,
  title,
  initial,
  submitting,
  onClose,
  onSubmit,
}: TextReactionFormModalProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<FormState>(initial);

  // Re-seed each time the modal opens so editing different rows doesn't show
  // stale state from a previously-edited entry.
  useEffect(() => {
    if (open) setForm(initial);
  }, [open, initial]);

  const trimmedLen = form.text.trim().length;
  const overLimit = trimmedLen > TEXT_REACTION_MAX_LENGTH;
  const empty = trimmedLen === 0;
  const canSubmit = !empty && !overLimit && !submitting;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    await onSubmit({ ...form, text: form.text.trim() });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form="text-reaction-form"
            disabled={!canSubmit}
          >
            {submitting ? t('common.save') : t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="text-reaction-form"
        onSubmit={submit}
        className="flex flex-col gap-4"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('admin.textReactions.text')}</span>
          <Input
            value={form.text}
            onChange={(e) => setForm((s) => ({ ...s, text: e.target.value }))}
            maxLength={TEXT_REACTION_MAX_LENGTH * 2}
            required
            autoFocus
            data-testid="text-reaction-text-input"
            aria-invalid={overLimit ? 'true' : 'false'}
          />
          <span
            className={
              overLimit
                ? 'text-xs text-red-500'
                : 'text-xs text-textMuted'
            }
          >
            {t('admin.textReactions.maxLength', { remaining: TEXT_REACTION_MAX_LENGTH - trimmedLen })}
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('admin.textReactions.sortOrder')}</span>
          <Input
            type="number"
            value={form.sortOrder}
            onChange={(e) => setForm((s) => ({ ...s, sortOrder: e.target.value }))}
            step={1}
            data-testid="text-reaction-sort-input"
          />
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm((s) => ({ ...s, enabled: e.target.checked }))}
            className="h-4 w-4"
            data-testid="text-reaction-enabled-input"
          />
          <span className="text-sm">{t('admin.textReactions.enabled')}</span>
        </label>
      </form>
    </Modal>
  );
}
