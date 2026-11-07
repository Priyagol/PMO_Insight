import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toast } from 'sonner';
import type { NotificationDto } from '@arihant/shared';
import { tokenStore } from '@/services/api/client';
import { useAppSelector } from '@/store';
import { collabKeys } from './hooks';

/**
 * Live updates over Socket.IO (proxied at /socket.io). The client library is loaded on
 * demand so it does not weigh down the first page load. The handshake reads the in-memory
 * access token each time it (re)connects, so token refreshes are picked up. If the socket
 * cannot connect, the notification count still refreshes by polling.
 */
export function RealtimeProvider() {
  const qc = useQueryClient();
  const userId = useAppSelector((s) => s.session.user?.id);

  useEffect(() => {
    if (!userId || import.meta.env.MODE === 'test') return;
    let disposed = false;
    let disconnect: (() => void) | undefined;
    void import('socket.io-client').then(({ io }) => {
      if (disposed) return;
      const socket = io({
        path: '/socket.io',
        transports: ['websocket'],
        auth: (cb) => cb({ token: tokenStore.get() }),
      });
      socket.on('notification', (n: NotificationDto) => {
        void qc.invalidateQueries({ queryKey: collabKeys.notifications });
        toast(n.title, { description: n.body });
      });
      disconnect = () => socket.disconnect();
    });
    return () => {
      disposed = true;
      disconnect?.();
    };
  }, [userId, qc]);

  return null;
}
