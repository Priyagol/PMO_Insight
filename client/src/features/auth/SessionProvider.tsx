import { useQueryClient } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { restoreSession } from '@/services/api/auth';
import { setSessionExpiredHandler } from '@/services/api/client';
import { useAppDispatch } from '@/store';
import { sessionEnded, sessionStarted } from '@/store/session-slice';

/**
 * Restores the session from the refresh cookie on load, and ends it (clearing all cached
 * server data) whenever the API reports the session can no longer be refreshed.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();

  useEffect(() => {
    setSessionExpiredHandler(() => {
      queryClient.clear();
      dispatch(sessionEnded());
    });
    let cancelled = false;
    restoreSession()
      .then(({ user, permissions }) => {
        if (!cancelled) dispatch(sessionStarted({ user, permissions }));
      })
      .catch(() => {
        if (!cancelled) dispatch(sessionEnded());
      });
    return () => {
      cancelled = true;
      setSessionExpiredHandler(null);
    };
  }, [dispatch, queryClient]);

  return <>{children}</>;
}
