import { format } from 'date-fns';
import { KeyRound, Mail, Pencil, ShieldOff, UserCheck, UserX } from 'lucide-react';
import { toast } from 'sonner';
import { resetUserMfa } from '@/services/api/security';
import { useState } from 'react';
import type { EmploymentStatus } from '@arihant/shared';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { ErrorState } from '@/components/common/ErrorState';
import { UserAvatar } from '@/components/common/UserAvatar';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan } from '@/hooks/use-permission';
import * as org from '@/services/api/org';
import { useAppSelector } from '@/store';
import { EmploymentBadge, Pill } from '../components/Badges';
import { useOrgMutation, useUser } from '../hooks';
import { PassportPanel } from '@/features/tracking/PassportPanel';
import { EmployeeFormDialog } from './EmployeeFormDialog';

const LEVELS = ['', 'Beginner', 'Basic', 'Proficient', 'Advanced', 'Expert'];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

export function EmployeeDrawer({
  userId,
  onClose,
}: {
  userId: string | null;
  onClose: () => void;
}) {
  const { data: user, isLoading, error, refetch } = useUser(userId);
  const canManage = useCan('user:manage', 'org');
  const meId = useAppSelector((s) => s.session.user?.id);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<EmploymentStatus | null>(null);
  const [resettingMfa, setResettingMfa] = useState(false);

  const setStatus = useOrgMutation((s: EmploymentStatus) => org.setUserStatus(userId!, s), {
    success: (u) => `${u.name} is now ${u.status}`,
  });
  const invite = useOrgMutation(() => org.resendInvite(userId!), {
    success: (r) =>
      r.sent ? 'Activation e-mail sent' : 'The e-mail could not be queued; try again later',
    invalidate: [],
  });
  const reset = useOrgMutation(() => org.sendPasswordReset(userId!), {
    success: (r) =>
      r.sent ? 'Password reset e-mail sent' : 'The e-mail could not be queued; try again later',
    invalidate: [],
  });

  return (
    <Sheet open={Boolean(userId)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : isLoading || !user ? (
          <div className="space-y-4 p-6">
            <SheetTitle className="sr-only">Loading employee</SheetTitle>
            <Skeleton className="h-12 w-2/3" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <>
            <SheetHeader className="border-b">
              <div className="flex items-center gap-3">
                <UserAvatar name={user.name} size="lg" />
                <div className="min-w-0">
                  <SheetTitle className="truncate">{user.name}</SheetTitle>
                  <SheetDescription className="truncate">
                    {user.designation ?? 'No designation'} ·{' '}
                    <span className="font-mono">{user.employeeId}</span>
                  </SheetDescription>
                </div>
              </div>
              <div className="pt-1">
                <EmploymentBadge status={user.status} invitePending={!user.hasPassword} />
              </div>
            </SheetHeader>

            <div className="space-y-5 px-4 pb-6">
              {canManage ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                    <Pencil /> Edit
                  </Button>
                  {user.status === 'active' && !user.hasPassword ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={invite.isPending}
                      onClick={() => invite.mutate(undefined)}
                    >
                      <Mail /> Resend invite
                    </Button>
                  ) : null}
                  {user.status === 'active' && user.hasPassword ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={reset.isPending}
                      onClick={() => reset.mutate(undefined)}
                    >
                      <KeyRound /> Send password reset
                    </Button>
                  ) : null}
                  {user.id !== meId && user.status === 'active' ? (
                    <Button size="sm" variant="outline" onClick={() => setResettingMfa(true)}>
                      <ShieldOff /> Reset two-step verification
                    </Button>
                  ) : null}
                  {user.id !== meId ? (
                    user.status === 'active' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive"
                        onClick={() => setConfirm('inactive')}
                      >
                        <UserX /> Deactivate
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setConfirm('active')}>
                        <UserCheck /> Reactivate
                      </Button>
                    )
                  ) : null}
                </div>
              ) : null}

              <dl>
                <Row label="E-mail">
                  <a className="text-primary hover:underline" href={`mailto:${user.email}`}>
                    {user.email}
                  </a>
                </Row>
                <Row label="Phone">{user.phone}</Row>
                <Row label="Department">
                  {user.department ? `${user.department.name} (${user.department.code})` : null}
                </Row>
                <Row label="Reports to">{user.manager?.name}</Row>
                <Row label="Weekly capacity">{`${user.weeklyCapacityHours} h`}</Row>
                <Row label="Joined">
                  {user.joinedAt ? format(new Date(user.joinedAt), 'd MMM yyyy') : null}
                </Row>
                <Row label="Last sign-in">
                  {user.lastLoginAt
                    ? format(new Date(user.lastLoginAt), 'd MMM yyyy, HH:mm')
                    : 'Never'}
                </Row>
              </dl>

              <Separator />
              <section>
                <h3 className="mb-2 text-xs font-semibold text-muted-foreground uppercase">
                  Roles
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {user.roles.map((r) => (
                    <Pill key={r.id} className="bg-accent text-accent-foreground">
                      {r.name}
                    </Pill>
                  ))}
                </div>
              </section>
              <section>
                <h3 className="mb-2 text-xs font-semibold text-muted-foreground uppercase">
                  Skills
                </h3>
                {user.skills.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No skills recorded.</p>
                ) : (
                  <ul className="grid gap-1.5 sm:grid-cols-2">
                    {user.skills.map((s) => (
                      <li
                        key={s.name}
                        className="flex items-center justify-between rounded-md border px-2.5 py-1.5 text-sm"
                      >
                        <span>{s.name}</span>
                        <span className="text-xs text-muted-foreground" title={LEVELS[s.level]}>
                          {'●'.repeat(s.level)}
                          <span className="opacity-30">{'●'.repeat(5 - s.level)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <div className="px-4 pb-6">
              <Separator className="mb-5" />
              <PassportPanel userId={user.id} />
            </div>
            <EmployeeFormDialog open={editing} onOpenChange={setEditing} user={user} />
            <ConfirmDialog
              open={resettingMfa}
              onOpenChange={setResettingMfa}
              title={`Reset two-step verification for ${user.name}?`}
              description="Use this when someone has lost their phone and recovery codes. They are signed out everywhere and set it up again at their next sign-in (if it is required for their role) or from their menu."
              confirmLabel="Reset"
              destructive
              onConfirm={async () => {
                await resetUserMfa(user.id);
                toast.success('Two-step verification reset');
              }}
            />
            <ConfirmDialog
              open={confirm !== null}
              onOpenChange={(o) => !o && setConfirm(null)}
              title={confirm === 'active' ? `Reactivate ${user.name}?` : `Deactivate ${user.name}?`}
              description={
                confirm === 'active'
                  ? 'They will be able to sign in again.'
                  : 'They will be signed out immediately and cannot sign in until reactivated. Their work history is kept.'
              }
              confirmLabel={confirm === 'active' ? 'Reactivate' : 'Deactivate'}
              destructive={confirm !== 'active'}
              onConfirm={async () => {
                await setStatus.mutateAsync(confirm!);
              }}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
