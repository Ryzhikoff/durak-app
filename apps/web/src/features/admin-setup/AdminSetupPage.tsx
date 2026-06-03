import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Input, Spinner } from '@/components/ui';
import { createFirstAdmin, fetchSetupStatus } from './api';
import { useAuthStore } from '@/stores/auth.store';
import { getApiErrorCode, getApiErrorMessage } from '@/lib/api';
import { ME_QUERY_KEY } from '@/features/auth/hooks';

export function AdminSetupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);
  const setStatus = useAuthStore((s) => s.setStatus);

  const statusQuery = useQuery({
    queryKey: ['admin', 'setup', 'status'],
    queryFn: fetchSetupStatus,
    retry: false,
  });

  const mutate = useMutation({
    mutationFn: createFirstAdmin,
    onSuccess: (user) => {
      qc.setQueryData(ME_QUERY_KEY, user);
      setUser(user);
      setStatus('authenticated');
    },
  });

  const [loginValue, setLoginValue] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    if (statusQuery.data && !statusQuery.data.available) {
      navigate('/login', { replace: true });
    }
  }, [statusQuery.data, navigate]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorText(null);
    try {
      await mutate.mutateAsync({
        login: loginValue.trim().toLowerCase(),
        password,
        nickname: nickname.trim() || undefined,
      });
      navigate('/admin', { replace: true });
    } catch (err) {
      const code = getApiErrorCode(err);
      const msg =
        (code && t(`errors.${code}`, { defaultValue: '' })) ||
        getApiErrorMessage(err, t('errors.generic'));
      setErrorText(msg);
    }
  };

  if (statusQuery.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="text-accent" />
      </div>
    );
  }

  if (statusQuery.isError || statusQuery.data?.available === false) {
    return null;
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <Card className="w-full max-w-md">
        <h1 className="mb-1 text-2xl font-bold">{t('adminSetup.title')}</h1>
        <p className="mb-5 text-sm text-textMuted">{t('adminSetup.subtitle')}</p>

        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          {errorText ? <Alert variant="error">{errorText}</Alert> : null}
          <Input
            label={t('adminSetup.loginField')}
            value={loginValue}
            onChange={(e) => setLoginValue(e.target.value)}
            autoCapitalize="none"
            spellCheck={false}
            required
            disabled={mutate.isPending}
            help={t('adminSetup.loginHelp')}
          />
          <Input
            label={t('adminSetup.passwordField')}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={mutate.isPending}
          />
          <Input
            label={t('adminSetup.nicknameField')}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            disabled={mutate.isPending}
          />
          <Button type="submit" block disabled={mutate.isPending}>
            {mutate.isPending ? t('adminSetup.submitting') : t('adminSetup.submit')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
