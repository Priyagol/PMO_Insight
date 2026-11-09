import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Plus, Send, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  REPORT_KIND_LABELS,
  describeReportSchedule,
  type ReportFormat,
  type ReportFrequency,
  type ReportKind,
} from '@arihant/shared';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { FormField } from '@/components/common/FormField';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCan } from '@/hooks/use-permission';
import { errorMessage } from '@/lib/errors';
import { fetchFilters, globalSearch } from '@/services/api/search';
import * as rep from '@/services/api/reporting';
import { useAppSelector } from '@/store';

const KEY = ['reporting', 'subscriptions'] as const;
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function ScheduleDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const me = useAppSelector((s) => s.session.user);
  const canSnapshot = useCan('analytics:view');
  const filters = useQuery({ queryKey: ['filters'], queryFn: fetchFilters });
  const [name, setName] = useState('');
  const [report, setReport] = useState<ReportKind>('filter');
  const [filterId, setFilterId] = useState('');
  const [format, setFormat] = useState<ReportFormat>('xlsx');
  const [frequency, setFrequency] = useState<ReportFrequency>('weekly');
  const [dayOfWeek, setDayOfWeek] = useState('1');
  const [dayOfMonth, setDayOfMonth] = useState('1');
  const [hour, setHour] = useState('9');
  const [recipients, setRecipients] = useState<{ id: string; name: string }[]>(
    me ? [{ id: me.id, name: `${me.name} (you)` }] : [],
  );
  const [term, setTerm] = useState('');
  const people = useQuery({
    queryKey: ['search', 'global', 'people', term],
    queryFn: () => globalSearch(term),
    enabled: term.trim().length >= 2,
  });
  const save = useMutation({
    mutationFn: () =>
      rep.createSubscription({
        name: name.trim(),
        report,
        filterId: report === 'filter' ? filterId : null,
        format,
        frequency,
        dayOfWeek: Number(dayOfWeek),
        dayOfMonth: Number(dayOfMonth),
        hour: Number(hour),
        recipientIds: recipients.map((r) => r.id),
      }),
    onSuccess: async (s) => {
      await qc.invalidateQueries({ queryKey: KEY });
      toast.success(`Scheduled: ${describeReportSchedule(s)}`);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const formats: ReportFormat[] =
    report === 'filter' ? ['xlsx', 'csv'] : report === 'snapshot' ? ['pdf', 'xlsx'] : ['csv'];
  const valid =
    name.trim() &&
    recipients.length &&
    (report !== 'filter' || filterId) &&
    formats.includes(format);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Schedule a report e-mail</DialogTitle>
          <DialogDescription>
            Each recipient gets the report as an attachment, built with their own access: they never
            see work they could not open themselves.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <FormField label="Name">
            <Input maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={report}
              onValueChange={(v) => {
                setReport(v as ReportKind);
                setFormat(v === 'filter' ? 'xlsx' : v === 'snapshot' ? 'pdf' : 'csv');
              }}
            >
              <SelectTrigger aria-label="Report">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="filter">Saved filter results</SelectItem>
                {canSnapshot ? (
                  <>
                    <SelectItem value="snapshot">Management snapshot</SelectItem>
                    <SelectItem value="work_summary">{REPORT_KIND_LABELS.work_summary}</SelectItem>
                    <SelectItem value="project_status">
                      {REPORT_KIND_LABELS.project_status}
                    </SelectItem>
                  </>
                ) : null}
              </SelectContent>
            </Select>
            <Select value={format} onValueChange={(v) => setFormat(v as ReportFormat)}>
              <SelectTrigger aria-label="Format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {formats.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f === 'xlsx' ? 'Excel' : f.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {report === 'filter' ? (
            <Select value={filterId} onValueChange={setFilterId}>
              <SelectTrigger aria-label="Filter">
                <SelectValue placeholder="Choose a saved filter" />
              </SelectTrigger>
              <SelectContent>
                {filters.data?.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <div className="grid grid-cols-3 gap-2">
            <Select value={frequency} onValueChange={(v) => setFrequency(v as ReportFrequency)}>
              <SelectTrigger aria-label="How often">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="quarterly">Quarterly</SelectItem>
              </SelectContent>
            </Select>
            {frequency === 'weekly' ? (
              <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
                <SelectTrigger aria-label="Day">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAYS.map((d, i) => (
                    <SelectItem key={d} value={String(i + 1)}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : frequency === 'monthly' || frequency === 'quarterly' ? (
              <Select value={dayOfMonth} onValueChange={setDayOfMonth}>
                <SelectTrigger aria-label="Day of month">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 28 }, (_, i) => (
                    <SelectItem key={i} value={String(i + 1)}>
                      Day {i + 1}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span />
            )}
            <Select value={hour} onValueChange={setHour}>
              <SelectTrigger aria-label="Time">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 24 }, (_, h) => (
                  <SelectItem key={h} value={String(h)}>
                    {String(h).padStart(2, '0')}:00
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Recipients</legend>
            <div className="flex flex-wrap gap-1">
              {recipients.map((r) => (
                <span
                  key={r.id}
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
                >
                  {r.name}
                  <button
                    type="button"
                    aria-label={`Remove ${r.name}`}
                    onClick={() => setRecipients((xs) => xs.filter((x) => x.id !== r.id))}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
            <Input
              className="h-8"
              aria-label="Add a colleague"
              placeholder="Add a colleague by name…"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
            {people.data?.people.length ? (
              <ul className="rounded-md border text-sm">
                {people.data.people
                  .filter((p) => !recipients.some((r) => r.id === p.id))
                  .map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="w-full px-2 py-1 text-left hover:bg-muted"
                        onClick={() => {
                          setRecipients((xs) => [...xs, { id: p.id, name: p.name }]);
                          setTerm('');
                        }}
                      >
                        {p.name}
                        {p.designation ? (
                          <span className="text-xs text-muted-foreground"> · {p.designation}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
              </ul>
            ) : null}
          </fieldset>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Scheduled report e-mails owned by the current user. */
export function ReportSchedules() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: rep.fetchSubscriptions });
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: (id: string) => rep.sendSubscriptionNow(id),
    onSuccess: async (s) => {
      await qc.invalidateQueries({ queryKey: KEY });
      toast.success(`Sent: ${s.lastResult ?? ''}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Saved filter results (Excel or CSV) or the management snapshot (PDF or Excel), e-mailed on
          a schedule in the organisation’s time zone.
        </p>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus /> Schedule a report
        </Button>
      </div>
      {q.data?.length ? (
        <ul className="divide-y rounded-xl border bg-card text-sm">
          {q.data.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
              <CalendarClock className="size-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{s.name}</p>
                <p className="text-xs text-muted-foreground">
                  {s.report === 'filter'
                    ? `Filter “${s.filter?.name ?? 'deleted'}”`
                    : REPORT_KIND_LABELS[s.report]}{' '}
                  · {s.format.toUpperCase()} · {describeReportSchedule(s)} · to{' '}
                  {s.recipients.map((r) => r.name).join(', ')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {s.nextRunAt
                    ? `Next: ${new Date(s.nextRunAt).toLocaleString('en-IN')}`
                    : 'Paused'}
                  {s.lastRunAt
                    ? ` · last ${new Date(s.lastRunAt).toLocaleString('en-IN')}: ${s.lastResult ?? ''}`
                    : ''}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => send.mutate(s.id)}
                disabled={send.isPending}
              >
                <Send /> Send now
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                aria-label={`Delete ${s.name}`}
                onClick={() => setDeleting(s.id)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      ) : !q.isLoading ? (
        <EmptyState
          icon={CalendarClock}
          title="No scheduled reports"
          description="Send a saved filter or the management snapshot to yourself and colleagues every day, week or month."
        />
      ) : null}
      {adding ? <ScheduleDialog onClose={() => setAdding(false)} /> : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Stop this scheduled report?"
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (deleting) await rep.deleteSubscription(deleting);
          await qc.invalidateQueries({ queryKey: KEY });
        }}
      />
    </div>
  );
}
