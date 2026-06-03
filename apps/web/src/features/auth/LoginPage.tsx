import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Input } from '@/components/ui';
import { useLogin, useMe } from './hooks';
import { useAuthStore } from '@/stores/auth.store';
import { getApiErrorCode, getApiErrorMessage } from '@/lib/api';

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const login = useLogin();
  const me = useMe();
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);

  const [loginValue, setLoginValue] = useState('');
  const [password, setPassword] = useState('');
  const [errorText, setErrorText] = useState<string | null>(null);

  // If already authenticated, send them home (or change-password).
  useEffect(() => {
    if (status === 'authenticated' && user) {
      navigate(user.mustChangePassword ? '/change-password' : '/', { replace: true });
    }
  }, [status, user, navigate]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorText(null);
    try {
      const u = await login.mutateAsync({
        login: loginValue.trim().toLowerCase(),
        password,
      });
      if (u.mustChangePassword) {
        navigate('/change-password', { replace: true });
      } else {
        navigate('/', { replace: true });
      }
    } catch (err) {
      const code = getApiErrorCode(err);
      const msg =
        (code && t(`errors.${code}`, { defaultValue: '' })) ||
        getApiErrorMessage(err, t('errors.generic'));
      setErrorText(msg);
    }
  };

  if (me.isPending) {
    return null;
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <h1 className="mb-1 text-2xl font-bold">{t('auth.loginTitle')}</h1>
        <p className="mb-5 text-sm text-textMuted">{t('auth.loginSubtitle')}</p>

        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          {errorText ? <Alert variant="error">{errorText}</Alert> : null}
          <Input
            label={t('auth.loginField')}
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={loginValue}
            onChange={(e) => setLoginValue(e.target.value)}
            disabled={login.isPending}
          />
          <Input
            label={t('auth.passwordField')}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={login.isPending}
          />
          <Button type="submit" block disabled={login.isPending}>
            {login.isPending ? t('auth.loggingIn') : t('auth.loginButton')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
