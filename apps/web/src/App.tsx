import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AppRouter } from './router';
import { useMe } from './features/auth/hooks';
import { useAuthStore } from './stores/auth.store';

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
