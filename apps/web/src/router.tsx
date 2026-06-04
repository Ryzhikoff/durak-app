import { useEffect } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { LoginPage } from '@/features/auth/LoginPage';
import { ChangePasswordPage } from '@/features/auth/ChangePasswordPage';
import { AdminSetupPage } from '@/features/admin-setup/AdminSetupPage';
import { AdminUsersPage } from '@/features/admin/AdminUsersPage';
import { AdminRatingConfigPage } from '@/features/admin/AdminRatingConfigPage';
import { ProfilePage } from '@/features/profile/ProfilePage';
import { RatingPage } from '@/features/rating/RatingPage';
import { GamePage } from '@/features/games/GamePage';
import { LobbyRoomPage } from '@/features/lobbies/LobbyRoomPage';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { AppShell } from '@/components/layout/AppShell';
import { registerUnauthorizedHandler } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';
import { queryClient } from '@/lib/queryClient';

export function AppRouter() {
  const navigate = useNavigate();
  const reset = useAuthStore((s) => s.reset);

  // Wire 401 interceptor -> reset state + redirect to /login.
  useEffect(() => {
    registerUnauthorizedHandler(() => {
      reset();
      queryClient.clear();
      navigate('/login', { replace: true });
    });
  }, [navigate, reset]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/admin/setup" element={<AdminSetupPage />} />

      <Route
        path="/change-password"
        element={
          <ProtectedRoute>
            <ChangePasswordPage />
          </ProtectedRoute>
        }
      />

      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<RatingPage />} />
        <Route path="/u/:id" element={<ProfilePage />} />
        <Route path="/profile" element={<MyProfileRedirect />} />
        <Route path="/games/:id" element={<GamePage />} />
        <Route path="/lobbies/:id" element={<LobbyRoomPage />} />
        <Route
          path="/admin"
          element={
            <ProtectedRoute requireAdmin>
              <AdminUsersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/rating-config"
          element={
            <ProtectedRoute requireAdmin>
              <AdminRatingConfigPage />
            </ProtectedRoute>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/**
 * Compatibility redirect: legacy `/profile` route now points to the public
 * profile of the current user.
 */
function MyProfileRedirect() {
  const me = useAuthStore((s) => s.user);
  if (!me) return <Navigate to="/login" replace />;
  return <Navigate to={`/u/${me.id}`} replace />;
}
