import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui';
import { useAuthStore } from '@/stores/auth.store';

export function HomePage() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{t('home.title')}</h1>
      {user ? (
        <p className="text-textMuted">{t('home.greeting', { nickname: user.nickname })}</p>
      ) : null}
      <Card>
        <p className="text-sm text-textMuted">{t('home.phaseStub')}</p>
      </Card>
    </div>
  );
}
