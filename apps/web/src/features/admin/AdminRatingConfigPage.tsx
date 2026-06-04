import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import { Alert, Button, Card, Input, Spinner } from '@/components/ui';
import { useRatingConfig, useUpdateRatingConfig } from './ratingConfigHooks';
import { getApiErrorCode, getApiErrorMessage } from '@/lib/api';
import type {
  RatingConfig,
  UpdateRatingConfigRequest,
} from '@durak/shared-types';

/**
 * Range constraints mirror what the API validator accepts. Values outside
 * these bounds are flagged client-side; the server will also reject them.
 *
 * NOTE: `drawProbability` is deliberately NOT exposed in the UI — for Durak
 * draw handling is derived from the game's actual outcome (loserId == null
 * → draw, see games.service finalizeGame). The DB column and DTO field are
 * kept for forward-compat; the form just doesn't surface them.
 */
const FIELD_LIMITS = {
  initialMu: { min: 1, max: 100, step: 0.1 },
  initialSigma: { min: 0.01, max: 50, step: 0.01 },
  beta: { min: 0.01, max: 50, step: 0.01 },
  tau: { min: 0.0001, max: 10, step: 0.0001 },
} as const;

interface FormState {
  initialMu: string;
  initialSigma: string;
  beta: string;
  tau: string;
}

function configToForm(cfg: RatingConfig): FormState {
  return {
    initialMu: String(cfg.initialMu),
    initialSigma: String(cfg.initialSigma),
    beta: String(cfg.beta),
    tau: String(cfg.tau),
  };
}

function parseNum(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

interface ParsedForm {
  values: { [K in keyof FormState]: number };
  invalidField: keyof FormState | null;
}

function parseAndValidate(form: FormState): ParsedForm {
  const out = {} as { [K in keyof FormState]: number };
  const keys = Object.keys(FIELD_LIMITS) as (keyof FormState)[];
  for (const k of keys) {
    const n = parseNum(form[k]);
    const lim = FIELD_LIMITS[k];
    if (n === null || n < lim.min || n > lim.max) {
      return { values: out, invalidField: k };
    }
    out[k] = n;
  }
  return { values: out, invalidField: null };
}

export function AdminRatingConfigPage() {
  const { t } = useTranslation();
  const cfg = useRatingConfig();
  const update = useUpdateRatingConfig();

  const [form, setForm] = useState<FormState | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Seed the form once data loads; keep the user's edits if they edited
  // before the refetch (e.g. cache invalidation) by only seeding on first load.
  useEffect(() => {
    if (cfg.data && form === null) {
      setForm(configToForm(cfg.data));
    }
  }, [cfg.data, form]);

  const parsed = useMemo<ParsedForm | null>(
    () => (form ? parseAndValidate(form) : null),
    [form],
  );

  const isDirty = useMemo(() => {
    if (!cfg.data || !form) return false;
    const orig = configToForm(cfg.data);
    return (
      orig.initialMu !== form.initialMu ||
      orig.initialSigma !== form.initialSigma ||
      orig.beta !== form.beta ||
      orig.tau !== form.tau
    );
  }, [cfg.data, form]);

  const canSubmit =
    !!parsed &&
    parsed.invalidField === null &&
    isDirty &&
    !update.isPending;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!parsed || parsed.invalidField !== null) return;
    setError(null);
    try {
      const patch: UpdateRatingConfigRequest = {
        initialMu: parsed.values.initialMu,
        initialSigma: parsed.values.initialSigma,
        beta: parsed.values.beta,
        tau: parsed.values.tau,
      };
      const next = await update.mutateAsync(patch);
      setForm(configToForm(next));
      setSavedAt(Date.now());
    } catch (err) {
      const code = getApiErrorCode(err);
      const msg =
        (code && t(`errors.${code}`, { defaultValue: '' })) ||
        getApiErrorMessage(err, t('errors.generic'));
      setError(msg);
    }
  };

  // Hide the "saved" banner after a few seconds.
  useEffect(() => {
    if (savedAt === null) return;
    const id = setTimeout(() => setSavedAt(null), 2500);
    return () => clearTimeout(id);
  }, [savedAt]);

  if (cfg.isPending) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="text-accent" />
      </div>
    );
  }

  if (cfg.isError) {
    return (
      <Alert variant="error">
        {getApiErrorMessage(cfg.error, t('errors.generic'))}
      </Alert>
    );
  }

  if (!form) {
    // Loaded but seeding effect hasn't run yet — render a placeholder.
    return (
      <div className="flex justify-center py-12">
        <Spinner className="text-accent" />
      </div>
    );
  }

  const setField = (key: keyof FormState, value: string) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">{t('admin.ratingConfig.title')}</h1>
        <p className="mt-1 text-sm text-textMuted">
          {t('admin.ratingConfig.subtitle')}
        </p>
      </div>

      <Card>
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          {error ? <Alert variant="error">{error}</Alert> : null}
          {savedAt !== null ? (
            <Alert variant="success">{t('admin.ratingConfig.saved')}</Alert>
          ) : null}

          <NumberField
            label={t('admin.ratingConfig.fields.initialMu.label')}
            tooltip={t('admin.ratingConfig.fields.initialMu.tooltip')}
            value={form.initialMu}
            min={FIELD_LIMITS.initialMu.min}
            max={FIELD_LIMITS.initialMu.max}
            step={FIELD_LIMITS.initialMu.step}
            onChange={(v) => setField('initialMu', v)}
            invalid={parsed?.invalidField === 'initialMu'}
            error={
              parsed?.invalidField === 'initialMu'
                ? t('admin.ratingConfig.invalid', {
                    min: FIELD_LIMITS.initialMu.min,
                    max: FIELD_LIMITS.initialMu.max,
                  })
                : undefined
            }
          />
          <NumberField
            label={t('admin.ratingConfig.fields.initialSigma.label')}
            tooltip={t('admin.ratingConfig.fields.initialSigma.tooltip')}
            value={form.initialSigma}
            min={FIELD_LIMITS.initialSigma.min}
            max={FIELD_LIMITS.initialSigma.max}
            step={FIELD_LIMITS.initialSigma.step}
            onChange={(v) => setField('initialSigma', v)}
            invalid={parsed?.invalidField === 'initialSigma'}
            error={
              parsed?.invalidField === 'initialSigma'
                ? t('admin.ratingConfig.invalid', {
                    min: FIELD_LIMITS.initialSigma.min,
                    max: FIELD_LIMITS.initialSigma.max,
                  })
                : undefined
            }
          />
          <NumberField
            label={t('admin.ratingConfig.fields.beta.label')}
            tooltip={t('admin.ratingConfig.fields.beta.tooltip')}
            value={form.beta}
            min={FIELD_LIMITS.beta.min}
            max={FIELD_LIMITS.beta.max}
            step={FIELD_LIMITS.beta.step}
            onChange={(v) => setField('beta', v)}
            invalid={parsed?.invalidField === 'beta'}
            error={
              parsed?.invalidField === 'beta'
                ? t('admin.ratingConfig.invalid', {
                    min: FIELD_LIMITS.beta.min,
                    max: FIELD_LIMITS.beta.max,
                  })
                : undefined
            }
          />
          <NumberField
            label={t('admin.ratingConfig.fields.tau.label')}
            tooltip={t('admin.ratingConfig.fields.tau.tooltip')}
            value={form.tau}
            min={FIELD_LIMITS.tau.min}
            max={FIELD_LIMITS.tau.max}
            step={FIELD_LIMITS.tau.step}
            onChange={(v) => setField('tau', v)}
            invalid={parsed?.invalidField === 'tau'}
            error={
              parsed?.invalidField === 'tau'
                ? t('admin.ratingConfig.invalid', {
                    min: FIELD_LIMITS.tau.min,
                    max: FIELD_LIMITS.tau.max,
                  })
                : undefined
            }
          />

          <p className="text-xs text-textMuted">
            {t('admin.ratingConfig.drawProbabilityNote')}
          </p>

          <div className="flex items-center justify-end gap-2">
            <Button type="submit" disabled={!canSubmit}>
              {update.isPending
                ? t('admin.ratingConfig.saving')
                : t('admin.ratingConfig.save')}
            </Button>
          </div>
        </form>
      </Card>

      <Alert variant="warning">{t('admin.ratingConfig.warning')}</Alert>
    </div>
  );
}

interface NumberFieldProps {
  label: string;
  tooltip: string;
  value: string;
  onChange: (next: string) => void;
  min: number;
  max: number;
  step: number;
  invalid?: boolean;
  error?: string;
}

function NumberField({
  label,
  tooltip,
  value,
  onChange,
  min,
  max,
  step,
  invalid,
  error,
}: NumberFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <LabelWithTooltip text={label} tooltip={tooltip} />
      <Input
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={min}
        max={max}
        step={step}
        error={invalid ? error : undefined}
        aria-label={label}
      />
    </div>
  );
}

interface LabelWithTooltipProps {
  text: string;
  tooltip: string;
}

/**
 * Accessible inline label that exposes its hint both as a `title` (native
 * tooltip on hover) and as an aria-describable hint after the label. Lucide
 * `Info` icon next to the text signals additional context.
 */
function LabelWithTooltip({ text, tooltip }: LabelWithTooltipProps): ReactNode {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-textMuted">
      <span>{text}</span>
      <span
        title={tooltip}
        aria-label={tooltip}
        className="inline-flex items-center text-textMuted/70 hover:text-accent"
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
    </span>
  );
}
