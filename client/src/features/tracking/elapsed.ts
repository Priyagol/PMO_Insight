import { useEffect, useRef, useState } from 'react';
import type { TimerDto } from '@arihant/shared';

/**
 * Elapsed milliseconds for a timer, ticking every second while it runs. Client/server clock
 * skew (from `serverNow`) is applied so the display matches what the server will record.
 */
export function useElapsed(timer: TimerDto | null | undefined): number {
  const skew = useRef(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (timer) skew.current = new Date(timer.serverNow).getTime() - Date.now();
  }, [timer]);

  useEffect(() => {
    if (!timer?.running) return;
    const tick = () => setNow(Date.now() + skew.current);
    const id = setInterval(tick, 1000);
    const first = setTimeout(tick, 0);
    return () => {
      clearInterval(id);
      clearTimeout(first);
    };
  }, [timer?.running]);

  if (!timer) return 0;
  const running = timer.running ? Math.max(now - new Date(timer.startedAt).getTime(), 0) : 0;
  return timer.accumulatedMs + running;
}

export function formatClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
