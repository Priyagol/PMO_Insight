import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GitBranch } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { STATUS_LABELS, type ProjectDto, type TaskStatus } from '@arihant/shared';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCan } from '@/hooks/use-permission';
import { errorMessage } from '@/lib/errors';
import { ApiClientError } from '@/services/api/client';
import * as wfApi from '@/services/api/workflows';
import { workflowKeys } from './TaskWorkflowControl';

const STANDARD = '__standard__';

/** Project setup: which task workflow the project uses. */
export function ProjectWorkflowPanel({ project }: { project: ProjectDto }) {
  const qc = useQueryClient();
  const canManageLibrary = useCan('project:update', 'department');
  const list = useQuery({ queryKey: workflowKeys.list, queryFn: wfApi.fetchWorkflows });
  const [choice, setChoice] = useState(project.workflow.id ?? STANDARD);
  const [unmapped, setUnmapped] = useState<{ status: TaskStatus; count: number }[]>([]);
  const [map, setMap] = useState<Partial<Record<TaskStatus, TaskStatus>>>({});
  const target = list.data?.find((w) => w.id === choice);
  const targetStatuses: TaskStatus[] = target
    ? target.definition.statuses
    : ['backlog', 'todo', 'in_progress', 'in_review', 'testing', 'blocked', 'done', 'cancelled'];

  const apply = useMutation({
    mutationFn: () =>
      wfApi.assignWorkflow(project.id, {
        workflowId: choice === STANDARD ? null : choice,
        statusMap: map,
      }),
    onSuccess: async (r) => {
      setUnmapped([]);
      setMap({});
      await qc.invalidateQueries({ queryKey: ['projects'] });
      await qc.invalidateQueries({ queryKey: ['tasks'] });
      toast.success(`Workflow changed${r.moved ? `; ${r.moved} task(s) moved` : ''}`);
    },
    onError: (e) => {
      const details =
        e instanceof ApiClientError ? (e.details as { unmapped?: typeof unmapped }) : null;
      if (details?.unmapped?.length) setUnmapped(details.unmapped);
      else toast.error(errorMessage(e));
    },
  });
  const changed = choice !== (project.workflow.id ?? STANDARD);
  const mappedAll = unmapped.every((u) => map[u.status]);

  return (
    <section aria-label="Task workflow" className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <GitBranch className="size-4" /> Task workflow
          </h2>
          <p className="text-xs text-muted-foreground">
            Statuses, allowed moves, who may make them and what must be filled first. Currently:{' '}
            <strong>{project.workflow.name}</strong>.
          </p>
        </div>
        {canManageLibrary ? (
          <Button asChild variant="ghost" size="sm">
            <Link to="/task-workflows">Manage workflows</Link>
          </Button>
        ) : null}
      </div>
      <ol className="flex flex-wrap items-center gap-1 text-xs" aria-label="Statuses">
        {project.workflow.statuses.map((s, i) => (
          <li key={s} className="flex items-center gap-1">
            {i ? <span className="text-muted-foreground">→</span> : null}
            <span className="rounded-full border px-2 py-0.5">
              {project.workflow.labels[s] ?? STATUS_LABELS[s]}
            </span>
          </li>
        ))}
      </ol>
      {project.can.update ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={choice}
              onValueChange={(v) => {
                setChoice(v);
                setUnmapped([]);
                setMap({});
              }}
            >
              <SelectTrigger size="sm" className="w-64" aria-label="Workflow">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={STANDARD}>Standard workflow</SelectItem>
                {list.data?.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              disabled={!changed || apply.isPending || (unmapped.length > 0 && !mappedAll)}
              onClick={() => apply.mutate()}
            >
              Use this workflow
            </Button>
          </div>
          {unmapped.length ? (
            <div
              role="alert"
              className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
            >
              <p>Some tasks are in statuses the new workflow does not use. Choose where they go:</p>
              {unmapped.map((u) => (
                <div key={u.status} className="flex items-center gap-2">
                  <span className="w-40">
                    {STATUS_LABELS[u.status]} ({u.count})
                  </span>
                  <span className="text-muted-foreground">→</span>
                  <Select
                    value={map[u.status] ?? ''}
                    onValueChange={(v) => setMap((m) => ({ ...m, [u.status]: v as TaskStatus }))}
                  >
                    <SelectTrigger
                      size="sm"
                      className="w-44"
                      aria-label={`New status for ${STATUS_LABELS[u.status]}`}
                    >
                      <SelectValue placeholder="Choose a status" />
                    </SelectTrigger>
                    <SelectContent>
                      {targetStatuses.map((s) => (
                        <SelectItem key={s} value={s}>
                          {target?.definition.labels[s] ?? STATUS_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
