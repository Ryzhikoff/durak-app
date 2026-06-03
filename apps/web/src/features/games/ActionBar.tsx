import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';

interface ActionBarProps {
  /** "Беру" — only the defender during `bout_defense`. */
  showTake: boolean;
  /** "Бито" — anyone with throw-in rights during `bout_settle`/`bout_defense`. */
  showPass: boolean;
  onTake: () => void;
  onPass: () => void;
  disabled?: boolean;
  /** Optional hint shown next to the buttons (eg. "ждём защитника"). */
  hint?: string | null;
}

/** Bottom-of-screen actions. Hidden entirely when none apply to the viewer. */
export function ActionBar({
  showTake,
  showPass,
  onTake,
  onPass,
  disabled,
  hint,
}: ActionBarProps) {
  const { t } = useTranslation();
  if (!showTake && !showPass && !hint) return null;
  return (
    <div className="flex w-full flex-wrap items-center justify-center gap-2">
      {showTake ? (
        <Button variant="danger" size="sm" onClick={onTake} disabled={disabled}>
          {t('game.actions.take')}
        </Button>
      ) : null}
      {showPass ? (
        <Button
          variant="primary"
          size="sm"
          onClick={onPass}
          disabled={disabled}
        >
          {t('game.actions.pass')}
        </Button>
      ) : null}
      {hint ? <span className="text-xs text-textMuted">{hint}</span> : null}
    </div>
  );
}
