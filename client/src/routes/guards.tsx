import type { ReactNode } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router';
import { safeNext } from '@/lib/redirect';
import { useAppSelector } from '@/store';

function FullScreenLoader() {
  return (
    <div className="flex h-dvh items-center justify-center" role="status" aria-label="Loading">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        Loading Arihant Workspace…
      </div>
    </div>
  );
}

/** Protected area: waits for session restore, then requires a signed-in user. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAppSelector((s) => s.session.status);
  const signedOut = useAppSelector((s) => s.session.signedOut);
  const location = useLocation();
  if (status === 'restoring') return <FullScreenLoader />;
  if (status === 'anonymous') {
    // After a deliberate sign-out, never carry the old page over to the next person.
    if (signedOut) return <Navigate to="/login" replace />;
    const next = `${location.pathname}${location.search}`;
    return (
      <Navigate to={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`} replace />
    );
  }
  return <>{children}</>;
}

/** Sign-in pages: signed-in users continue to the requested page (or the app home). */
export function PublicOnly({ children }: { children: ReactNode }) {
  const status = useAppSelector((s) => s.session.status);
  const [params] = useSearchParams();
  if (status === 'restoring') return <FullScreenLoader />;
  if (status === 'authenticated') return <Navigate to={safeNext(params.get('next'))} replace />;
  return <>{children}</>;
}
