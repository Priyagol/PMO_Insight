import { format, parseISO, startOfWeek } from 'date-fns';
import { CheckCircle2, ClipboardCheck, Send, XCircle } from 'lucide-react';
import { useState } from 'react';
import type { TimesheetDto, TimesheetStatus } from '@arihant/shared';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { FormField } from '@/components/common/FormField';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useCan } from '@/hooks/use-permission';
import { cn } from '@/lib/utils';
import * as t from '@/services/api/tracking';
import { formatMinutes, useTimesheetWeek, useTimesheets, useTrackMutation } from './hooks';
import { WeekNavigator } from './WorkLogsPage';

const STATUS_TONE: Record<TimesheetStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  submitted: 'bg-info/10 text-info',
  approved: 'bg-success/10 text-success',
  rejected: 'bg-destructive/10 text-destructive',
};
const STATUS_TEXT: Record<TimesheetStatus, string> = {
  draft: 'Not submitted',
  submitted: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Changes requested',
};

export function TimesheetStatusBadge({ status }: { status: TimesheetStatus }) {
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STATUS_TONE[status])}>
      {STATUS_TEXT[status]}
    </span>
  );
}

/** Day-by-day grid and per-project totals for one week. */
export function TimesheetSummary({ sheet }: { sheet: TimesheetDto }) {
  const max = Math.max(...sheet.days.map((d) => d.minutes), 480);
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
      <div className="grid grid-cols-7 gap-2">
        {sheet.days.map((d) => (
          <div key={d.date} className="rounded-lg border p-2 text-center">
            <p className="text-[11px] text-muted-foreground">{format(parseISO(d.date), 'EEE d')}</p>
            <div
              className="mx-auto mt-2 flex h-20 w-3 items-end overflow-hidden rounded bg-muted"
              aria-hidden
            >
              <div
                className="w-full rounded bg-primary"
                style={{ height: `${(d.minutes / max) * 100}%` }}
              />
            </div>
            <p className="mt-1 text-xs font-medium tabular">
              {d.minutes ? formatMinutes(d.minutes) : '—'}
            </p>
          </div>
        ))}
      </div>
      <div>
        <h3 className="mb-2 text-xs font-semibold text-muted-foreground uppercase">By project</h3>
        {sheet.byProject.length ? (
          <ul className="space-y-1.5 text-sm">
            {sheet.byProject.map((p) => (
              <li key={p.project.id} className="flex justify-between gap-2">
                <span className="truncate">
                  {p.project.key} · {p.project.name}
                </span>
                <span className="tabular">{formatMinutes(p.minutes)}</span>
              </li>
            ))}
            <li className="flex justify-between border-t pt-1.5 font-semibold">
              <span>Total</span>
              <span className="tabular">{formatMinutes(sheet.totalMinutes)}</span>
            </li>
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No work logged.</p>
        )}
      </div>
    </div>
  );
}

function MyTimesheet() {
  const [weekStart, setWeekStart] = useState(() =>
    format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd'),
  );
  const week = useTimesheetWeek(weekStart);
  const submit = useTrackMutation(() => t.submitTimesheet(weekStart), {
    success: 'Timesheet submitted for approval',
  });
  const s = week.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <WeekNavigator weekStart={weekStart} onChange={setWeekStart} />
        {s ? (
          <div className="flex items-center gap-3">
            <TimesheetStatusBadge status={s.status} />
            {s.status === 'draft' || s.status === 'rejected' ? (
              <Button
                size="sm"
                disabled={!s.totalMinutes || submit.isPending}
                onClick={() => submit.mutate(undefined)}
              >
                <Send /> Submit week
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {s?.status === 'rejected' && s.comment ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <strong>{s.decidedBy?.name ?? 'Your approver'}</strong> requested changes: {s.comment}
        </p>
      ) : null}
      {s?.status === 'approved' ? (
        <p className="text-sm text-muted-foreground">
          Approved by {s.decidedBy?.name}{' '}
          {s.decidedAt ? `on ${format(new Date(s.decidedAt), 'd MMM yyyy')}` : ''}.
        </p>
      ) : null}
      <section className="rounded-xl border bg-card p-4">
        {week.error ? (
          <ErrorState error={week.error} onRetry={() => void week.refetch()} />
        ) : s ? (
          <TimesheetSummary sheet={s} />
        ) : (
          <Skeleton className="h-40 w-full" />
        )}
      </section>
      <p className="text-xs text-muted-foreground">
        Submitting locks the week's work logs. If changes are requested they unlock again.
      </p>
    </div>
  );
}

function RejectDialog({ sheet, onClose }: { sheet: TimesheetDto; onClose: () => void }) {
  const [comment, setComment] = useState('');
  const reject = useTrackMutation(() => t.rejectTimesheet(sheet.id!, comment), {
    success: 'Changes requested',
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Request changes</DialogTitle>
          <DialogDescription>
            {sheet.user.name} will see your comment and can resubmit.
          </DialogDescription>
        </DialogHeader>
        <FormField label="What needs to change?" required>
          <Textarea
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            autoFocus
          />
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={comment.trim().length < 3 || reject.isPending}
            onClick={() => reject.mutate(undefined, { onSuccess: onClose })}
          >
            Request changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Approvals() {
  const queue = useTimesheets({ scope: 'approvals' });
  const [open, setOpen] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<TimesheetDto | null>(null);
  const approve = useTrackMutation((id: string) => t.approveTimesheet(id), {
    success: 'Timesheet approved',
  });
  if (queue.error) return <ErrorState error={queue.error} onRetry={() => void queue.refetch()} />;
  if (queue.isLoading) return <Skeleton className="h-40 w-full" />;
  if (!queue.data?.items.length)
    return (
      <div className="rounded-xl border bg-card">
        <EmptyState icon={ClipboardCheck} title="Nothing waiting for approval" />
      </div>
    );
  return (
    <ul className="space-y-3">
      {queue.data.items.map((s) => (
        <li key={s.id} className="rounded-xl border bg-card">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => setOpen(open === s.id ? null : s.id)}
              aria-expanded={open === s.id}
            >
              <p className="font-medium">{s.user.name}</p>
              <p className="text-xs text-muted-foreground">
                Week of {format(parseISO(s.weekStart), 'd MMM yyyy')} ·{' '}
                {formatMinutes(s.totalMinutes)} · submitted{' '}
                {s.submittedAt ? format(new Date(s.submittedAt), 'd MMM, HH:mm') : ''}
              </p>
            </button>
            {s.canApprove ? (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setRejecting(s)}>
                  <XCircle /> Request changes
                </Button>
                <Button
                  size="sm"
                  disabled={approve.isPending}
                  onClick={() => approve.mutate(s.id!)}
                >
                  <CheckCircle2 /> Approve
                </Button>
              </div>
            ) : null}
          </div>
          {open === s.id ? (
            <div className="border-t p-4">
              <TimesheetSummary sheet={s} />
            </div>
          ) : null}
        </li>
      ))}
      {rejecting ? <RejectDialog sheet={rejecting} onClose={() => setRejecting(null)} /> : null}
    </ul>
  );
}

export function TimesheetsPage() {
  const canApprove = useCan('timesheet:approve');
  return (
    <div className="space-y-5">
      <PageHeader
        title="Timesheets"
        description="Weekly totals from your work logs, submitted for approval."
      />
      <Tabs defaultValue="mine">
        <TabsList>
          <TabsTrigger value="mine">My timesheet</TabsTrigger>
          {canApprove ? <TabsTrigger value="approvals">Approvals</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="mine" className="mt-4">
          <MyTimesheet />
        </TabsContent>
        {canApprove ? (
          <TabsContent value="approvals" className="mt-4">
            <Approvals />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
