import { ChangeEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, Upload } from 'lucide-react';
import { Alert, Button } from '@/components/ui';
import { Avatar } from './Avatar';

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

interface AvatarUploaderProps {
  value: string | null;
  nickname: string;
  onUpload: (file: File) => Promise<void> | void;
  onDelete: () => Promise<void> | void;
  uploading?: boolean;
  deleting?: boolean;
  /** Optional server-side error string to surface above the controls. */
  error?: string | null;
}

/**
 * Square avatar preview + upload / delete controls. Performs cheap client-side
 * validation (size, mime) so the user gets immediate feedback before the
 * request goes to the server.
 */
export function AvatarUploader({
  value,
  nickname,
  onUpload,
  onDelete,
  uploading,
  deleting,
  error,
}: AvatarUploaderProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  const pickFile = () => {
    setClientError(null);
    inputRef.current?.click();
  };

  const handleChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Always clear the input so picking the same file again still fires change.
    e.target.value = '';
    if (!file) return;

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setClientError(t('errors.AVATAR_INVALID_TYPE'));
      return;
    }
    if (file.size > MAX_BYTES) {
      setClientError(t('errors.AVATAR_TOO_LARGE'));
      return;
    }
    setClientError(null);
    try {
      await onUpload(file);
    } catch {
      // Parent surfaces the server error via `error` prop; nothing to do here.
    }
  };

  const showError = clientError ?? error ?? null;
  const busy = !!uploading || !!deleting;

  return (
    <div className="flex flex-col gap-3">
      {showError ? <Alert variant="error">{showError}</Alert> : null}
      <div className="flex items-center gap-4">
        <Avatar src={value} nickname={nickname} size={96} />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={pickFile}
            disabled={busy}
          >
            <Upload className="h-4 w-4" />
            {uploading ? t('profile.avatarUploading') : t('profile.avatarUpload')}
          </Button>
          {value ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void onDelete()}
              disabled={busy}
            >
              <Trash2 className="h-4 w-4" />
              {deleting ? t('profile.avatarDeleting') : t('profile.avatarDelete')}
            </Button>
          ) : null}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        className="hidden"
        onChange={(e) => void handleChange(e)}
      />
    </div>
  );
}
