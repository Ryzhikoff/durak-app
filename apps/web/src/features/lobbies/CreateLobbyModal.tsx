import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import type { LobbySettings } from '@durak/shared-types';
import { Alert, Button, Modal } from '@/components/ui';
import { getDefaultSettings, LobbySettingsEditor } from './LobbySettingsEditor';
import {
  useCreateLobby,
  useLeaveCurrentLobbyRest,
  LOBBY_LIST_KEY,
  LOBBY_ROOM_KEY,
} from './hooks';
import { getApiErrorCode, getApiErrorMessage } from '@/lib/api';
import { AxiosError } from 'axios';

interface CreateLobbyModalProps {
  open: boolean;
  onClose: () => void;
}

interface AlreadyInDetails {
  currentLobbyId: string;
}

export function CreateLobbyModal({ open, onClose }: CreateLobbyModalProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [settings, setSettings] = useState<LobbySettings>(getDefaultSettings());
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [alreadyIn, setAlreadyIn] = useState<AlreadyInDetails | null>(null);
  const create = useCreateLobby();
  const leaveCurrent = useLeaveCurrentLobbyRest();

  const handleSubmit = async () => {
    setErrorMsg(null);
    setAlreadyIn(null);
    try {
      const lobby = await create.mutateAsync(settings);
      qc.setQueryData(LOBBY_ROOM_KEY(lobby.id), lobby);
      onClose();
      navigate(`/lobbies/${lobby.id}`);
    } catch (err) {
      const code = getApiErrorCode(err);
      if (code === 'ALREADY_IN_LOBBY') {
        const ax = err as AxiosError<{ error: { details?: AlreadyInDetails } }>;
        const details = ax.response?.data?.error?.details;
        if (details?.currentLobbyId) {
          setAlreadyIn(details);
          return;
        }
      }
      // Translate the well-known error codes (INVALID_SETTINGS included). For
      // INVALID_SETTINGS the server's English text usually points at the
      // specific offending field, but we surface the localised generic instead
      // so non-EN users aren't shown English; fall back to whatever the server
      // sent if no translation exists.
      setErrorMsg(
        code
          ? t(`errors.${code}`, { defaultValue: getApiErrorMessage(err, t('errors.generic')) })
          : getApiErrorMessage(err, t('errors.generic')),
      );
    }
  };

  const handleGoToCurrent = () => {
    if (!alreadyIn) return;
    onClose();
    navigate(`/lobbies/${alreadyIn.currentLobbyId}`);
  };

  /**
   * "Leave and create new" path: call the REST escape hatch then retry create.
   * Note we re-use the latest settings from local state.
   */
  const handleLeaveAndRetry = async () => {
    setErrorMsg(null);
    try {
      await leaveCurrent.mutateAsync();
      // Public list may have shifted; refresh on next mount.
      qc.invalidateQueries({ queryKey: LOBBY_LIST_KEY });
      setAlreadyIn(null);
      await handleSubmit();
    } catch (err) {
      const code = getApiErrorCode(err);
      setErrorMsg(
        code
          ? t(`errors.${code}`, { defaultValue: getApiErrorMessage(err, t('errors.generic')) })
          : getApiErrorMessage(err, t('errors.generic')),
      );
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('lobbies.createTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={create.isPending}
          >
            {create.isPending ? t('lobbies.creating') : t('lobbies.create')}
          </Button>
        </>
      }
    >
      {alreadyIn ? (
        <Alert variant="warning" title={t('errors.ALREADY_IN_LOBBY')}>
          <p className="mb-2">{t('lobbies.alreadyInBody')}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={handleGoToCurrent}>
              {t('lobbies.goToCurrent')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleLeaveAndRetry}
              disabled={leaveCurrent.isPending || create.isPending}
            >
              {leaveCurrent.isPending
                ? t('lobbies.leavingAndCreating')
                : t('lobbies.leaveAndCreate')}
            </Button>
          </div>
        </Alert>
      ) : null}
      {errorMsg ? <Alert variant="error">{errorMsg}</Alert> : null}
      <LobbySettingsEditor
        value={settings}
        onChange={setSettings}
        disabled={create.isPending}
      />
    </Modal>
  );
}
