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

export function RolePills({
  roles,
  max = 2,
}: {
  roles: { id: string; name: string }[];
  max?: number;
}) {
  const shown = roles.slice(0, max);
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((r) => (
        <Pill key={r.id} className="bg-accent text-accent-foreground">
          {r.name}
        </Pill>
      ))}
      {roles.length > max ? (
        <Pill className="bg-muted text-muted-foreground">+{roles.length - max}</Pill>
      ) : null}
    </div>
  );
}
