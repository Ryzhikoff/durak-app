import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppRouter } from './router';
import { useMe } from './features/auth/hooks';
import { useAuthStore } from './stores/auth.store';
import { onLobbySocketAuthError } from './lib/socket';

/**
 * Top-level component: bootstraps auth status and forces password change
 * navigation when the user has `mustChangePassword=true`.
 */
export default function App() {
  const meQuery = useMe();
  const setUser = useAuthStore((s) => s.setUser);
  const setStatus = useAuthStore((s) => s.setStatus);
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const reset = useAuthStore((s) => s.reset);

  // Sync TanStack Query state into Zustand store (single source of truth for UI).
  // Only set if the target value actually differs to avoid noisy renders.
  useEffect(() => {
    if (meQuery.isPending) {
      if (status !== 'loading') setStatus('loading');
      return;
    }
    if (meQuery.isError) {
      if (user !== null) setUser(null);
      if (status !== 'anonymous') setStatus('anonymous');
      return;
    }
    if (meQuery.data) {
      if (user !== meQuery.data) setUser(meQuery.data);
      if (status !== 'authenticated') setStatus('authenticated');
    }
  }, [
    meQuery.isPending,
    meQuery.isError,
    meQuery.data,
    status,
    user,
    setUser,
    setStatus,
  ]);

  // WS auth failures: drop the user to /login with a session-expired toast.
  // We use the browser-native alert as a no-deps fallback; the project does
  // not ship a global toast container yet, so this stays minimal.
  useEffect(() => {
    return onLobbySocketAuthError(() => {
      reset();
      const text = t('lobbies.sessionExpiredToast');
      // Best-effort visible signal; avoid blocking the redirect.
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        // Defer alert so React can complete the navigation paint first.
        setTimeout(() => window.alert(text), 0);
      }
      if (location.pathname !== '/login') {
        navigate('/login', { replace: true });
      }
    });
  }, [navigate, location.pathname, reset, t]);

  // Force password change page when mustChangePassword=true.
  useEffect(() => {
    if (
      user?.mustChangePassword &&
      location.pathname !== '/change-password'
    ) {
      navigate('/change-password', { replace: true });
    }
  }, [user, location.pathname, navigate]);

  return <AppRouter />;
}
