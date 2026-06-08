import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Images, Plus, Search, ShieldCheck, Sliders } from 'lucide-react';
import { Alert, Button, Card, Input, Modal, Spinner } from '@/components/ui';
import { useAdminUsers, useDeleteUser, useUpdateUser } from './hooks';
import { CreateUserModal } from './CreateUserModal';
import { ResetPasswordModal } from './ResetPasswordModal';
import { useAuthStore } from '@/stores/auth.store';
import { getApiErrorCode, getApiErrorMessage } from '@/lib/api';
import { useDebounced } from '@/lib/hooks/useDebounced';
import type { AdminUserDTO } from '@durak/shared-types';
import clsx from 'clsx';

const PAGE_LIMIT = 20;

interface DeleteTarget {
  id: string;
  nickname: string;
}

export function AdminUsersPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const me = useAuthStore((s) => s.user);
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [debounced]);

  const query = useMemo(
    () => ({ search: debounced || undefined, page, limit: PAGE_LIMIT }),
    [debounced, page],
  );

  const list = useAdminUsers(query);
  const update = useUpdateUser();
  const remove = useDeleteUser();

  const [createOpen, setCreateOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<{ id: string; login: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const fmt = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language === 'ru' ? 'ru-RU' : undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }),
    [i18n.language],
  );

  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / PAGE_LIMIT)) : 1;

  const handleUpdate = async (id: string, patch: { isAdmin?: boolean; disabled?: boolean }) => {
    setActionError(null);
    try {
      await update.mutateAsync({ id, patch });
    } catch (err) {
      const code = getApiErrorCode(err);
      const msg =
        (code && t(`errors.${code}`, { defaultValue: '' })) ||
        getApiErrorMessage(err, t('errors.generic'));
      setActionError(msg);
    }
  };

  const handleDisable = (id: string) => {
    void handleUpdate(id, { disabled: true });
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    setActionError(null);
    remove.mutate(deleteTarget.id, {
      onSuccess: () => setDeleteTarget(null),
      onError: (err) => {
        const code = getApiErrorCode(err);
        const msg =
          (code && t(`errors.${code}`, { defaultValue: '' })) ||
          getApiErrorMessage(err, t('errors.generic'));
        setActionError(msg);
        setDeleteTarget(null);
      },
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-2xl font-bold">{t('admin.usersTitle')}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => navigate('/admin/rating-config')}
          >
            <Sliders className="h-4 w-4" />
            {t('nav.adminRatingConfig')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => navigate('/admin/face-cards')}
          >
            <Images className="h-4 w-4" />
            {t('nav.adminFaceCards')}
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            {t('admin.createUser')}
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-textMuted" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('admin.searchPlaceholder')}
          className="pl-10"
        />
      </div>

      {actionError ? <Alert variant="error">{actionError}</Alert> : null}

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
      ) : list.data.items.length === 0 ? (
        <Card>
          <p className="text-center text-textMuted">{t('admin.empty')}</p>
        </Card>
      ) : (
        <>
          {/* Mobile: card list */}
          <div className="flex flex-col gap-3 md:hidden">
            {list.data.items.map((u) => (
              <UserCardMobile
                key={u.id}
                user={u}
                isSelf={u.id === me?.id}
                fmt={fmt}
                onUpdate={handleUpdate}
                onResetPassword={() => setResetTarget({ id: u.id, login: u.login })}
                onDisable={() => handleDisable(u.id)}
                onDelete={() => setDeleteTarget({ id: u.id, nickname: u.nickname })}
                busy={update.isPending || remove.isPending}
              />
            ))}
          </div>

          {/* Desktop: table */}
          <Card className="hidden md:block !p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surfaceAlt text-left text-textMuted">
                <tr>
                  <th className="px-4 py-3 font-medium">{t('admin.table.login')}</th>
                  <th className="px-4 py-3 font-medium">{t('admin.table.nickname')}</th>
                  <th className="px-4 py-3 font-medium">{t('admin.table.isAdmin')}</th>
                  <th className="px-4 py-3 font-medium">{t('admin.table.status')}</th>
                  <th className="px-4 py-3 font-medium">{t('admin.table.createdAt')}</th>
                  <th className="px-4 py-3 font-medium text-right">{t('admin.table.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.data.items.map((u) => (
                  <UserRow
                    key={u.id}
                    user={u}
                    isSelf={u.id === me?.id}
                    fmt={fmt}
                    onUpdate={handleUpdate}
                    onResetPassword={() => setResetTarget({ id: u.id, login: u.login })}
                    onDisable={() => handleDisable(u.id)}
                    onDelete={() => setDeleteTarget({ id: u.id, nickname: u.nickname })}
                    busy={update.isPending || remove.isPending}
                  />
                ))}
              </tbody>
            </table>
          </Card>

          {/* Pagination */}
          {totalPages > 1 ? (
            <div className="flex items-center justify-between gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                {t('admin.prev')}
              </Button>
              <div className="text-sm text-textMuted">
                {t('admin.page', { page, total: totalPages })}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                {t('admin.next')}
              </Button>
            </div>
          ) : null}
        </>
      )}

      <CreateUserModal open={createOpen} onClose={() => setCreateOpen(false)} />
      {resetTarget ? (
        <ResetPasswordModal
          open={!!resetTarget}
          onClose={() => setResetTarget(null)}
          userId={resetTarget.id}
          userLogin={resetTarget.login}
        />
      ) : null}
      {deleteTarget ? (
        <Modal
          open
          onClose={() => (remove.isPending ? undefined : setDeleteTarget(null))}
          title={t('admin.deleteModal.title')}
          footer={
            <>
              <Button
                variant="ghost"
                onClick={() => setDeleteTarget(null)}
                disabled={remove.isPending}
              >
                {t('common.cancel')}
              </Button>
              <Button variant="danger" onClick={confirmDelete} disabled={remove.isPending}>
                {remove.isPending
                  ? t('admin.deleteModal.submitting')
                  : t('admin.deleteModal.confirm')}
              </Button>
            </>
          }
        >
          <p className="text-sm">
            {t('admin.deleteModal.description', { nickname: deleteTarget.nickname })}
          </p>
        </Modal>
      ) : null}
    </div>
  );
}

interface RowProps {
  user: AdminUserDTO;
  isSelf: boolean;
  fmt: Intl.DateTimeFormat;
  onUpdate: (id: string, patch: { isAdmin?: boolean; disabled?: boolean }) => void;
  onResetPassword: () => void;
  onDisable: () => void;
  onDelete: () => void;
  busy: boolean;
}

function UserRow({
  user,
  isSelf,
  fmt,
  onUpdate,
  onResetPassword,
  onDisable,
  onDelete,
  busy,
}: RowProps) {
  const { t } = useTranslation();
  const disabled = !!user.disabledAt;

  return (
    <tr className="hover:bg-surfaceAlt/40">
      <td className="px-4 py-3 font-mono text-xs">{user.login}</td>
      <td className="px-4 py-3">{user.nickname}</td>
      <td className="px-4 py-3">
        {user.isAdmin ? (
          <ShieldCheck
            className="h-4 w-4 text-accent"
            aria-label={t('admin.table.isAdmin')}
          />
        ) : null}
      </td>
      <td className="px-4 py-3">
        <span
          className={clsx(
            'inline-flex rounded-full px-2 py-0.5 text-xs',
            disabled ? 'bg-danger/15 text-danger' : 'bg-success/15 text-success',
          )}
        >
          {disabled ? t('admin.status.disabled') : t('admin.status.active')}
        </span>
      </td>
      <td className="px-4 py-3 text-textMuted">
        {fmt.format(new Date(user.createdAt))}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap justify-end gap-1.5">
          <Button size="sm" variant="ghost" onClick={onResetPassword} disabled={busy}>
            {t('admin.actions.resetPassword')}
          </Button>
          {!isSelf ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onUpdate(user.id, { isAdmin: !user.isAdmin })}
              disabled={busy}
            >
              {user.isAdmin ? t('admin.actions.revokeAdmin') : t('admin.actions.makeAdmin')}
            </Button>
          ) : null}
          {!isSelf ? (
            disabled ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onUpdate(user.id, { disabled: false })}
                  disabled={busy}
                >
                  {t('admin.actions.enable')}
                </Button>
                <Button size="sm" variant="danger" onClick={onDelete} disabled={busy}>
                  {t('admin.actions.delete')}
                </Button>
              </>
            ) : (
              <Button size="sm" variant="danger" onClick={onDisable} disabled={busy}>
                {t('admin.actions.disable')}
              </Button>
            )
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function UserCardMobile({
  user,
  isSelf,
  fmt,
  onUpdate,
  onResetPassword,
  onDisable,
  onDelete,
  busy,
}: RowProps) {
  const { t } = useTranslation();
  const disabled = !!user.disabledAt;
  return (
    <Card className="!p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold">{user.nickname}</div>
          <div className="font-mono text-xs text-textMuted">{user.login}</div>
        </div>
        <span
          className={clsx(
            'rounded-full px-2 py-0.5 text-xs',
            disabled ? 'bg-danger/15 text-danger' : 'bg-success/15 text-success',
          )}
        >
          {disabled ? t('admin.status.disabled') : t('admin.status.active')}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-textMuted">
        {user.isAdmin ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-accent">
            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
            {t('admin.table.isAdmin')}
          </span>
        ) : null}
        <span>{fmt.format(new Date(user.createdAt))}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Button size="sm" variant="secondary" onClick={onResetPassword} disabled={busy}>
          {t('admin.actions.resetPassword')}
        </Button>
        {!isSelf ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onUpdate(user.id, { isAdmin: !user.isAdmin })}
            disabled={busy}
          >
            {user.isAdmin ? t('admin.actions.revokeAdmin') : t('admin.actions.makeAdmin')}
          </Button>
        ) : null}
        {!isSelf ? (
          disabled ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onUpdate(user.id, { disabled: false })}
                disabled={busy}
              >
                {t('admin.actions.enable')}
              </Button>
              <Button size="sm" variant="danger" onClick={onDelete} disabled={busy}>
                {t('admin.actions.delete')}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="danger" onClick={onDisable} disabled={busy}>
              {t('admin.actions.disable')}
            </Button>
          )
        ) : null}
      </div>
    </Card>
  );
}
