import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { changePassword, fetchMe, login, logout } from './api';
import { useAuthStore } from '@/stores/auth.store';

export const ME_QUERY_KEY = ['auth', 'me'] as const;

export function useMe() {
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: fetchMe,
    retry: false,
    staleTime: 30_000,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);
  const setStatus = useAuthStore((s) => s.setStatus);

  return useMutation({
    mutationFn: login,
    onSuccess: (user) => {
      qc.setQueryData(ME_QUERY_KEY, user);
      setUser(user);
      setStatus('authenticated');
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  const reset = useAuthStore((s) => s.reset);
  return useMutation({
    mutationFn: logout,
    // Always force-clear local state — even if the server-side logout fails
    // we want the UI to drop back to anonymous.
    onSettled: () => {
      qc.clear();
      reset();
    },
  });
}

export function useChangePassword() {
  const qc = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);
  return useMutation({
    mutationFn: changePassword,
    onSuccess: (user) => {
      qc.setQueryData(ME_QUERY_KEY, user);
      setUser(user);
    },
  });
}
