import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchRatingConfig,
  updateRatingConfig,
} from './ratingConfigApi';
import type { UpdateRatingConfigRequest } from '@durak/shared-types';

export const RATING_CONFIG_QUERY_KEY = 'admin-rating-config' as const;

export function useRatingConfig() {
  return useQuery({
    queryKey: [RATING_CONFIG_QUERY_KEY],
    queryFn: fetchRatingConfig,
    staleTime: 30_000,
  });
}

export function useUpdateRatingConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateRatingConfigRequest) => updateRatingConfig(body),
    onSuccess: (data) => {
      qc.setQueryData([RATING_CONFIG_QUERY_KEY], data);
    },
  });
}
