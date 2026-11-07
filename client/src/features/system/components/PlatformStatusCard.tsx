import { RefreshCw } from 'lucide-react';
import { ErrorState } from '@/components/common/ErrorState';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useReadiness } from '../hooks/use-readiness';

const DEPENDENCY_LABELS: Record<string, string> = {
  mongo: 'Database (MongoDB)',
  redis: 'Queue & cache (Redis)',
  storage: 'File storage (S3)',
};

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${seconds % 60}s`;
}

/** Live readiness of the platform's backing services, read from GET /api/v1/ready. */
export function PlatformStatusCard() {
  const { data, error, isLoading, refetch, isFetching } = useReadiness();

  return (
    <section
      className="rounded-xl border bg-card shadow-xs"
      aria-labelledby="platform-status-title"
    >
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 id="platform-status-title" className="text-sm font-semibold">
            Platform status
          </h2>
          <p className="text-xs text-muted-foreground">
            Live check of the services Arihant Workspace depends on
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void refetch()}
          disabled={isFetching}
          aria-label="Refresh platform status"
        >
          <RefreshCw className={cn(isFetching && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {error ? (
        <ErrorState title="API unreachable" error={error} onRetry={() => void refetch()} />
      ) : (
        <div className="p-4">
          <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Overall</span>
              {isLoading || !data ? (
                <Skeleton className="h-5 w-20" />
              ) : (
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-xs font-medium',
                    data.status === 'ok'
                      ? 'bg-success/10 text-success'
                      : 'bg-warning/10 text-warning',
                  )}
                >
                  {data.status === 'ok' ? 'Operational' : 'Degraded'}
                </span>
              )}
            </div>
            {data ? (
              <>
                <span className="text-muted-foreground">
                  API version <span className="font-mono text-foreground">{data.version}</span>
                </span>
                <span className="text-muted-foreground">
                  Uptime{' '}
                  <span className="tabular text-foreground">
                    {formatUptime(data.uptimeSeconds)}
                  </span>
                </span>
              </>
            ) : null}
          </div>

          <ul className="grid gap-2 sm:grid-cols-3">
            {isLoading || !data?.checks
              ? Array.from({ length: 3 }, (_, i) => (
                  <Skeleton key={i} className="h-16 rounded-lg" />
                ))
              : Object.entries(data.checks).map(([name, check]) => (
                  <li key={name} className="rounded-lg border p-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'size-2 rounded-full',
                          check.ok ? 'bg-success' : 'bg-destructive',
                        )}
                        aria-hidden
                      />
                      <span className="text-sm font-medium">{DEPENDENCY_LABELS[name] ?? name}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {check.ok
                        ? `Responding in ${check.latencyMs ?? 0} ms`
                        : (check.error ?? 'Unavailable')}
                    </p>
                  </li>
                ))}
          </ul>
        </div>
      )}
    </section>
  );
}
