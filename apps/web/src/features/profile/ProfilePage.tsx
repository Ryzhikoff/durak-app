import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Shuffle, ShieldCheck, Trash2, Upload } from 'lucide-react';
import clsx from 'clsx';
import { Alert, Button, Card, Input, Modal, Spinner } from '@/components/ui';
import { Avatar } from '@/components/Avatar';
import { AvatarUploader } from '@/components/AvatarUploader';
import { CardBack } from '@/components/CardBack';
import { useAuthStore } from '@/stores/auth.store';
import { getApiErrorCode, getApiErrorMessage } from '@/lib/api';
import { CUSTOM_CARD_BACK_ID } from '@/lib/constants';
import {
  useDeleteAvatar,
  useDeleteCardBack,
  usePublicProfile,
  useUpdateMe,
  useUploadAvatar,
  useUploadCardBack,
} from './hooks';
import { useCardBacks } from '@/features/cardbacks/hooks';
import type {
  CardBackDef,
  GameSummary,
  ProfileStats,
  PublicProfile,
} from '@durak/shared-types';

const CARD_BACK_MAX_BYTES = 5 * 1024 * 1024;
const CARD_BACK_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function ProfilePage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const me = useAuthStore((s) => s.user);

  const profile = usePublicProfile(id);

  if (!id) {
    return <Navigate to="/" replace />;
  }

  if (profile.isPending) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="text-accent" />
      </div>
    );
  }

  if (profile.isError) {
    const code = getApiErrorCode(profile.error);
    if (code === 'USER_NOT_FOUND') {
      return (
        <Card className="text-center">
          <h1 className="text-xl font-semibold">{t('profile.notFound')}</h1>
          <div className="mt-4">
            <Link to="/">
              <Button variant="secondary">{t('profile.backToHome')}</Button>
            </Link>
          </div>
        </Card>
      );
    }
    return (
      <Alert variant="error">
        {getApiErrorMessage(profile.error, t('errors.generic'))}
      </Alert>
    );
  }

  const isOwn = !!me && me.id === profile.data.id;
  return <ProfileView profile={profile.data} isOwn={isOwn} />;
}

function ProfileView({
  profile,
  isOwn,
}: {
  profile: PublicProfile;
  isOwn: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6">
      <ProfileHeader profile={profile} />
      <StatsSection stats={profile.stats} />
      <LastGamesSection games={profile.lastGames} />
      {isOwn ? <OwnSettings profile={profile} /> : null}
      {isOwn ? (
        <Card>
          <Link
            to="/change-password"
            className="inline-flex items-center text-accent hover:text-accentHover underline-offset-4 hover:underline"
          >
            {t('profile.changePasswordLink')}
          </Link>
        </Card>
      ) : null}
    </div>
  );
}

function ProfileHeader({ profile }: { profile: PublicProfile }) {
  const { t } = useTranslation();
  return (
    <Card className="!p-5">
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <Avatar
          src={profile.avatarUrl}
          nickname={profile.nickname}
          size={96}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">{profile.nickname}</h1>
            {profile.isAdmin ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">
                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                {t('profile.adminBadge')}
              </span>
            ) : null}
          </div>
          <div className="text-sm text-textMuted">
            {t('profile.ratingLabel')}
          </div>
          <div className="text-3xl font-extrabold tabular-nums">{profile.rating}</div>
        </div>
      </div>
    </Card>
  );
}

const STAT_KEYS: ReadonlyArray<keyof ProfileStats> = [
  'gamesPlayed',
  'wins',
  'lastPlaces',
  'firstPlaceRate',
  'lastPlaceRate',
  'cheatAttempts',
  'cheatCaught',
];

function StatsSection({ stats }: { stats: ProfileStats }) {
  const { t } = useTranslation();
  const allZero = STAT_KEYS.every((k) => stats[k] === 0);
  return (
    <section aria-labelledby="profile-stats" className="flex flex-col gap-3">
      <h2 id="profile-stats" className="text-lg font-semibold">
        {t('profile.statsTitle')}
      </h2>
      {allZero ? (
        <Card>
          <p className="text-center text-textMuted">{t('profile.statsEmpty')}</p>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {STAT_KEYS.map((key) => (
            <StatCard
              key={key}
              label={t(`profile.stats.${key}`)}
              value={formatStat(key, stats[key])}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function formatStat(key: keyof ProfileStats, value: number): string {
  if (key === 'firstPlaceRate' || key === 'lastPlaceRate') {
    // API gives 0..1
    return `${Math.round(value * 100)}%`;
  }
  return String(value);
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="!p-4">
      <div className="text-xs uppercase tracking-wide text-textMuted">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums">{value}</div>
    </Card>
  );
}

function LastGamesSection({ games }: { games: GameSummary[] }) {
  const { t } = useTranslation();
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
    <section aria-labelledby="profile-last-games" className="flex flex-col gap-3">
      <h2 id="profile-last-games" className="text-lg font-semibold">
        {t('profile.lastGamesTitle')}
      </h2>
      {games.length === 0 ? (
        <Card>
          <p className="text-center text-textMuted">{t('profile.lastGamesEmpty')}</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {games.map((g) => (
            <Link key={g.id} to={`/games/${g.id}`}>
              <Card className="!p-3 transition-colors hover:bg-surfaceAlt/60">
                <div className="text-sm font-medium">
                  {g.players.map((p) => p.nickname).join(', ')}
                </div>
                <div className="text-xs text-textMuted">
                  {fmt.format(new Date(g.startedAt))}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function OwnSettings({ profile }: { profile: PublicProfile }) {
  const { t } = useTranslation();
  const updateMe = useUpdateMe();
  const uploadAvatar = useUploadAvatar();
  const deleteAvatar = useDeleteAvatar();
  const uploadCardBack = useUploadCardBack();
  const deleteCardBack = useDeleteCardBack();
  const cardBacks = useCardBacks();

  const [nickname, setNickname] = useState(profile.nickname);
  const [nickError, setNickError] = useState<string | null>(null);
  const [nickSaved, setNickSaved] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [cardBackError, setCardBackError] = useState<string | null>(null);
  const [customClientError, setCustomClientError] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  useEffect(() => {
    setNickname(profile.nickname);
  }, [profile.nickname]);

  const onSubmitNick = async (e: FormEvent) => {
    e.preventDefault();
    setNickError(null);
    const trimmed = nickname.trim();
    if (trimmed === profile.nickname) return;
    try {
      await updateMe.mutateAsync({ nickname: trimmed });
      setNickSaved(true);
      setTimeout(() => setNickSaved(false), 2500);
    } catch (err) {
      setNickError(translateApiError(err, t));
    }
  };

  const onUpload = async (file: File) => {
    setAvatarError(null);
    try {
      await uploadAvatar.mutateAsync(file);
    } catch (err) {
      setAvatarError(translateApiError(err, t));
      throw err;
    }
  };

  const onDelete = async () => {
    setAvatarError(null);
    try {
      await deleteAvatar.mutateAsync();
    } catch (err) {
      setAvatarError(translateApiError(err, t));
    }
  };

  const selectCardBack = async (
    id: string,
    options: { random: boolean },
  ) => {
    setCardBackError(null);
    try {
      if (options.random) {
        await updateMe.mutateAsync({ randomCardBack: true });
      } else {
        await updateMe.mutateAsync({ cardBackId: id, randomCardBack: false });
      }
    } catch (err) {
      setCardBackError(translateApiError(err, t));
    }
  };

  const toggleRandomCardBack = async () => {
    setCardBackError(null);
    try {
      await updateMe.mutateAsync({ randomCardBack: !profile.randomCardBack });
    } catch (err) {
      setCardBackError(translateApiError(err, t));
    }
  };

  const onUploadCustomCardBack = async (file: File) => {
    setCardBackError(null);
    setCustomClientError(null);
    if (!CARD_BACK_ACCEPTED_TYPES.includes(file.type)) {
      setCustomClientError(t('errors.AVATAR_INVALID_TYPE'));
      return;
    }
    if (file.size > CARD_BACK_MAX_BYTES) {
      setCustomClientError(t('errors.AVATAR_TOO_LARGE'));
      return;
    }
    try {
      await uploadCardBack.mutateAsync(file);
    } catch (err) {
      setCardBackError(translateApiError(err, t));
    }
  };

  const onDeleteCustomCardBack = async () => {
    setCardBackError(null);
    try {
      await deleteCardBack.mutateAsync();
    } catch (err) {
      setCardBackError(translateApiError(err, t));
    } finally {
      setConfirmDeleteOpen(false);
    }
  };

  const cardBackBusy =
    updateMe.isPending || uploadCardBack.isPending || deleteCardBack.isPending;

  return (
    <section aria-labelledby="profile-settings" className="flex flex-col gap-4">
      <h2 id="profile-settings" className="text-lg font-semibold">
        {t('profile.settingsTitle')}
      </h2>

      <Card>
        <form className="flex flex-col gap-4" onSubmit={onSubmitNick} noValidate>
          {nickError ? <Alert variant="error">{nickError}</Alert> : null}
          {nickSaved ? <Alert variant="success">{t('profile.saved')}</Alert> : null}
          <Input
            label={t('profile.nickname')}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            minLength={2}
            maxLength={24}
            disabled={updateMe.isPending}
            required
          />
          <Button
            type="submit"
            disabled={updateMe.isPending || nickname.trim() === profile.nickname}
          >
            {updateMe.isPending ? t('profile.saving') : t('profile.save')}
          </Button>
        </form>
      </Card>

      <Card>
        <div className="mb-3 text-sm font-medium text-textMuted">
          {t('profile.avatarTitle')}
        </div>
        <AvatarUploader
          value={profile.avatarUrl}
          nickname={profile.nickname}
          onUpload={onUpload}
          onDelete={onDelete}
          uploading={uploadAvatar.isPending}
          deleting={deleteAvatar.isPending}
          error={avatarError}
        />
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-sm font-medium text-textMuted">
            {t('profile.cardBackTitle')}
          </div>
          {cardBackBusy ? (
            <span className="text-xs text-textMuted">{t('profile.cardBackSaving')}</span>
          ) : null}
        </div>
        {cardBackError ? (
          <Alert variant="error" className="mb-3">
            {cardBackError}
          </Alert>
        ) : null}
        {customClientError ? (
          <Alert variant="error" className="mb-3">
            {customClientError}
          </Alert>
        ) : null}
        {cardBacks.isPending ? (
          <div className="flex justify-center py-4">
            <Spinner className="text-accent" />
          </div>
        ) : cardBacks.isError ? (
          <Alert variant="error">
            {getApiErrorMessage(cardBacks.error, t('errors.generic'))}
          </Alert>
        ) : (
          <div className="flex flex-col gap-4">
            <CurrentCardBackPreview
              profile={profile}
              items={cardBacks.data.items}
            />
            <CardBackPicker
              items={cardBacks.data.items}
              randomOptionId={cardBacks.data.randomOptionId}
              selectedId={profile.cardBackId}
              randomEnabled={profile.randomCardBack}
              busy={cardBackBusy}
              customImageUrl={profile.customCardBackUrl}
              onSelect={(id) => void selectCardBack(id, { random: false })}
              onSelectRandom={() => void toggleRandomCardBack()}
              onUploadCustom={(file) => void onUploadCustomCardBack(file)}
              onRequestDeleteCustom={() => setConfirmDeleteOpen(true)}
              uploadingCustom={uploadCardBack.isPending}
            />
          </div>
        )}
      </Card>

      <Modal
        open={confirmDeleteOpen}
        onClose={() => {
          if (!deleteCardBack.isPending) setConfirmDeleteOpen(false);
        }}
        dismissible={!deleteCardBack.isPending}
        title={t('profile.cardBack.custom.deleteConfirmTitle')}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setConfirmDeleteOpen(false)}
              disabled={deleteCardBack.isPending}
            >
              {t('profile.cardBack.custom.deleteConfirmCancel')}
            </Button>
            <Button
              variant="danger"
              onClick={() => void onDeleteCustomCardBack()}
              disabled={deleteCardBack.isPending}
            >
              {t('profile.cardBack.custom.deleteConfirmConfirm')}
            </Button>
          </>
        }
      >
        <p className="text-sm">
          {t('profile.cardBack.custom.deleteConfirmBody')}
        </p>
      </Modal>
    </section>
  );
}

function translateApiError(
  err: unknown,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const code = getApiErrorCode(err);
  const translated = code ? t(`errors.${code}`, { defaultValue: '' }) : '';
  return translated || getApiErrorMessage(err, t('errors.generic'));
}

function CurrentCardBackPreview({
  profile,
  items,
}: {
  profile: PublicProfile;
  items: CardBackDef[];
}) {
  const { t } = useTranslation();
  const isCustom = profile.cardBackId === CUSTOM_CARD_BACK_ID;
  const presetDef = useMemo(
    () => items.find((i) => i.id === profile.cardBackId),
    [items, profile.cardBackId],
  );

  return (
    <div className="flex items-center gap-4 rounded-xl border border-border bg-surfaceAlt/40 p-3">
      <div className="flex h-24 w-16 shrink-0 items-center justify-center">
        {profile.randomCardBack ? (
          <div className="flex h-24 w-16 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface">
            <Shuffle className="h-6 w-6 text-textMuted" aria-hidden="true" />
          </div>
        ) : isCustom && profile.customCardBackUrl ? (
          <CardBack
            mode="custom"
            imageUrl={profile.customCardBackUrl}
            size="md"
            selected
          />
        ) : presetDef ? (
          <CardBack def={presetDef} size="md" selected />
        ) : (
          <div className="flex h-24 w-16 items-center justify-center rounded-xl border border-dashed border-border bg-surface" />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="text-xs uppercase tracking-wide text-textMuted">
          {t('profile.cardBackCurrent')}
        </div>
        <div className="text-sm font-medium">
          {profile.randomCardBack
            ? t('profile.cardBackCurrentRandom')
            : isCustom
              ? t('profile.cardBack.custom.title')
              : (presetDef?.name ?? profile.cardBackId)}
        </div>
      </div>
    </div>
  );
}

interface CardBackPickerProps {
  items: CardBackDef[];
  randomOptionId: string;
  selectedId: string;
  randomEnabled: boolean;
  busy: boolean;
  customImageUrl: string | null;
  uploadingCustom: boolean;
  onSelect: (id: string) => void;
  onSelectRandom: () => void;
  onUploadCustom: (file: File) => void;
  onRequestDeleteCustom: () => void;
}

function CardBackPicker({
  items,
  randomOptionId,
  selectedId,
  randomEnabled,
  busy,
  customImageUrl,
  uploadingCustom,
  onSelect,
  onSelectRandom,
  onUploadCustom,
  onRequestDeleteCustom,
}: CardBackPickerProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
        <li>
          <CustomCardBackTile
            imageUrl={customImageUrl}
            selected={!randomEnabled && selectedId === CUSTOM_CARD_BACK_ID}
            busy={busy}
            uploading={uploadingCustom}
            onSelect={() => onSelect(CUSTOM_CARD_BACK_ID)}
            onUpload={onUploadCustom}
            onRequestDelete={onRequestDeleteCustom}
          />
        </li>
        {items.map((cb) => {
          const isSelected = !randomEnabled && cb.id === selectedId;
          return (
            <li key={cb.id}>
              <button
                type="button"
                onClick={() => onSelect(cb.id)}
                disabled={busy}
                className={clsx(
                  'flex w-full flex-col items-center gap-1.5 rounded-xl p-2 text-xs transition-colors',
                  'hover:bg-surfaceAlt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  'disabled:cursor-not-allowed disabled:opacity-60',
                  isSelected ? 'bg-surfaceAlt' : '',
                )}
                aria-pressed={isSelected}
              >
                <CardBack def={cb} size="md" selected={isSelected} />
                <span className="line-clamp-1 text-center text-textMuted">{cb.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <label
        className={clsx(
          'flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surfaceAlt/40 p-3',
          busy ? 'cursor-not-allowed opacity-70' : '',
        )}
      >
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 accent-accent"
          checked={randomEnabled}
          onChange={onSelectRandom}
          disabled={busy}
          aria-describedby={`${randomOptionId}-hint`}
        />
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">{t('profile.cardBackRandom')}</span>
          <span id={`${randomOptionId}-hint`} className="text-xs text-textMuted">
            {t('profile.cardBackRandomHint')}
          </span>
        </div>
      </label>
    </div>
  );
}

interface CustomCardBackTileProps {
  imageUrl: string | null;
  selected: boolean;
  busy: boolean;
  uploading: boolean;
  onSelect: () => void;
  onUpload: (file: File) => void;
  onRequestDelete: () => void;
}

function CustomCardBackTile({
  imageUrl,
  selected,
  busy,
  uploading,
  onSelect,
  onUpload,
  onRequestDelete,
}: CustomCardBackTileProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    onUpload(file);
  };

  const hasImage = !!imageUrl;

  return (
    <div className="flex w-full flex-col items-center gap-1.5 rounded-xl p-2 text-xs">
      <div className="relative">
        {hasImage ? (
          <button
            type="button"
            onClick={onSelect}
            disabled={busy}
            className={clsx(
              'rounded-xl transition-colors',
              'hover:bg-surfaceAlt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              'disabled:cursor-not-allowed disabled:opacity-60',
              selected ? 'bg-surfaceAlt' : '',
            )}
            aria-pressed={selected}
            aria-label={selected ? t('profile.cardBack.custom.selected') : t('profile.cardBack.custom.select')}
          >
            <CardBack
              mode="custom"
              imageUrl={imageUrl}
              size="md"
              selected={selected}
              label={t('profile.cardBack.custom.title')}
            />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className={clsx(
              'flex h-24 w-16 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surfaceAlt/40 text-textMuted transition-colors',
              'hover:bg-surfaceAlt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              'disabled:cursor-not-allowed disabled:opacity-60',
            )}
            aria-label={t('profile.cardBack.custom.uploadPrompt')}
          >
            {uploading ? (
              <Spinner className="text-accent" />
            ) : (
              <Upload className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        )}
        {hasImage ? (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                inputRef.current?.click();
              }}
              disabled={busy}
              aria-label={t('profile.cardBack.custom.replace')}
              title={t('profile.cardBack.custom.replace')}
              className={clsx(
                'absolute -left-1 -top-1 inline-flex h-8 w-8 items-center justify-center rounded-full',
                'bg-surface text-text shadow-sm border border-border',
                'hover:bg-accent hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                'disabled:cursor-not-allowed disabled:opacity-60',
              )}
            >
              {uploading ? (
                <Spinner className="h-4 w-4 text-accent" />
              ) : (
                <Upload className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRequestDelete();
              }}
              disabled={busy}
              aria-label={t('profile.cardBack.custom.delete')}
              title={t('profile.cardBack.custom.delete')}
              className={clsx(
                'absolute -right-1 -top-1 inline-flex h-8 w-8 items-center justify-center rounded-full',
                'bg-surface text-text shadow-sm border border-border',
                'hover:bg-danger hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                'disabled:cursor-not-allowed disabled:opacity-60',
              )}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </>
        ) : null}
      </div>
      <span className="line-clamp-1 text-center text-textMuted">
        {t('profile.cardBack.custom.title')}
      </span>
      {!hasImage ? (
        <span className="line-clamp-2 text-center text-[10px] text-textMuted">
          {t('profile.cardBack.custom.uploadHint')}
        </span>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept={CARD_BACK_ACCEPTED_TYPES.join(',')}
        className="hidden"
        onChange={handleChange}
      />
    </div>
  );
}
