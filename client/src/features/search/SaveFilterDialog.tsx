import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import type { FilterSharing, SavedFilterDto } from '@arihant/shared';
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
import { Textarea } from '@/components/ui/textarea';
import { useProjects } from '@/features/work/hooks';
import { useCan } from '@/hooks/use-permission';
import { errorMessage } from '@/lib/errors';
import * as searchApi from '@/services/api/search';

/** Save the current query as a new filter, or update a filter the user owns. */
export function SaveFilterDialog({
  aql,
  existing,
  onClose,
  onSaved,
}: {
  aql: string;
  existing: SavedFilterDto | null;
  onClose: () => void;
  onSaved: (f: SavedFilterDto) => void;
}) {
  const qc = useQueryClient();
  const canShareOrg = useCan('project:read', 'department');
  const projects = useProjects({ limit: 100, sort: 'name' });
  const [asNew, setAsNew] = useState(!existing);
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [sharing, setSharing] = useState<FilterSharing>(existing?.sharing ?? 'private');
  const [projectId, setProjectId] = useState(existing?.project?.id ?? '');

  const save = useMutation({
    mutationFn: () => {
      const input = {
        name: name.trim(),
        description: description.trim() || null,
        aql,
        sharing,
        projectId: sharing === 'project' ? projectId : null,
      };
      return existing && !asNew
        ? searchApi.updateFilter(existing.id, input)
        : searchApi.createFilter(input);
    },
    onSuccess: async (f) => {
      await qc.invalidateQueries({ queryKey: ['filters'] });
      toast.success(`Filter “${f.name}” saved`);
      onSaved(f);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const valid = name.trim().length > 0 && (sharing !== 'project' || Boolean(projectId));

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{existing && !asNew ? 'Update filter' : 'Save filter'}</DialogTitle>
          <DialogDescription>
            People you share it with see the same query; results always follow their own access.
          </DialogDescription>
        </DialogHeader>
        <form
          id="save-filter"
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save.mutate();
          }}
        >
          <p className="rounded-md bg-muted px-2 py-1.5 font-mono text-xs break-all">{aql}</p>
          {existing ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={asNew} onChange={(e) => setAsNew(e.target.checked)} />
              Save as a new filter instead of updating “{existing.name}”
            </label>
          ) : null}
          <FormField label="Name">
            <Input
              autoFocus
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </FormField>
          <FormField label="Description (optional)">
            <Textarea
              maxLength={500}
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </FormField>
          <FormField label="Shared with">
            <Select value={sharing} onValueChange={(v) => setSharing(v as FilterSharing)}>
              <SelectTrigger aria-label="Shared with">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">Only me</SelectItem>
                <SelectItem value="project">Members of a project</SelectItem>
                {canShareOrg ? (
                  <SelectItem value="org">Everyone in the organisation</SelectItem>
                ) : null}
              </SelectContent>
            </Select>
          </FormField>
          {sharing === 'project' ? (
            <FormField label="Project">
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger aria-label="Project">
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
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="save-filter" disabled={!valid || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save filter'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
