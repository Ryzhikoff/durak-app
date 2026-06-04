import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';

interface ActionBarProps {
  /** "Беру" — only the defender during `bout_defense`. */
  showTake: boolean;
  /** "Бито" / "Пусть берёт" — anyone with throw-in rights during settle/take-pending. */
  showPass: boolean;
  /**
   * i18n key for the pass button label. Defaults to `game.actions.pass`
   * ("Бито"); during `bout_take_pending` the parent passes
   * `game.actions.passTake` ("Пусть берёт") instead.
   */
  passLabelKey?: string;
  onTake: () => void;
  onPass: () => void;
  disabled?: boolean;
}

/**
 * Bottom-of-screen actions. Hidden entirely when none apply to the viewer.
 * "Attack" / "Beat" / "Translate" are no longer rendered here — those are
 * triggered by dragging a hand card to the table.
 */
export function ActionBar({
  showTake,
  showPass,
  passLabelKey = 'game.actions.pass',
  onTake,
  onPass,
  disabled,
}: ActionBarProps) {
  const { t } = useTranslation();
  if (!showTake && !showPass) return null;
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
          {t(passLabelKey)}
        </Button>
      ) : null}
    </div>
  );
}
