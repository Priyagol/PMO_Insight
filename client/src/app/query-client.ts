import { QueryClient } from '@tanstack/react-query';
import { ApiClientError } from '@/services/api/client';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        // Retry transient failures only; 4xx responses will not succeed on retry.
        retry: (failureCount, error) => {
          if (error instanceof ApiClientError && error.status >= 400 && error.status < 500)
            return false;
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}
