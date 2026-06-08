import { ChangeEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, Upload } from 'lucide-react';
import { Alert, Button, Card, Spinner } from '@/components/ui';
import { PlayingCard } from '@/features/games/PlayingCard';
import { getApiErrorCode, getApiErrorMessage } from '@/lib/api';
import type {
  FaceCardAsset,
  FaceCardRank,
  FaceCardSuit,
} from '@durak/shared-types';
import {
  useAdminFaceCards,
  useDeleteFaceCard,
  useUploadFaceCard,
} from './faceCardsHooks';

const RANKS: FaceCardRank[] = ['jack', 'queen', 'king'];
const SUITS: FaceCardSuit[] = ['spades', 'hearts', 'diamonds', 'clubs'];

/** Numeric rank used by the PlayingCard preview component. */
const RANK_TO_NUMBER: Record<FaceCardRank, 11 | 12 | 13> = {
  jack: 11,
  queen: 12,
  king: 13,
};

const SUIT_GLYPH: Record<FaceCardSuit, string> = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
};

const SUIT_COLOR: Record<FaceCardSuit, string> = {
  spades: 'text-slate-900',
  clubs: 'text-slate-900',
  hearts: 'text-red-600',
  diamonds: 'text-red-600',
};

function slotKey(rank: FaceCardRank, suit: FaceCardSuit): string {
  return `${rank}:${suit}`;
}

export function AdminFaceCardsPage() {
  const { t } = useTranslation();
  const list = useAdminFaceCards();
  const upload = useUploadFaceCard();
  const remove = useDeleteFaceCard();
  const [slotError, setSlotError] = useState<Record<string, string>>({});

  const assetsBySlot = new Map<string, FaceCardAsset>();
  for (const asset of list.data ?? []) {
    assetsBySlot.set(slotKey(asset.rank, asset.suit), asset);
  }

  const clearSlotError = (key: string) => {
    setSlotError((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleError = (key: string, err: unknown) => {
    const code = getApiErrorCode(err);
    const msg =
      (code && t(`errors.${code}`, { defaultValue: '' })) ||
      getApiErrorMessage(err, t('errors.generic'));
    setSlotError((prev) => ({ ...prev, [key]: msg }));
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">{t('admin.faceCards.title')}</h1>
        <p className="mt-1 text-sm text-textMuted">
          {t('admin.faceCards.subtitle')}
        </p>
      </div>

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
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {RANKS.flatMap((rank) =>
              SUITS.map((suit) => {
                const key = slotKey(rank, suit);
                const asset = assetsBySlot.get(key);
                return (
                  <SlotCell
                    key={key}
                    rank={rank}
                    suit={suit}
                    asset={asset}
                    error={slotError[key]}
                    busy={
                      (upload.isPending && upload.variables?.rank === rank && upload.variables?.suit === suit) ||
                      (remove.isPending && remove.variables?.rank === rank && remove.variables?.suit === suit)
                    }
                    onUpload={async (file) => {
                      clearSlotError(key);
                      try {
                        await upload.mutateAsync({ rank, suit, file });
                      } catch (err) {
                        handleError(key, err);
                      }
                    }}
                    onReset={async () => {
                      clearSlotError(key);
                      try {
                        await remove.mutateAsync({ rank, suit });
                      } catch (err) {
                        handleError(key, err);
                      }
                    }}
                  />
                );
              }),
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

interface SlotCellProps {
  rank: FaceCardRank;
  suit: FaceCardSuit;
  asset: FaceCardAsset | undefined;
  error: string | undefined;
  busy: boolean;
  onUpload: (file: File) => Promise<void>;
  onReset: () => Promise<void>;
}

function SlotCell({
  rank,
  suit,
  asset,
  error,
  busy,
  onUpload,
  onReset,
}: SlotCellProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input so picking the same file twice in a row still fires.
    e.target.value = '';
    if (!file) return;
    void onUpload(file);
  };

  const hasCustom = !!asset?.url;

  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surfaceAlt/40 p-3">
      <div className="flex items-center gap-1 text-sm font-medium">
        <span>{t(`admin.faceCards.rank.${rank}`)}</span>
        <span className={SUIT_COLOR[suit]} aria-label={t(`admin.faceCards.suit.${suit}`)}>
          {SUIT_GLYPH[suit]}
        </span>
      </div>

      <div className="flex w-full justify-center">
        <PlayingCard
          card={{
            kind: 'standard',
            id: `preview-${rank}-${suit}`,
            rank: RANK_TO_NUMBER[rank],
            suit,
          }}
          size="md"
        />
      </div>

      <div className="text-[11px] text-textMuted">
        {hasCustom
          ? t('admin.faceCards.uploaded')
          : t('admin.faceCards.default')}
      </div>

      {error ? (
        <Alert variant="error" className="w-full text-xs">
          {error}
        </Alert>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={onFile}
        aria-label={t('admin.faceCards.upload')}
      />

      <div className="flex w-full flex-col gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="w-full"
        >
          <Upload className="h-4 w-4" />
          {busy ? t('common.save') : t('admin.faceCards.upload')}
        </Button>
        {hasCustom ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void onReset()}
            disabled={busy}
            className="w-full"
          >
            <Trash2 className="h-4 w-4" />
            {t('admin.faceCards.reset')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
