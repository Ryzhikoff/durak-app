import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Input } from '@/components/ui';
import { useChangePassword } from './hooks';
import { useAuthStore } from '@/stores/auth.store';
import { getApiErrorCode, getApiErrorMessage } from '@/lib/api';

export function ChangePasswordPage() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const change = useChangePassword();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const forced = user?.mustChangePassword ?? false;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorText(null);
    setFieldError(null);

    if (newPassword.length < 6) {
      setFieldError(t('changePassword.tooShort'));
      return;
    }
    if (newPassword !== confirm) {
      setFieldError(t('changePassword.mismatch'));
      return;
    }

    try {
      await change.mutateAsync({ currentPassword, newPassword });
      navigate('/', { replace: true });
    } catch (err) {
      const code = getApiErrorCode(err);
      const msg =
        (code && t(`errors.${code}`, { defaultValue: '' })) ||
        getApiErrorMessage(err, t('errors.generic'));
      setErrorText(msg);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <h1 className="mb-1 text-2xl font-bold">{t('changePassword.title')}</h1>
        <p className="mb-5 text-sm text-textMuted">
          {forced ? t('changePassword.forcedSubtitle') : t('changePassword.normalSubtitle')}
        </p>

        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          {errorText ? <Alert variant="error">{errorText}</Alert> : null}
          {fieldError ? <Alert variant="warning">{fieldError}</Alert> : null}
          <Input
            label={t('changePassword.currentPassword')}
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            disabled={change.isPending}
          />
          <Input
            label={t('changePassword.newPassword')}
            type="password"
            autoComplete="new-password"
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            disabled={change.isPending}
          />
          <Input
            label={t('changePassword.confirmPassword')}
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={change.isPending}
          />
          <Button type="submit" block disabled={change.isPending}>
            {change.isPending ? t('changePassword.submitting') : t('changePassword.submit')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
