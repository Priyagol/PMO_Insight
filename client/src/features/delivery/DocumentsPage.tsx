import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { CheckCircle2, Clock3, Download, FileText, Share2, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABELS,
  DOCUMENT_STATUS_LABELS,
  type DocumentCategory,
  type DocumentDto,
  type DocumentStatus,
} from '@arihant/shared';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { FormField } from '@/components/common/FormField';
import { PageHeader } from '@/components/common/PageHeader';
import { SearchInput } from '@/components/common/SearchInput';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { formatBytes } from '@/features/work/format';
import { useProjects } from '@/features/work/hooks';
import { useCan } from '@/hooks/use-permission';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import * as api from '@/services/api/delivery';
import { openSignedUrl, useDeliveryMutation } from './hooks';

const ALL = 'all';

export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  const Icon =
    status === 'published' ? CheckCircle2 : status === 'pending_approval' ? Clock3 : FileText;
  const color =
    status === 'published'
      ? 'var(--status-good)'
      : status === 'pending_approval'
        ? 'var(--status-warning)'
        : 'var(--muted-foreground)';
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium">
      <Icon className="size-3.5" style={{ color }} aria-hidden /> {DOCUMENT_STATUS_LABELS[status]}
    </span>
  );
}

function UploadDialog({ projectId, onClose }: { projectId?: string; onClose: () => void }) {
  const [project, setProject] = useState(projectId ?? '');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<DocumentCategory>('other');
  const [description, setDescription] = useState('');
  const [shared, setShared] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const projects = useProjects({ limit: 100, archived: 'false' }, !projectId);
  const save = useDeliveryMutation(
    () =>
      api.createDocument(
        {
          projectId: project,
          title: title.trim(),
          category,
          description: description.trim() || undefined,
          sharedWithStakeholders: shared,
        },
        file!,
      ),
    { success: (d) => `"${d.title}" uploaded as a draft` },
  );
  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload document</DialogTitle>
          <DialogDescription>
            PDF, Office files, images or text up to 25 MB. New documents start as drafts.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {!projectId ? (
            <FormField label="Project" required>
              <Select value={project} onValueChange={setProject}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.data?.items.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.key} · {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          ) : null}
          <FormField label="File" required>
            <Input
              type="file"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''));
              }}
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
            <FormField label="Title" required>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />
            </FormField>
            <FormField label="Category">
              <Select value={category} onValueChange={(v) => setCategory(v as DocumentCategory)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOCUMENT_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {DOCUMENT_CATEGORY_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>
          <FormField label="Description">
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
            />
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={shared} onCheckedChange={(c) => setShared(c === true)} />
            External stakeholders on the project may see the published version
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!project || !file || title.trim().length < 2 || save.isPending}
            onClick={() => save.mutate(undefined, { onSuccess: onClose })}
          >
            <Upload /> Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocumentDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['documents', 'detail', id],
    queryFn: () => api.fetchDocument(id),
  });
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(false);
  const addVersion = useDeliveryMutation(
    () => api.uploadDocumentVersion(id, file!, note.trim() || undefined),
    { success: (d) => `Version ${d.currentVersion} uploaded` },
  );
  const publish = useDeliveryMutation(() => api.publishDocument(id), {
    success: 'Sent for publication approval',
  });
  const share = useDeliveryMutation(
    (v: boolean) => api.updateDocument(id, { sharedWithStakeholders: v }),
    {
      success: (d) => (d.sharedWithStakeholders ? 'Shared with stakeholders' : 'No longer shared'),
    },
  );
  const remove = useDeliveryMutation(() => api.deleteDocument(id), { success: 'Document deleted' });
  const d = q.data;
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {q.error ? (
          <ErrorState error={q.error} />
        ) : !d ? (
          <Skeleton className="m-4 h-64" />
        ) : (
          <div className="space-y-5 p-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                <Link to={`/projects/${d.project.id}`} className="hover:underline">
                  {d.project.key} · {d.project.name}
                </Link>{' '}
                · {DOCUMENT_CATEGORY_LABELS[d.category]}
              </p>
              <SheetTitle>{d.title}</SheetTitle>
              <SheetDescription>{d.description || 'No description'}</SheetDescription>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <DocumentStatusBadge status={d.status} />
                {d.publishedVersion ? (
                  <span className="text-xs text-muted-foreground">
                    Published version: {d.publishedVersion}
                  </span>
                ) : null}
                {d.approval ? (
                  <Link
                    to={`/approvals?open=${d.approval.id}`}
                    className="text-xs text-primary hover:underline"
                  >
                    {d.approval.key} ({d.approval.status})
                  </Link>
                ) : null}
              </div>
            </div>
            {d.can.edit || d.can.publish ? (
              <div className="flex flex-wrap gap-2">
                {d.can.publish ? (
                  <Button
                    size="sm"
                    disabled={publish.isPending}
                    onClick={() => publish.mutate(undefined)}
                  >
                    <CheckCircle2 /> Request publication of v{d.currentVersion}
                  </Button>
                ) : null}
                {d.can.edit ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => share.mutate(!d.sharedWithStakeholders)}
                    >
                      <Share2 />{' '}
                      {d.sharedWithStakeholders
                        ? 'Stop sharing with stakeholders'
                        : 'Share with stakeholders'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>
                      <Trash2 /> Delete
                    </Button>
                  </>
                ) : null}
              </div>
            ) : null}
            <section aria-label="Versions">
              <h4 className="mb-2 text-sm font-semibold">Versions</h4>
              <ul className="divide-y rounded-lg border">
                {d.versions.map((v) => (
                  <li key={v.version} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="w-10 font-mono text-xs">v{v.version}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{v.fileName}</span>
                      <span className="block text-xs text-muted-foreground">
                        {formatBytes(v.size)} · {v.uploadedBy?.name ?? '—'} ·{' '}
                        {formatDistanceToNow(new Date(v.uploadedAt), { addSuffix: true })}
                        {v.note ? ` · ${v.note}` : ''}
                        {v.version === d.publishedVersion ? ' · published' : ''}
                      </span>
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={`Download version ${v.version}`}
                      onClick={() =>
                        void openSignedUrl(() => api.documentDownloadUrl(d.id, v.version))
                      }
                    >
                      <Download />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
            {d.can.edit ? (
              <section className="space-y-2 rounded-lg border p-3" aria-label="New version">
                <h4 className="text-sm font-semibold">Upload a new version</h4>
                <Input
                  type="file"
                  aria-label="New version file"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <Input
                  placeholder="What changed (optional)"
                  aria-label="Version note"
                  value={note}
                  maxLength={500}
                  onChange={(e) => setNote(e.target.value)}
                />
                <Button
                  size="sm"
                  disabled={!file || addVersion.isPending}
                  onClick={() =>
                    addVersion.mutate(undefined, { onSuccess: () => (setFile(null), setNote('')) })
                  }
                >
                  <Upload /> Upload version {d.currentVersion + 1}
                </Button>
              </section>
            ) : null}
          </div>
        )}
        <ConfirmDialog
          open={confirm}
          onOpenChange={setConfirm}
          title="Delete this document?"
          description="It disappears from the project, including all versions. The deletion is audited."
          confirmLabel="Delete"
          destructive
          onConfirm={async () => {
            await remove.mutateAsync(undefined);
            onClose();
          }}
        />
      </SheetContent>
    </Sheet>
  );
}

export function DocumentsHost({ projectId }: { projectId?: string }) {
  const canWrite = useCan('document:write');
  const [params, setParams] = useSearchParams();
  const openId = params.get('doc');
  const [uploading, setUploading] = useState(false);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);
  const search = useDebouncedValue(q, 250);
  const query = {
    projectId,
    q: search || undefined,
    category: category === ALL ? undefined : (category as DocumentCategory),
    status: status === ALL ? undefined : (status as DocumentStatus),
    limit: 50,
  };
  const list = useQuery({
    queryKey: ['documents', 'list', query],
    queryFn: () => api.fetchDocuments(query),
  });
  const setOpen = (id: string | null) =>
    setParams((p) => {
      if (id) p.set('doc', id);
      else p.delete('doc');
      return p;
    });
  const docs: DocumentDto[] = list.data?.items ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Search documents…" />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger size="sm" className="w-36" aria-label="Category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            {DOCUMENT_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {DOCUMENT_CATEGORY_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger size="sm" className="w-40" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {(Object.keys(DOCUMENT_STATUS_LABELS) as DocumentStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {DOCUMENT_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canWrite ? (
          <Button size="sm" className="ml-auto" onClick={() => setUploading(true)}>
            <Upload /> Upload document
          </Button>
        ) : null}
      </div>
      {list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isLoading ? (
        <Skeleton className="h-40" />
      ) : docs.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <EmptyState
            icon={FileText}
            title="No documents"
            description="Upload BRDs, designs, test plans and other project documents."
          />
        </div>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {docs.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted/50"
                onClick={() => setOpen(d.id)}
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{d.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {projectId ? '' : `${d.project.key} · `}
                    {DOCUMENT_CATEGORY_LABELS[d.category]} · v{d.currentVersion}
                    {d.sharedWithStakeholders ? ' · shared' : ''} · updated{' '}
                    {formatDistanceToNow(new Date(d.updatedAt), { addSuffix: true })}
                  </span>
                </span>
                <DocumentStatusBadge status={d.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {uploading ? (
        <UploadDialog projectId={projectId} onClose={() => setUploading(false)} />
      ) : null}
      {openId ? <DocumentDetail id={openId} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

export function DocumentsPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Documents"
        description="Project documents with versions. Publishing a version goes through approval."
      />
      <DocumentsHost />
    </div>
  );
}
