import type { EmploymentStatus } from '@arihant/shared';
import { cn } from '@/lib/utils';

const STATUS: Record<EmploymentStatus, { label: string; tone: string }> = {
  active: { label: 'Active', tone: 'bg-success/10 text-success' },
  inactive: { label: 'Inactive', tone: 'bg-warning/10 text-warning' },
  terminated: { label: 'Terminated', tone: 'bg-muted text-muted-foreground' },
};

export function EmploymentBadge({
  status,
  invitePending,
}: {
  status: EmploymentStatus;
  invitePending?: boolean;
}) {
  if (status === 'active' && invitePending) {
    return <Pill className="bg-info/10 text-info">Invite pending</Pill>;
  }
  return <Pill className={STATUS[status].tone}>{STATUS[status].label}</Pill>;
}

export function Pill({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * A colour per built-in role so admins and managers stand out in lists. The role name is
 * always shown too, so colour is never the only cue. Custom roles use the neutral style.
 */
const ROLE_TONE: Record<string, string> = {
  super_admin: 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200',
  director: 'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200',
  department_head: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-200',
  project_manager: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-200',
  team_lead: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-200',
  developer: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200',
  qa_tester: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
  employee: 'bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-200',
  external_stakeholder: 'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-200',
};
const roleTone = (key?: string) =>
  (key && ROLE_TONE[key]) || 'bg-accent text-accent-foreground';

export function RolePill({ role }: { role: { key?: string; name: string } }) {
  return <Pill className={roleTone(role.key)}>{role.name}</Pill>;
}

export function RolePills({
  roles,
  max = 2,
}: {
  roles: { id: string; key?: string; name: string }[];
  max?: number;
}) {
  const shown = roles.slice(0, max);
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((r) => (
        <RolePill key={r.id} role={r} />
      ))}
      {roles.length > max ? (
        <Pill className="bg-muted text-muted-foreground">+{roles.length - max}</Pill>
      ) : null}
    </div>
  );
}
