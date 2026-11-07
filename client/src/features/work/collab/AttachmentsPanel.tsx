import { Download, FileText, Paperclip, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ALLOWED_ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES } from '@arihant/shared';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/errors';
import * as work from '@/services/api/work';
import { formatBytes } from '../format';
import { useAttachments, useWorkMutation, workKeys } from '../hooks';

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.gif,.webp,.docx,.xlsx,.pptx,.txt,.csv,.zip';

/** File list with upload, download (short-lived signed link) and delete. */
export function AttachmentsPanel({
  owner,
  canUpload,
}: {
  owner: work.AttachmentOwner;
  canUpload: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const files = useAttachments(owner);
  const [progress, setProgress] = useState<number | null>(null);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const invalidate = [workKeys.attachments(owner), workKeys.tasks, workKeys.projects];
  const upload = useWorkMutation((file: File) => work.uploadAttachment(owner, file, setProgress), {
    success: (a) => `${a.fileName} uploaded`,
    invalidate,
  });
  const remove = useWorkMutation((id: string) => work.deleteAttachment(id), {
    success: 'File removed',
    invalidate,
  });

  const onFiles = async (list: FileList | null) => {
    for (const file of Array.from(list ?? [])) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast.error(`${file.name} is larger than 25 MB`);
        continue;
      }
      setProgress(0);
      await upload.mutateAsync(file).catch(() => undefined);
    }
    setProgress(null);
    if (input.current) input.current.value = '';
  };

  const download = async (id: string) => {
    try {
      const { url } = await work.attachmentDownloadUrl(id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="space-y-3">
      {canUpload ? (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void onFiles(e.dataTransfer.files);
          }}
          className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground"
        >
          <Upload className="size-4" />
          <p>
            Drop files here or{' '}
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => input.current?.click()}
            >
              browse
            </button>
            . Up to 25 MB: {Object.values(ALLOWED_ATTACHMENT_TYPES).slice(0, 6).join(', ')} and
            more.
          </p>
          <input
            ref={input}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => void onFiles(e.target.files)}
            aria-label="Upload files"
          />
          {progress !== null ? (
            <div className="h-1 w-full overflow-hidden rounded bg-muted">
              <div
                className="h-full bg-primary transition-[width]"
                style={{ width: `${progress}%` }}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {files.error ? (
        <ErrorState error={files.error} onRetry={() => void files.refetch()} />
      ) : files.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : files.data?.length === 0 ? (
        <EmptyState compact icon={Paperclip} title="No files yet" />
      ) : (
        <ul className="divide-y rounded-lg border">
          {files.data?.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate">{f.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(f.size)} · {f.uploadedBy?.name ?? 'Unknown'} ·{' '}
                  {new Date(f.createdAt).toLocaleDateString()}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={`Download ${f.fileName}`}
                onClick={() => void download(f.id)}
              >
                <Download />
              </Button>
              {f.canDelete ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={`Delete ${f.fileName}`}
                  onClick={() => setRemoving({ id: f.id, name: f.fileName })}
                >
                  <Trash2 />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Delete ${removing?.name ?? 'file'}?`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          await remove.mutateAsync(removing!.id);
        }}
      />
    </div>
  );
}
