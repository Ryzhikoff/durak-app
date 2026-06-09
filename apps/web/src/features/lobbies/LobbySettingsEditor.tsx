/**
 * Shared lobby-settings editor. Used both inside CreateLobbyModal (uncontrolled
 * local state, submitted via "Create" button) and inside LobbyRoomPage (each
 * change is pushed to the server immediately, with a 300ms debounce for the
 * cheatAttempts number input).
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import {
  ALLOWED_TURN_TIMERS,
  DEFAULT_LOBBY_SETTINGS,
  LOBBY_PLAYER_COUNTS,
  type LobbySettings,
} from '@durak/shared-types';

interface SettingsEditorProps {
  value: LobbySettings;
  onChange: (next: LobbySettings) => void;
  /** Disables every control (e.g. while a mutation is in-flight). */
  disabled?: boolean;
  /**
   * Hide the "changing settings resets ready" warning. Only relevant in the
   * room view; the create-modal doesn't need it.
   */
  showResetWarning?: boolean;
}

export function LobbySettingsEditor({
  value,
  onChange,
  disabled,
  showResetWarning,
}: SettingsEditorProps) {
  const { t } = useTranslation();
  const set = <K extends keyof LobbySettings>(key: K, v: LobbySettings[K]) => {
    onChange({ ...value, [key]: v });
  };

  return (
    <div className="flex flex-col gap-5">
      {showResetWarning ? (
        <p className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-textMuted">
          {t('lobbySettings.resetWarning')}
        </p>
      ) : null}

      <Field label={t('lobbySettings.maxPlayers')}>
        <SegmentedControl
          value={value.maxPlayers}
          options={LOBBY_PLAYER_COUNTS.map((n) => ({ value: n, label: String(n) }))}
          onChange={(v) => set('maxPlayers', v as LobbySettings['maxPlayers'])}
          disabled={disabled}
        />
      </Field>

      <Field label={t('lobbySettings.firstBoutLimit.label')}>
        <SegmentedControl
          value={value.firstBoutLimit}
          options={[
            { value: 5, label: t('lobbySettings.firstBoutLimit.five') },
            { value: 6, label: t('lobbySettings.firstBoutLimit.six') },
            {
              value: 'defender_hand',
              label: t('lobbySettings.firstBoutLimit.defenderHand'),
            },
          ]}
          onChange={(v) => set('firstBoutLimit', v as LobbySettings['firstBoutLimit'])}
          disabled={disabled}
        />
      </Field>

      <Field label={t('lobbySettings.attackerScope.label')}>
        <SegmentedControl
          value={value.attackerScope}
          options={[
            { value: 'all', label: t('lobbySettings.attackerScope.all') },
            { value: 'attacker_only', label: t('lobbySettings.attackerScope.attackerOnly') },
          ]}
          onChange={(v) => set('attackerScope', v as LobbySettings['attackerScope'])}
          disabled={disabled}
        />
      </Field>

      <Field label={t('lobbySettings.exclusiveThrowIn.label')}>
        <Toggle
          checked={value.exclusiveThrowIn}
          onChange={(v) => set('exclusiveThrowIn', v)}
          disabled={disabled}
          srLabel={t('lobbySettings.exclusiveThrowIn.label')}
        />
        <p className="mt-1 text-xs text-textMuted">
          {t('lobbySettings.exclusiveThrowIn.description')}
        </p>
      </Field>

      <Field label={t('lobbySettings.cheating.label')}>
        <Toggle
          checked={value.cheatingEnabled}
          onChange={(v) => set('cheatingEnabled', v)}
          disabled={disabled}
          srLabel={t('lobbySettings.cheating.label')}
        />
      </Field>

      {value.cheatingEnabled ? (
        <div className="ml-2 flex flex-col gap-4 border-l border-border pl-4">
          <Field label={t('lobbySettings.cheatAttempts')}>
            <NumberStepper
              value={value.cheatAttempts}
              min={1}
              max={10}
              onChange={(v) => set('cheatAttempts', v)}
              disabled={disabled}
            />
          </Field>
          <Field label={t('lobbySettings.cheatNoticeScope.label')}>
            <SegmentedControl
              value={value.cheatNoticeScope}
              options={[
                {
                  value: 'defender_only',
                  label: t('lobbySettings.cheatNoticeScope.defenderOnly'),
                },
                { value: 'all', label: t('lobbySettings.cheatNoticeScope.all') },
              ]}
              onChange={(v) => set('cheatNoticeScope', v as LobbySettings['cheatNoticeScope'])}
              disabled={disabled}
            />
          </Field>
        </div>
      ) : null}

      <Field label={t('lobbySettings.layoutOnRepeat.label')}>
        <SegmentedControl
          value={value.layoutOnRepeat}
          options={[
            { value: 'random', label: t('lobbySettings.layoutOnRepeat.random') },
            { value: 'preserve', label: t('lobbySettings.layoutOnRepeat.preserve') },
          ]}
          onChange={(v) => set('layoutOnRepeat', v as LobbySettings['layoutOnRepeat'])}
          disabled={disabled}
        />
      </Field>

      <Field label={t('lobbySettings.firstTurn.label')}>
        <SegmentedControl
          value={value.firstTurn}
          options={[
            { value: 'lowest_trump', label: t('lobbySettings.firstTurn.lowestTrump') },
            { value: 'random', label: t('lobbySettings.firstTurn.random') },
            { value: 'previous_loser', label: t('lobbySettings.firstTurn.previousLoser') },
          ]}
          onChange={(v) => set('firstTurn', v as LobbySettings['firstTurn'])}
          disabled={disabled}
        />
      </Field>

      <Field label={t('lobbySettings.deckSize')}>
        <SegmentedControl
          value={value.deckSize}
          options={[
            { value: 36, label: '36' },
            { value: 52, label: '52' },
          ]}
          onChange={(v) => set('deckSize', v as LobbySettings['deckSize'])}
          disabled={disabled}
        />
      </Field>

      <Field label={t('lobbySettings.jokers')}>
        <Toggle
          checked={value.jokers}
          onChange={(v) => set('jokers', v)}
          disabled={disabled}
          srLabel={t('lobbySettings.jokers')}
        />
      </Field>

      <Field label={t('lobbySettings.turnTimer.label')}>
        <SegmentedControl
          value={value.turnTimer === null ? 'off' : String(value.turnTimer)}
          options={ALLOWED_TURN_TIMERS.map((v) => ({
            value: v === null ? 'off' : String(v),
            label:
              v === null
                ? t('lobbySettings.turnTimer.off')
                : t('lobbySettings.turnTimer.seconds', { count: v }),
          }))}
          onChange={(v) => set('turnTimer', v === 'off' ? null : Number(v))}
          disabled={disabled}
        />
      </Field>
    </div>
  );
}

/** Returns a fresh copy of the defaults, for safety against mutation. */
export function getDefaultSettings(): LobbySettings {
  return { ...DEFAULT_LOBBY_SETTINGS };
}

// ---------- small primitives ----------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-sm font-medium text-textMuted">{label}</div>
      <div>{children}</div>
    </div>
  );
}

interface SegmentedOption<T> {
  value: T;
  label: string;
}

function SegmentedControl<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="inline-flex flex-wrap gap-1 rounded-xl border border-border bg-surfaceAlt p-1"
      role="radiogroup"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={clsx(
              'rounded-lg px-3 py-1.5 text-sm transition-colors',
              active
                ? 'bg-accent text-accentText'
                : 'text-text hover:bg-border',
              disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
  srLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  srLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={srLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative inline-flex h-7 w-12 items-center rounded-full transition-colors',
        checked ? 'bg-accent' : 'bg-surfaceAlt border border-border',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        className={clsx(
          'inline-block h-5 w-5 transform rounded-full bg-white transition-transform',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  );
}

function NumberStepper({
  value,
  min,
  max,
  onChange,
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  // Mirror the prop into local state so typing freely works without losing
  // intermediate values to the clamp.
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = (raw: string) => {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n)) {
      const clamped = Math.max(min, Math.min(max, n));
      onChange(clamped);
      setDraft(String(clamped));
    } else {
      setDraft(String(value));
    }
  };

  return (
    <div className="inline-flex items-center gap-1.5">
      <button
        type="button"
        disabled={disabled || value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
        className="h-9 w-9 rounded-lg border border-border bg-surfaceAlt text-lg leading-none disabled:opacity-40"
        aria-label="−"
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        className="h-9 w-16 rounded-lg border border-border bg-surface text-center tabular-nums"
      />
      <button
        type="button"
        disabled={disabled || value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        className="h-9 w-9 rounded-lg border border-border bg-surfaceAlt text-lg leading-none disabled:opacity-40"
        aria-label="+"
      >
        +
      </button>
    </div>
  );
}
