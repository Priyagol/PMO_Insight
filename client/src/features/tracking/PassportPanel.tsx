import { format } from 'date-fns';
import { WORK_CATEGORY_LABELS } from '@arihant/shared';
import { Skeleton } from '@/components/ui/skeleton';
import { usePassport } from './hooks';

/**
 * Employee Work Passport: operational history (projects, completed work, hours by
 * category). Not a performance score. Hidden when the viewer may not see it.
 */
export function PassportPanel({ userId }: { userId: string }) {
  const passport = usePassport(userId);
  if (passport.isLoading) return <Skeleton className="h-32 w-full" />;
  if (!passport.data) return null; // not permitted (404) or unavailable
  const p = passport.data;
  return (
    <section className="space-y-4">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase">Work passport</h3>
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          ['Hours logged', p.totals.loggedHours],
          ['Tasks completed', p.totals.tasksCompleted],
          ['Projects', p.totals.projects],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-lg border p-2">
            <p className="text-lg font-semibold tabular">{value}</p>
            <p className="text-[11px] text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>
      {p.projects.length ? (
        <ul className="space-y-1 text-sm">
          {p.projects.slice(0, 8).map((r) => (
            <li key={r.project.id} className="flex justify-between gap-2">
              <span className="truncate">
                {r.project.key} · {r.project.name}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular">
                {r.hours} h · {r.tasksCompleted} done
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No logged work or completed tasks yet.</p>
      )}
      {p.hoursByCategory.length ? (
        <p className="text-xs text-muted-foreground">
          {p.hoursByCategory
            .map((c) => `${WORK_CATEGORY_LABELS[c.category]} ${c.hours} h`)
            .join(' · ')}
        </p>
      ) : null}
      {p.recentCompleted.length ? (
        <div>
          <p className="mb-1 text-xs font-medium">Recently completed</p>
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {p.recentCompleted.slice(0, 5).map((t) => (
              <li key={t.id}>
                <span className="font-mono">{t.key}</span> {t.title}{' '}
                {t.completedAt ? `· ${format(new Date(t.completedAt), 'd MMM')}` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
