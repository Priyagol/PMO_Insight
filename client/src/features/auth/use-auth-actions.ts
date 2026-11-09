import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { LoginResponse } from '@arihant/shared';
import { errorMessage } from '@/lib/errors';
import { logout, logoutAll } from '@/services/api/auth';
import { useAppDispatch } from '@/store';
import { sessionEnded, sessionStarted } from '@/store/session-slice';

export function useAuthActions() {
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const startSession = useCallback(
    ({ user, permissions }: LoginResponse) => dispatch(sessionStarted({ user, permissions })),
    [dispatch],
  );

  const end = useCallback(() => {
    queryClient.clear();
    dispatch(sessionEnded({ signedOut: true }));
    navigate('/login', { replace: true });
  }, [dispatch, navigate, queryClient]);

  const signOut = useCallback(async () => {
    try {
      await logout();
    } catch (err) {
      // The local session is cleared regardless; the server token expires on its own.
      toast.error(errorMessage(err));
    }
    end();
  }, [end]);

  const signOutEverywhere = useCallback(async () => {
    try {
      await logoutAll();
      toast.success('Signed out of all devices');
    } catch (err) {
      toast.error(errorMessage(err));
    }
    end();
  }, [end]);

  return { startSession, signOut, signOutEverywhere };
}
