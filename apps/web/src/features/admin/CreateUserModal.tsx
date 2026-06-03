import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Input, Modal } from '@/components/ui';
import { useCreateUser } from './hooks';
import { generatePassword, copyToClipboard } from './passwordGen';
import { getApiErrorCode, getApiErrorMessage } from '@/lib/api';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface CreatedInfo {
  login: string;
  password: string;
}

export function CreateUserModal({ open, onClose }: Props) {
  const { t } = useTranslation();
  const create = useCreateUser();

  const [loginValue, setLoginValue] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedInfo | null>(null);
  const [copied, setCopied] = useState(false);

  const reset = () => {
    setLoginValue('');
    setPassword('');
    setNickname('');
    setIsAdmin(false);
    setErrorText(null);
    setCreated(null);
    setCopied(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorText(null);
    try {
      await create.mutateAsync({
        login: loginValue.trim().toLowerCase(),
        password,
        nickname: nickname.trim() || undefined,
        isAdmin,
      });
      setCreated({ login: loginValue.trim().toLowerCase(), password });
    } catch (err) {
      const code = getApiErrorCode(err);
      const msg =
        (code && t(`errors.${code}`, { defaultValue: '' })) ||
        getApiErrorMessage(err, t('errors.generic'));
      setErrorText(msg);
    }
  };

  const onCopy = async () => {
    if (!created) return;
    const text = t('admin.copyCredentials', {
      login: created.login,
      password: created.password,
    });
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (created) {
    return (
      <Modal
        open={open}
        onClose={handleClose}
        title={t('admin.createdModal.title')}
        dismissible={false}
        footer={
          <>
            <Button variant="secondary" onClick={onCopy}>
              {copied ? t('admin.createdModal.copied') : t('admin.createdModal.copy')}
            </Button>
            <Button onClick={handleClose}>{t('admin.createdModal.close')}</Button>
          </>
        }
      >
        <p className="text-sm text-textMuted">{t('admin.createdModal.description')}</p>
        <CredentialRow label={t('admin.createdModal.login')} value={created.login} />
        <CredentialRow label={t('admin.createdModal.password')} value={created.password} />
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t('admin.createModal.title')}
    >
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        {errorText ? <Alert variant="error">{errorText}</Alert> : null}
        <Input
          label={t('admin.createModal.login')}
          value={loginValue}
          onChange={(e) => setLoginValue(e.target.value)}
          autoCapitalize="none"
          spellCheck={false}
          required
          minLength={3}
          maxLength={64}
          disabled={create.isPending}
        />
        <div className="flex items-end gap-2">
          <Input
            label={t('admin.createModal.password')}
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            maxLength={200}
            disabled={create.isPending}
            className="flex-1"
          />
          <Button
            variant="secondary"
            size="md"
            onClick={() => setPassword(generatePassword(14))}
            disabled={create.isPending}
          >
            {t('admin.createModal.generate')}
          </Button>
        </div>
        <Input
          label={t('admin.createModal.nickname')}
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          disabled={create.isPending}
          minLength={2}
          maxLength={24}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-accent"
            checked={isAdmin}
            onChange={(e) => setIsAdmin(e.target.checked)}
            disabled={create.isPending}
          />
          {t('admin.createModal.isAdmin')}
        </label>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button type="button" variant="ghost" onClick={handleClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? t('admin.createModal.submitting') : t('admin.createModal.submit')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CredentialRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surfaceAlt px-3 py-2">
      <div className="text-xs text-textMuted">{label}</div>
      <div className="break-all font-mono text-sm">{value}</div>
    </div>
  );
}
