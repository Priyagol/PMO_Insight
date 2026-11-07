import type { ColumnDef } from '@tanstack/react-table';
import { format } from 'date-fns';
import { ScrollText } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { AuditLogDto, LoginHistoryDto } from '@arihant/shared';
import { DataTable } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { SearchInput } from '@/components/common/SearchInput';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Pill } from '../components/Badges';
import { useAuditLogs, useLoginHistory } from '../hooks';

const ALL = 'all';
const ENTITY_TYPES = ['user', 'department', 'role', 'settings'];

const when = (iso: string) => format(new Date(iso), 'd MMM yyyy, HH:mm:ss');

const activityColumns: ColumnDef<AuditLogDto, unknown>[] = [
  {
    id: 'createdAt',
    header: 'When',
    cell: ({ row }) => (
      <span className="text-xs whitespace-nowrap tabular">{when(row.original.createdAt)}</span>
    ),
  },
  {
    id: 'actor',
    header: 'Who',
    enableSorting: false,
    cell: ({ row }) =>
      row.original.actor?.name ?? <span className="text-muted-foreground">System</span>,
  },
  {
    id: 'action',
    header: 'Action',
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.action}</span>,
  },
  {
    id: 'summary',
    header: 'Summary',
    enableSorting: false,
    cell: ({ row }) => <span className="line-clamp-2">{row.original.summary}</span>,
  },
];

const loginColumns: ColumnDef<LoginHistoryDto, unknown>[] = [
  {
    id: 'createdAt',
    header: 'When',
    enableSorting: false,
    cell: ({ row }) => (
      <span className="text-xs whitespace-nowrap tabular">{when(row.original.createdAt)}</span>
    ),
  },
  { id: 'email', header: 'E-mail', enableSorting: false, cell: ({ row }) => row.original.email },
  {
    id: 'result',
    header: 'Result',
    enableSorting: false,
    cell: ({ row }) =>
      row.original.success ? (
        <Pill className="bg-success/10 text-success">Success</Pill>
      ) : (
        <Pill className="bg-destructive/10 text-destructive">
          {(row.original.reason ?? 'failed').replace(/_/g, ' ')}
        </Pill>
      ),
  },
  {
    id: 'ip',
    header: 'IP address',
    enableSorting: false,
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.ip ?? '—'}</span>,
  },
  {
    id: 'ua',
    header: 'Device',
    enableSorting: false,
    cell: ({ row }) => (
      <span className="line-clamp-1 max-w-64 text-xs text-muted-foreground">
        {row.original.userAgent ?? '—'}
      </span>
    ),
  },
];

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  if (value === undefined || value === null) return null;
  return (
    <section>
      <h4 className="mb-1 text-xs font-semibold text-muted-foreground uppercase">{label}</h4>
      <pre className="max-h-72 overflow-auto rounded-lg bg-muted p-3 font-mono text-[11px] leading-relaxed">
        {JSON.stringify(value, null, 2)}
      </pre>
    </section>
  );
}

function ActivityTab() {
  const [q, setQ] = useState('');
  const [entityType, setEntityType] = useState(ALL);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AuditLogDto | null>(null);
  const query = useMemo(
    () => ({
      q: q || undefined,
      entityType: entityType === ALL ? undefined : entityType,
      from: from || undefined,
      to: to || undefined,
      page,
      limit: 25,
    }),
    [q, entityType, from, to, page],
  );
  const logs = useAuditLogs(query);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={q}
          onChange={(v) => {
            setQ(v);
            setPage(1);
          }}
          placeholder="Search summaries…"
        />
        <Select
          value={entityType}
          onValueChange={(v) => {
            setEntityType(v);
            setPage(1);
          }}
        >
          <SelectTrigger size="sm" className="w-40" aria-label="Filter by record type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All records</SelectItem>
            {ENTITY_TYPES.map((t) => (
              <SelectItem key={t} value={t} className="capitalize">
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          From
          <Input
            type="date"
            className="h-8 w-36"
            value={from}
            max={to || undefined}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          To
          <Input
            type="date"
            className="h-8 w-36"
            value={to}
            min={from || undefined}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
        </label>
      </div>
      <DataTable
        columns={activityColumns}
        data={logs.data?.items}
        meta={logs.data?.meta}
        onPageChange={setPage}
        isLoading={logs.isLoading}
        error={logs.error}
        onRetry={() => void logs.refetch()}
        getRowId={(r) => r.id}
        onRowClick={setSelected}
        empty={<EmptyState compact icon={ScrollText} title="No audit events match" />}
      />
      <Sheet open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {selected ? (
            <>
              <SheetHeader className="border-b">
                <SheetTitle className="font-mono text-base">{selected.action}</SheetTitle>
                <SheetDescription>{selected.summary}</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 px-4 pb-6 text-sm">
                <dl className="grid grid-cols-[110px_1fr] gap-y-1.5">
                  <dt className="text-muted-foreground">When</dt>
                  <dd>{when(selected.createdAt)}</dd>
                  <dt className="text-muted-foreground">Who</dt>
                  <dd>
                    {selected.actor ? `${selected.actor.name} (${selected.actor.email})` : 'System'}
                  </dd>
                  <dt className="text-muted-foreground">Record</dt>
                  <dd className="font-mono text-xs">
                    {selected.entityType}
                    {selected.entityId ? ` · ${selected.entityId}` : ''}
                  </dd>
                  <dt className="text-muted-foreground">IP address</dt>
                  <dd className="font-mono text-xs">{selected.ip ?? '—'}</dd>
                  <dt className="text-muted-foreground">Request ID</dt>
                  <dd className="font-mono text-xs break-all">{selected.requestId ?? '—'}</dd>
                </dl>
                <JsonBlock label="Before" value={selected.before} />
                <JsonBlock label="After" value={selected.after} />
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SignInsTab() {
  const [q, setQ] = useState('');
  const [success, setSuccess] = useState(ALL);
  const [page, setPage] = useState(1);
  const history = useLoginHistory({
    q: q || undefined,
    success: success === ALL ? undefined : success,
    page,
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={q}
          onChange={(v) => {
            setQ(v);
            setPage(1);
          }}
          placeholder="Search by e-mail…"
        />
        <Select
          value={success}
          onValueChange={(v) => {
            setSuccess(v);
            setPage(1);
          }}
        >
          <SelectTrigger size="sm" className="w-40" aria-label="Filter by result">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All attempts</SelectItem>
            <SelectItem value="true">Successful</SelectItem>
            <SelectItem value="false">Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <DataTable
        columns={loginColumns}
        data={history.data?.items}
        meta={history.data?.meta}
        onPageChange={setPage}
        isLoading={history.isLoading}
        error={history.error}
        onRetry={() => void history.refetch()}
        getRowId={(r) => r.id}
        empty={<EmptyState compact icon={ScrollText} title="No sign-in attempts match" />}
      />
    </div>
  );
}

export function AuditLogsPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit Logs"
        description="Tamper-resistant history of critical actions and sign-in attempts. Entries cannot be edited or deleted."
      />
      <Tabs defaultValue="activity">
        <TabsList>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="signins">Sign-ins</TabsTrigger>
        </TabsList>
        <TabsContent value="activity" className="mt-4">
          <ActivityTab />
        </TabsContent>
        <TabsContent value="signins" className="mt-4">
          <SignInsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
