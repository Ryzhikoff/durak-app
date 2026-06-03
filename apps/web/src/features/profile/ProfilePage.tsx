import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Input } from '@/components/ui';
import { useAuthStore } from '@/stores/auth.store';
import { updateMe } from './api';
import { ME_QUERY_KEY } from '@/features/auth/hooks';
import { getApiErrorCode, getApiErrorMessage } from '@/lib/api';

export function ProfilePage() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const qc = useQueryClient();

  const [nickname, setNickname] = useState(user?.nickname ?? '');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (user) setNickname(user.nickname);
  }, [user]);

  const save = useMutation({
    mutationFn: updateMe,
    onSuccess: (u) => {
      qc.setQueryData(ME_QUERY_KEY, u);
      setUser(u);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    },
  });

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorText(null);
    if (!user) return;
    const trimmed = nickname.trim();
    if (trimmed === user.nickname) return;
    try {
      await save.mutateAsync({ nickname: trimmed });
    } catch (err) {
      const code = getApiErrorCode(err);
      const msg =
        (code && t(`errors.${code}`, { defaultValue: '' })) ||
        getApiErrorMessage(err, t('errors.generic'));
      setErrorText(msg);
    }
  };

  if (!user) return null;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-bold">{t('profile.title')}</h1>

      <Card>
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          {errorText ? <Alert variant="error">{errorText}</Alert> : null}
          {savedFlash ? <Alert variant="success">{t('profile.saved')}</Alert> : null}
          <Input
            label={t('profile.nickname')}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            minLength={2}
            maxLength={24}
            disabled={save.isPending}
            required
          />
          <Button
            type="submit"
            disabled={save.isPending || nickname.trim() === user.nickname}
          >
            {save.isPending ? t('profile.saving') : t('profile.save')}
          </Button>
        </form>
      </Card>

      <Card>
        <Link
          to="/change-password"
          className="inline-flex items-center text-accent hover:text-accentHover underline-offset-4 hover:underline"
        >
          {t('profile.changePasswordLink')}
        </Link>
      </Card>
    </div>
  );
}
