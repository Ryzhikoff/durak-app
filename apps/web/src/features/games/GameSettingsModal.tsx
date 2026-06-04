/**
 * Read-only view of the active game's `LobbySettings`. Opened from the in-game
 * "Правила" chip so players can re-check the house rules mid-match without
 * leaving the table. Mirrors the editor's value mapping (see
 * `LobbySettingsEditor`) but renders plain labels — no inputs.
 */
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { LobbySettings } from '@durak/shared-types';
import { Modal } from '@/components/ui';

interface GameSettingsModalProps {
  open: boolean;
  onClose: () => void;
  settings: LobbySettings;
  playerCount: number;
}

export function GameSettingsModal({
  open,
  onClose,
  settings,
  playerCount,
}: GameSettingsModalProps) {
  const { t } = useTranslation();
  const rows = buildRows(settings, playerCount, t);
  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible
      title={t('game.settings.title')}
    >
      <dl
        className="flex flex-col divide-y divide-border"
        data-testid="game-settings-modal-rows"
      >
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-start justify-between gap-3 py-2 text-sm"
          >
            <dt className="text-textMuted">{row.label}</dt>
            <dd className="max-w-[55%] text-right font-medium">{row.value}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}

interface Row {
  label: string;
  value: string;
}

function buildRows(
  settings: LobbySettings,
  playerCount: number,
  t: TFunction,
): Row[] {
  const rows: Row[] = [];

  rows.push({
    label: t('game.settings.players'),
    value: t('game.settings.playersValue', {
      current: playerCount,
      max: settings.maxPlayers,
    }),
  });

  rows.push({
    label: t('game.settings.deck'),
    value: t('game.settings.deckValue', {
      size: settings.deckSize,
      jokers: settings.jokers
        ? t('game.settings.jokersOn')
        : t('game.settings.jokersOff'),
    }),
  });

  rows.push({
    label: t('lobbySettings.firstBoutLimit.label'),
    value:
      settings.firstBoutLimit === 5
        ? t('lobbySettings.firstBoutLimit.five')
        : settings.firstBoutLimit === 6
          ? t('lobbySettings.firstBoutLimit.six')
          : t('lobbySettings.firstBoutLimit.defenderHand'),
  });

  rows.push({
    label: t('lobbySettings.attackerScope.label'),
    value:
      settings.attackerScope === 'all'
        ? t('lobbySettings.attackerScope.all')
        : t('lobbySettings.attackerScope.attackerOnly'),
  });

  rows.push({
    label: t('lobbySettings.cheating.label'),
    value: settings.cheatingEnabled
      ? t('game.settings.on')
      : t('game.settings.off'),
  });

  if (settings.cheatingEnabled) {
    rows.push({
      label: t('lobbySettings.cheatAttempts'),
      value: String(settings.cheatAttempts),
    });
    rows.push({
      label: t('lobbySettings.cheatNoticeScope.label'),
      value:
        settings.cheatNoticeScope === 'defender_only'
          ? t('lobbySettings.cheatNoticeScope.defenderOnly')
          : t('lobbySettings.cheatNoticeScope.all'),
    });
  }

  rows.push({
    label: t('lobbySettings.layoutOnRepeat.label'),
    value:
      settings.layoutOnRepeat === 'random'
        ? t('lobbySettings.layoutOnRepeat.random')
        : t('lobbySettings.layoutOnRepeat.preserve'),
  });

  rows.push({
    label: t('lobbySettings.firstTurn.label'),
    value:
      settings.firstTurn === 'lowest_trump'
        ? t('lobbySettings.firstTurn.lowestTrump')
        : settings.firstTurn === 'random'
          ? t('lobbySettings.firstTurn.random')
          : t('lobbySettings.firstTurn.previousLoser'),
  });

  rows.push({
    label: t('lobbySettings.turnTimer.label'),
    value:
      settings.turnTimer === null
        ? t('lobbySettings.turnTimer.off')
        : t('lobbySettings.turnTimer.seconds', { count: settings.turnTimer }),
  });

  return rows;
}
