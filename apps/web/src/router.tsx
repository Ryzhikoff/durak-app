import { useEffect } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { LoginPage } from '@/features/auth/LoginPage';
import { ChangePasswordPage } from '@/features/auth/ChangePasswordPage';
import { AdminSetupPage } from '@/features/admin-setup/AdminSetupPage';
import { AdminUsersPage } from '@/features/admin/AdminUsersPage';
import { ProfilePage } from '@/features/profile/ProfilePage';
import { HomePage } from '@/features/home/HomePage';
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
        <Route path="/" element={<HomePage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route
          path="/admin"
          element={
            <ProtectedRoute requireAdmin>
              <AdminUsersPage />
            </ProtectedRoute>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
