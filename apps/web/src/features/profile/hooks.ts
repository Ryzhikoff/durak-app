import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  deleteAvatar,
  deleteCardBack,
  fetchPublicProfile,
  updateMe,
  uploadAvatar,
  uploadCardBack,
} from './api';
import { useAuthStore } from '@/stores/auth.store';
import { ME_QUERY_KEY } from '@/features/auth/hooks';
import type { User } from '@durak/shared-types';

export const PROFILE_QUERY_KEY = 'public-profile' as const;

export function usePublicProfile(id: string | undefined) {
  return useQuery({
    queryKey: [PROFILE_QUERY_KEY, id],
    queryFn: () => fetchPublicProfile(id as string),
    enabled: !!id,
    retry: false,
  });
}

function useApplyUser() {
  const qc = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);
  return (user: User) => {
    qc.setQueryData(ME_QUERY_KEY, user);
    setUser(user);
    qc.invalidateQueries({ queryKey: [PROFILE_QUERY_KEY, user.id] });
  };
}

export function useUpdateMe() {
  const apply = useApplyUser();
  return useMutation({
    mutationFn: updateMe,
    onSuccess: apply,
  });
}

export function useUploadAvatar() {
  const apply = useApplyUser();
  return useMutation({
    mutationFn: uploadAvatar,
    onSuccess: apply,
  });
}

export function useDeleteAvatar() {
  const apply = useApplyUser();
  return useMutation({
    mutationFn: deleteAvatar,
    onSuccess: apply,
  });
}

export function useUploadCardBack() {
  const apply = useApplyUser();
  return useMutation({
    mutationFn: uploadCardBack,
    onSuccess: apply,
  });
}

export function useDeleteCardBack() {
  const apply = useApplyUser();
  return useMutation({
    mutationFn: deleteCardBack,
    onSuccess: apply,
  });
}
