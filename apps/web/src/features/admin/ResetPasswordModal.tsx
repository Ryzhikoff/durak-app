import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Input, Modal } from '@/components/ui';
import { useResetUserPassword } from './hooks';
import { generatePassword, copyToClipboard } from './passwordGen';
import { getApiErrorCode, getApiErrorMessage } from '@/lib/api';

interface Props {
  open: boolean;
  onClose: () => void;
  userId: string;
  userLogin: string;
}

export function ResetPasswordModal({ open, onClose, userId, userLogin }: Props) {
  const { t } = useTranslation();
  const reset = useResetUserPassword();
  const [password, setPassword] = useState('');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setPassword('');
      setErrorText(null);
      setDone(false);
      setCopied(false);
    }
  }, [open]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorText(null);
    try {
      await reset.mutateAsync({ id: userId, body: { newPassword: password } });
      setDone(true);
    } catch (err) {
      const code = getApiErrorCode(err);
      const msg =
        (code && t(`errors.${code}`, { defaultValue: '' })) ||
        getApiErrorMessage(err, t('errors.generic'));
      setErrorText(msg);
    }
  };

  const onCopy = async () => {
    const text = t('admin.copyCredentials', { login: userLogin, password });
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (done) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title={t('admin.resetModal.successTitle')}
        dismissible={false}
        footer={
          <>
            <Button variant="secondary" onClick={onCopy}>
              {copied ? t('admin.createdModal.copied') : t('admin.createdModal.copy')}
            </Button>
            <Button onClick={onClose}>{t('admin.createdModal.close')}</Button>
          </>
        }
      >
        <p className="text-sm text-textMuted">{t('admin.resetModal.successDescription')}</p>
        <div className="rounded-xl border border-border bg-surfaceAlt px-3 py-2">
          <div className="text-xs text-textMuted">{t('admin.createdModal.login')}</div>
          <div className="break-all font-mono text-sm">{userLogin}</div>
        </div>
        <div className="rounded-xl border border-border bg-surfaceAlt px-3 py-2">
          <div className="text-xs text-textMuted">{t('admin.createdModal.password')}</div>
          <div className="break-all font-mono text-sm">{password}</div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={t('admin.resetModal.title')}>
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        {errorText ? <Alert variant="error">{errorText}</Alert> : null}
        <p className="text-sm text-textMuted">{t('admin.resetModal.description')}</p>
        <div className="flex items-end gap-2">
          <Input
            label={t('admin.resetModal.newPassword')}
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            maxLength={200}
            disabled={reset.isPending}
            className="flex-1"
          />
          <Button
            variant="secondary"
            onClick={() => setPassword(generatePassword(14))}
            disabled={reset.isPending}
          >
            {t('admin.createModal.generate')}
          </Button>
        </div>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={reset.isPending || password.length < 6}>
            {reset.isPending ? t('admin.resetModal.submitting') : t('admin.resetModal.submit')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
