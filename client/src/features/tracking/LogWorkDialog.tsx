import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { WORK_CATEGORIES, WORK_CATEGORY_LABELS, type WorklogDto } from '@arihant/shared';
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
import { todayIso } from '@/features/work/format';
import { useProjects, useTasks } from '@/features/work/hooks';
import * as t from '@/services/api/tracking';
import { useTrackMutation } from './hooks';

const NONE = '__none__';
const formSchema = z
  .object({
    date: z.iso.date('Choose a date'),
    projectId: z.string().min(1, 'Choose a project'),
    taskId: z.string(),
    mode: z.enum(['duration', 'range']),
    hours: z.union([z.nan(), z.number().min(0).max(24)]),
    mins: z.union([z.nan(), z.number().min(0).max(59)]),
    startTime: z.string(),
    endTime: z.string(),
    category: z.enum(WORK_CATEGORIES),
    description: z.string().trim().min(3, 'Describe the work (at least 3 characters)').max(2000),
  })
  .superRefine((v, ctx) => {
    if (v.date > todayIso())
      ctx.addIssue({ code: 'custom', path: ['date'], message: 'You cannot log future work' });
    if (v.mode === 'duration') {
      const total =
        (Number.isNaN(v.hours) ? 0 : v.hours) * 60 + (Number.isNaN(v.mins) ? 0 : v.mins);
      if (total < 1)
        ctx.addIssue({ code: 'custom', path: ['hours'], message: 'Enter how long you worked' });
      if (total > 1440)
        ctx.addIssue({ code: 'custom', path: ['hours'], message: 'At most 24 hours' });
    } else if (!v.startTime || !v.endTime || v.startTime >= v.endTime) {
      ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'Start must be before end' });
    }
  });
type FormValues = z.input<typeof formSchema>;

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Editing an existing entry. */
  log?: WorklogDto;
  /** Prefill for a new entry (e.g. from a task). */
  defaults?: { projectId?: string; taskId?: string; date?: string };
}

export function LogWorkDialog({ open, onOpenChange, log, defaults }: Props) {
  const form = useForm<FormValues>({ resolver: zodResolver(formSchema) });
  const projectId = useWatch({ control: form.control, name: 'projectId' });
  const mode = useWatch({ control: form.control, name: 'mode' });
  const projects = useProjects({ mine: 'true', limit: 100, sort: 'name' }, open);
  const tasks = useTasks(
    { projectId: projectId ? [projectId] : undefined, limit: 100, sort: 'key' },
    open && Boolean(projectId),
  );
  const errors = form.formState.errors;

  useEffect(() => {
    if (!open) return;
    form.reset({
      date: log?.date ?? defaults?.date ?? todayIso(),
      projectId: log?.project.id ?? defaults?.projectId ?? '',
      taskId: log?.task?.id ?? defaults?.taskId ?? NONE,
      mode: log?.startTime ? 'range' : 'duration',
      hours: log && !log.startTime ? Math.floor(log.minutes / 60) : Number.NaN,
      mins: log && !log.startTime ? log.minutes % 60 : Number.NaN,
      startTime: log?.startTime ?? '',
      endTime: log?.endTime ?? '',
      category: log?.category ?? 'development',
      description: log?.description ?? '',
    });
  }, [open, log, defaults, form]);

  const save = useTrackMutation(
    (v: FormValues) => {
      const timing =
        v.mode === 'range'
          ? { startTime: v.startTime, endTime: v.endTime }
          : {
              minutes:
                (Number.isNaN(v.hours) ? 0 : v.hours) * 60 + (Number.isNaN(v.mins) ? 0 : v.mins),
            };
      const input = {
        date: v.date,
        projectId: v.projectId,
        taskId: v.taskId === NONE ? null : v.taskId,
        category: v.category,
        description: v.description,
        ...timing,
      };
      return log ? t.updateWorklog(log.id, input) : t.createWorklog(input);
    },
    { success: log ? 'Work log updated' : 'Work logged' },
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{log ? 'Edit work log' : 'Log work'}</DialogTitle>
          <DialogDescription>Entries in a submitted or approved week are locked.</DialogDescription>
        </DialogHeader>
        <form
          id="log-form"
          noValidate
          className="space-y-4"
          onSubmit={form.handleSubmit(async (v) => {
            await save.mutateAsync(v);
            onOpenChange(false);
          })}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Date" required error={errors.date?.message}>
              <Input type="date" max={todayIso()} {...form.register('date')} />
            </FormField>
            <FormField label="Category">
              <Controller
                control={form.control}
                name="category"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WORK_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {WORK_CATEGORY_LABELS[c]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>
            <FormField label="Project" required error={errors.projectId?.message}>
              <Controller
                control={form.control}
                name="projectId"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(v) => {
                      field.onChange(v);
                      form.setValue('taskId', NONE);
                    }}
                  >
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
                )}
              />
            </FormField>
            <FormField label="Task">
              <Controller
                control={form.control}
                name="taskId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={!projectId}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No specific task</SelectItem>
                      {tasks.data?.items.map((task) => (
                        <SelectItem key={task.id} value={task.id}>
                          {task.key} · {task.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>
          </div>

          <div className="space-y-2">
            <div
              role="radiogroup"
              aria-label="How to enter time"
              className="inline-flex rounded-md border p-0.5 text-xs"
            >
              {(['duration', 'range'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => form.setValue('mode', m)}
                  className={`rounded px-2.5 py-1 ${mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
                >
                  {m === 'duration' ? 'Duration' : 'Start – end'}
                </button>
              ))}
            </div>
            {mode === 'duration' ? (
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Hours" error={errors.hours?.message}>
                  <Input
                    type="number"
                    min={0}
                    max={24}
                    {...form.register('hours', { valueAsNumber: true })}
                  />
                </FormField>
                <FormField label="Minutes">
                  <Input
                    type="number"
                    min={0}
                    max={59}
                    step={5}
                    {...form.register('mins', { valueAsNumber: true })}
                  />
                </FormField>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Start">
                  <Input type="time" {...form.register('startTime')} />
                </FormField>
                <FormField label="End" error={errors.endTime?.message}>
                  <Input type="time" {...form.register('endTime')} />
                </FormField>
              </div>
            )}
          </div>

          <FormField label="What did you do?" required error={errors.description?.message}>
            <Textarea rows={3} {...form.register('description')} />
          </FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="log-form" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : log ? 'Save' : 'Log work'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
