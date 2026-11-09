import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import {
  BUG_SEVERITIES,
  BUG_SEVERITY_LABELS,
  PRIORITIES,
  STATUS_LABELS,
  TASK_STATUSES,
  validateCustomValues,
  type BugSeverity,
  type CustomValues,
  type IssueType,
  type RecurrenceInput,
  type TaskStatus,
} from '@arihant/shared';
import {
  ComponentsPicker,
  EpicSelect,
  IssueTypeSelect,
  ReleaseSelect,
  SprintSelect,
} from '@/features/agile/agile-ui';
import { Checkbox } from '@/components/ui/checkbox';
import { CustomFieldInputs, MilestoneSelect, RecurrenceEditor } from '@/features/planning/fields';
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
import * as intel from '@/services/api/intelligence';
import * as work from '@/services/api/work';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useQuery } from '@tanstack/react-query';
import { useProject, useProjects, useWorkMutation } from '../hooks';
import { AssigneeSelect, PrioritySelect, StatusSelect } from './task-ui';
import { useTaskDrawer } from './use-task-drawer';

const optionalNumber = z
  .union([z.nan(), z.number().min(0).max(10000)])
  .transform((v) => (Number.isNaN(v) ? null : v));
const formSchema = z
  .object({
    projectId: z.string().min(1, 'Choose a project'),
    title: z.string().trim().min(2, 'Enter a task title').max(200),
    description: z.string().max(20000),
    status: z.enum(TASK_STATUSES),
    priority: z.enum(PRIORITIES),
    assigneeId: z.string().nullable(),
    startDate: z.string(),
    dueDate: z.string(),
    estimatedHours: optionalNumber,
    tags: z.string(),
  })
  .refine((v) => !v.startDate || !v.dueDate || v.startDate <= v.dueDate, {
    message: 'Due date must be on or after the start date',
    path: ['dueDate'],
  });
type FormValues = z.input<typeof formSchema>;
type Parsed = z.output<typeof formSchema>;

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Fixes the project (project workspace, subtask). */
  projectId?: string;
  parent?: { id: string; key: string };
  defaultStatus?: TaskStatus;
  defaultDueDate?: string;
  /** Pre-select a type / sprint (backlog and sprint planning). */
  defaultType?: IssueType;
  defaultSprintId?: string | null;
}

export function TaskFormDialog({
  open,
  onOpenChange,
  projectId,
  parent,
  defaultStatus = 'todo',
  defaultDueDate,
  defaultType = 'task',
  defaultSprintId = null,
}: Props) {
  const drawer = useTaskDrawer();
  const form = useForm<FormValues, unknown, Parsed>({ resolver: zodResolver(formSchema) });
  const chosenProject = useWatch({ control: form.control, name: 'projectId' });
  const projects = useProjects({ limit: 100, sort: 'name' }, open && !projectId);
  const project = useProject(chosenProject || undefined);
  const errors = form.formState.errors;
  const dueDate = useWatch({ control: form.control, name: 'dueDate' });
  const title = useDebouncedValue(useWatch({ control: form.control, name: 'title' }) ?? '', 400);
  const similar = useQuery({
    queryKey: ['tasks', 'similar', chosenProject, title.trim()],
    queryFn: () => intel.fetchSimilarTasks(chosenProject, title.trim()),
    enabled: open && Boolean(chosenProject) && title.trim().length >= 5,
    staleTime: 30_000,
  });
  const [milestoneId, setMilestoneId] = useState<string | null>(null);
  const [recurrence, setRecurrence] = useState<RecurrenceInput | null>(null);
  const [custom, setCustom] = useState<CustomValues>({});
  const [customErrors, setCustomErrors] = useState<Record<string, string>>({});
  const [type, setType] = useState<IssueType>(defaultType);
  const [points, setPoints] = useState('');
  const [epicId, setEpicId] = useState<string | null>(null);
  const [sprintId, setSprintId] = useState<string | null>(defaultSprintId);
  const [components, setComponents] = useState<string[]>([]);
  const [fixReleaseId, setFixReleaseId] = useState<string | null>(null);
  const [criteria, setCriteria] = useState('');
  const [severity, setSeverity] = useState<BugSeverity>('major');
  const [steps, setSteps] = useState('');
  const [expected, setExpected] = useState('');
  const [actual, setActual] = useState('');
  const [environment, setEnvironment] = useState('');
  const [regression, setRegression] = useState(false);
  const defs = project.data?.customFields ?? [];

  useEffect(() => {
    if (open) {
      form.reset({
        projectId: projectId ?? '',
        title: '',
        description: '',
        status: defaultStatus,
        priority: 'medium',
        assigneeId: null,
        startDate: '',
        dueDate: defaultDueDate ?? '',
        estimatedHours: Number.NaN,
        tags: '',
      });
    }
  }, [open, projectId, defaultStatus, defaultDueDate, form]);
  // Local (non-form) fields reset when the dialog opens (state adjusted during render).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setMilestoneId(null);
      setRecurrence(null);
      setCustom({});
      setCustomErrors({});
      setType(defaultType);
      setPoints('');
      setEpicId(null);
      setSprintId(defaultSprintId);
      setComponents([]);
      setFixReleaseId(null);
      setCriteria('');
      setSeverity('major');
      setSteps('');
      setExpected('');
      setActual('');
      setEnvironment('');
      setRegression(false);
    }
  }

  const create = useWorkMutation(
    (v: Parsed) =>
      work.createTask({
        projectId: v.projectId,
        parentId: parent?.id ?? null,
        title: v.title,
        description: v.description || undefined,
        status: v.status,
        priority: v.priority,
        assigneeId: v.assigneeId,
        startDate: v.startDate || null,
        dueDate: v.dueDate || null,
        estimatedHours: v.estimatedHours,
        tags: v.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        milestoneId,
        recurrence: parent ? null : recurrence,
        customFields: custom,
        type,
        storyPoints: points === '' ? null : Number(points),
        epicId: type === 'epic' || parent ? null : epicId,
        sprintId: type === 'epic' || parent ? null : sprintId,
        components,
        fixReleaseId,
        acceptanceCriteria: criteria.trim() || null,
        bug:
          type === 'bug'
            ? {
                severity,
                stepsToReproduce: steps.trim() || null,
                expectedResult: expected.trim() || null,
                actualResult: actual.trim() || null,
                environment: environment.trim() || null,
                regression,
              }
            : null,
      }),
    { success: (t) => `${t.key} created` },
  );

  const submit = (openAfter: boolean) =>
    form.handleSubmit(async (v) => {
      const check = validateCustomValues(defs, custom);
      setCustomErrors(check.errors);
      if (Object.keys(check.errors).length) return;
      if (recurrence && !v.dueDate && !parent) {
        form.setError('dueDate', { message: 'A repeating task needs a due date' });
        return;
      }
      const task = await create.mutateAsync(v);
      onOpenChange(false);
      if (openAfter) drawer.open(task.id);
    })();

  const creatable = (projects.data?.items ?? []).filter((p) => p.can.createTask);

  return (
    <Dialog open={open} onOpenChange={(o) => !create.isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{parent ? `New subtask of ${parent.key}` : 'New task'}</DialogTitle>
          <DialogDescription>Add details now or later from the task panel.</DialogDescription>
        </DialogHeader>
        <form
          id="task-form"
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(false).catch(() => undefined);
          }}
        >
          {!projectId ? (
            <FormField label="Project" required error={errors.projectId?.message}>
              <Controller
                control={form.control}
                name="projectId"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(v) => {
                      field.onChange(v);
                      form.setValue('assigneeId', null);
                      setMilestoneId(null);
                      setCustom({});
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose a project" />
                    </SelectTrigger>
                    <SelectContent>
                      {creatable.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.key} · {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Type">
              <IssueTypeSelect
                value={type}
                onChange={setType}
                allowEpic={!parent}
                className="w-full"
              />
            </FormField>
            <FormField label="Story points">
              <Input
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={points}
                onChange={(e) => setPoints(e.target.value)}
              />
            </FormField>
            {type !== 'epic' && !parent ? (
              <FormField label="Epic">
                <EpicSelect
                  projectId={chosenProject || undefined}
                  value={epicId}
                  onChange={setEpicId}
                  className="w-full"
                />
              </FormField>
            ) : null}
          </div>
          <FormField label="Title" required error={errors.title?.message}>
            <Input autoFocus placeholder="What needs to be done?" {...form.register('title')} />
          </FormField>
          {similar.data?.length ? (
            <div
              className="rounded-lg border border-dashed p-2.5 text-xs"
              role="status"
              aria-label="Possible duplicates"
            >
              <p className="mb-1 font-medium">Possible duplicates in this project</p>
              <ul className="space-y-0.5">
                {similar.data.map((t) => (
                  <li key={t.id}>
                    <span className="font-mono">{t.key}</span> {t.title}{' '}
                    <span className="text-muted-foreground">
                      ({STATUS_LABELS[t.status]}, {Math.round(t.score * 100)}% similar)
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <FormField label="Description">
            <Textarea rows={3} {...form.register('description')} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Status">
              <Controller
                control={form.control}
                name="status"
                render={({ field }) => (
                  <StatusSelect value={field.value} onChange={field.onChange} className="w-full" />
                )}
              />
            </FormField>
            <FormField label="Priority">
              <Controller
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <PrioritySelect value={field.value} onChange={field.onChange} />
                )}
              />
            </FormField>
            <FormField label="Assignee">
              <Controller
                control={form.control}
                name="assigneeId"
                render={({ field }) => (
                  <AssigneeSelect
                    members={project.data?.members ?? []}
                    value={field.value}
                    onChange={field.onChange}
                    disabled={!chosenProject}
                    className="w-full"
                  />
                )}
              />
            </FormField>
            <FormField label="Start date">
              <Input type="date" {...form.register('startDate')} />
            </FormField>
            <FormField label="Due date" error={errors.dueDate?.message}>
              <Input type="date" {...form.register('dueDate')} />
            </FormField>
            <FormField label="Estimate (h)" error={errors.estimatedHours?.message}>
              <Input
                type="number"
                min={0}
                step={0.5}
                {...form.register('estimatedHours', { valueAsNumber: true })}
              />
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Tags" hint="Comma-separated, e.g. api, regression">
              <Input {...form.register('tags')} />
            </FormField>
            <FormField label="Milestone">
              <MilestoneSelect
                projectId={chosenProject || undefined}
                value={milestoneId}
                onChange={setMilestoneId}
                className="h-9"
              />
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {type !== 'epic' && !parent ? (
              <FormField label="Sprint">
                <SprintSelect
                  projectId={chosenProject || undefined}
                  value={sprintId}
                  onChange={setSprintId}
                  className="w-full"
                />
              </FormField>
            ) : null}
            <FormField label="Fix version">
              <ReleaseSelect
                projectId={chosenProject || undefined}
                value={fixReleaseId}
                onChange={setFixReleaseId}
                className="w-full"
              />
            </FormField>
          </div>
          {project.data?.components.length ? (
            <FormField label="Components">
              <ComponentsPicker
                available={project.data.components}
                value={components}
                onChange={setComponents}
              />
            </FormField>
          ) : null}
          {type === 'story' || type === 'enhancement' || type === 'epic' ? (
            <FormField label="Acceptance criteria">
              <Textarea rows={2} value={criteria} onChange={(e) => setCriteria(e.target.value)} />
            </FormField>
          ) : null}
          {type === 'bug' ? (
            <fieldset className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
              <legend className="px-1 text-xs font-medium text-muted-foreground">
                Bug details
              </legend>
              <FormField label="Severity">
                <Select value={severity} onValueChange={(v) => setSeverity(v as BugSeverity)}>
                  <SelectTrigger className="w-full" aria-label="Severity">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BUG_SEVERITIES.map((x) => (
                      <SelectItem key={x} value={x}>
                        {BUG_SEVERITY_LABELS[x]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Environment">
                <Input
                  value={environment}
                  onChange={(e) => setEnvironment(e.target.value)}
                  placeholder="e.g. UAT, Chrome 140"
                />
              </FormField>
              <FormField label="Steps to reproduce" className="sm:col-span-2">
                <Textarea rows={3} value={steps} onChange={(e) => setSteps(e.target.value)} />
              </FormField>
              <FormField label="Expected result">
                <Textarea rows={2} value={expected} onChange={(e) => setExpected(e.target.value)} />
              </FormField>
              <FormField label="Actual result">
                <Textarea rows={2} value={actual} onChange={(e) => setActual(e.target.value)} />
              </FormField>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <Checkbox checked={regression} onCheckedChange={(c) => setRegression(c === true)} />
                Regression (this worked before)
              </label>
            </fieldset>
          ) : null}
          {parent ? null : (
            <FormField label="Repeat">
              <RecurrenceEditor
                value={recurrence}
                onChange={setRecurrence}
                hasDueDate={Boolean(dueDate)}
              />
            </FormField>
          )}
          {defs.length ? (
            <fieldset className="space-y-2 rounded-lg border p-3">
              <legend className="px-1 text-xs font-medium text-muted-foreground">
                Project fields
              </legend>
              <CustomFieldInputs
                defs={defs}
                values={custom}
                errors={customErrors}
                onChange={(k, v) => setCustom((c) => ({ ...c, [k]: v }))}
              />
            </fieldset>
          ) : null}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            disabled={create.isPending}
            onClick={() => void submit(true).catch(() => undefined)}
          >
            Create &amp; open
          </Button>
          <Button type="submit" form="task-form" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create task'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
