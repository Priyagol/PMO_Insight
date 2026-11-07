import { useQuery } from '@tanstack/react-query';
import { fetchReadiness } from '@/services/api/system';

export const systemKeys = {
  readiness: ['system', 'readiness'] as const,
};

export function useReadiness() {
  return useQuery({
    queryKey: systemKeys.readiness,
    queryFn: fetchReadiness,
    refetchInterval: 30_000,
  });
}
