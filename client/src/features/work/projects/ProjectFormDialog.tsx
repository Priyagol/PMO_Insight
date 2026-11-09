import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import {
  PRIORITIES,
  PRIORITY_LABELS,
  PROJECT_CATEGORIES,
  PROJECT_STATUSES,
  STATUS_LABELS,
  type ProjectDto,
  type UserRef,
} from '@arihant/shared';
import { FormField } from '@/components/common/FormField';
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
import { Textarea } from '@/components/ui/textarea';
import { MultiUserPicker } from '@/features/org/components/MultiUserPicker';
import { UserPicker } from '@/features/org/components/UserPicker';
import { useDepartments } from '@/features/org/hooks';
import { useTemplate, useTemplates } from '@/features/planning/hooks';
import { useCan } from '@/hooks/use-permission';
import * as work from '@/services/api/work';
import { useAppSelector } from '@/store';
import { useWorkMutation } from '../hooks';

const NONE = '__none__';
const optionalNumber = z
  .union([z.nan(), z.number().min(0)])
  .transform((v) => (Number.isNaN(v) ? null : v));

const formSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[A-Za-z][A-Za-z0-9]{1,5}$/, 'Use 2–6 letters/numbers, starting with a letter'),
    name: z.string().trim().min(2, 'Enter a project name').max(120),
    description: z.string().max(5000),
    category: z.string(),
    departmentId: z.string(),
    manager: z.custom<UserRef | null>().refine((v) => Boolean(v), 'Choose a project manager'),
    owner: z.custom<UserRef | null>(),
    members: z.custom<UserRef[]>(),
    priority: z.enum(PRIORITIES),
    status: z.enum(PROJECT_STATUSES),
    startDate: z.string(),
    endDate: z.string(),
    estimatedHours: optionalNumber,
    budget: optionalNumber,
    objectives: z.array(z.object({ text: z.string().trim().max(300) })),
    autoAssign: z.boolean(),
    dateChangeReason: z.string(),
  })
  .refine((v) => !v.startDate || !v.endDate || v.startDate <= v.endDate, {
    message: 'End date must be on or after the start date',
    path: ['endDate'],
  });
type FormValues = z.input<typeof formSchema>;
type Parsed = z.output<typeof formSchema>;

function defaults(project: ProjectDto | undefined, me: UserRef | null): FormValues {
  return {
    key: project?.key ?? '',
    name: project?.name ?? '',
    description: project?.description ?? '',
    category: project?.category ?? NONE,
    departmentId: project?.department?.id ?? NONE,
    manager: project?.manager ?? me,
    owner: project?.owner ?? null,
    members: project?.members.filter((m) => m.role !== 'manager').map((m) => m.user) ?? [],
    priority: project?.priority ?? 'medium',
    status: project?.status ?? 'planning',
    startDate: project?.startDate ?? '',
    endDate: project?.endDate ?? '',
    estimatedHours: project?.estimatedHours ?? Number.NaN,
    budget: project?.budget?.amount ?? Number.NaN,
    objectives: (project?.objectives ?? []).map((text) => ({ text })),
    autoAssign: project?.autoAssign ?? false,
    dateChangeReason: '',
  };
}

export function ProjectFormDialog({
  open,
  onOpenChange,
  project,
  initialTemplateId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  project?: ProjectDto;
  /** Pre-selects a template ("Use template" from the templates library). */
  initialTemplateId?: string;
}) {
  const [templateId, setTemplateId] = useState<string>(initialTemplateId ?? NONE);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setTemplateId(initialTemplateId ?? NONE);
  }
  const canCreate = useCan('project:create');
  const templates = useTemplates('', open && !project && canCreate);
  const template = useTemplate(templateId === NONE ? null : templateId);
  const navigate = useNavigate();
  const sessionUser = useAppSelector((s) => s.session.user);
  const me: UserRef | null = sessionUser
    ? {
        id: sessionUser.id,
        name: sessionUser.name,
        email: sessionUser.email,
        employeeId: sessionUser.employeeId,
      }
    : null;
  const departments = useDepartments();
  const form = useForm<FormValues, unknown, Parsed>({
    resolver: zodResolver(formSchema),
    defaultValues: defaults(project, me),
  });
  const objectives = useFieldArray({ control: form.control, name: 'objectives' });
  const errors = form.formState.errors;

  useEffect(() => {
    if (open) form.reset(defaults(project, me));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [open, project]);

  // Choosing a template fills empty descriptive fields from it (the user can still change them).
  useEffect(() => {
    const t = template.data;
    if (!t || project) return;
    const v = form.getValues();
    if (!v.description) form.setValue('description', t.description ?? '');
    if (v.category === NONE && t.category) form.setValue('category', t.category);
    form.setValue('priority', t.priority);
    if (!v.objectives.length)
      form.setValue(
        'objectives',
        t.objectives.map((text) => ({ text })),
      );
    if (Number.isNaN(v.estimatedHours as number) && t.estimatedHours != null)
      form.setValue('estimatedHours', t.estimatedHours);
  }, [template.data, project, form]);

  // Moving the end date later is a slip: the API asks for a reason, kept in the delay history.
  const slipsLater = (end: string) => Boolean(project?.endDate && end && end > project.endDate);
  const watchedEnd = form.watch('endDate');

  const save = useWorkMutation(
    (v: Parsed) => {
      const common = {
        name: v.name,
        description: v.description || undefined,
        category: v.category === NONE ? undefined : v.category,
        departmentId: v.departmentId === NONE ? null : v.departmentId,
        managerId: v.manager!.id,
        ownerId: v.owner?.id ?? null,
        priority: v.priority,
        status: v.status,
        startDate: v.startDate || null,
        endDate: v.endDate || null,
        estimatedHours: v.estimatedHours,
        budget: v.budget,
        objectives: v.objectives.map((o) => o.text).filter(Boolean),
        autoAssign: v.autoAssign,
      };
      return project
        ? work.updateProject(project.id, {
            ...common,
            ...(slipsLater(v.endDate) ? { dateChangeReason: v.dateChangeReason.trim() } : {}),
          })
        : work.createProject({
            ...common,
            key: v.key.toUpperCase(),
            memberIds: v.members.map((m) => m.id),
            ...(templateId !== NONE ? { templateId } : {}),
          });
    },
    { success: (p) => `${p.key} ${project ? 'updated' : 'created'}` },
  );

  const onSubmit = form.handleSubmit(async (v) => {
    if (slipsLater(v.endDate) && v.dateChangeReason.trim().length < 3) {
      form.setError('dateChangeReason', { message: 'Say why the end date is moving later' });
      return;
    }
    const saved = await save.mutateAsync(v);
    onOpenChange(false);
    if (!project) navigate(`/projects/${saved.id}`);
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{project ? `Edit ${project.key}` : 'New project'}</DialogTitle>
          <DialogDescription>
            {project
              ? 'Every change is kept in the project version history.'
              : 'The project key prefixes every task ID, e.g. TRD-42.'}
          </DialogDescription>
        </DialogHeader>
        <form
          id="project-form"
          noValidate
          className="space-y-5"
          onSubmit={(e) => void onSubmit(e).catch(() => undefined)}
        >
          {!project && (templates.data?.length || templateId !== NONE) ? (
            <FormField
              label="Start from a template"
              hint={
                template.data
                  ? `Adds ${template.data.milestoneCount} milestone(s), ${template.data.taskCount} task(s) and ${template.data.customFieldCount} task field(s), dated from the start date (today if empty).`
                  : undefined
              }
            >
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger className="w-full" aria-label="Template">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Blank project</SelectItem>
                  {templates.data?.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} ({t.taskCount} tasks)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-[120px_1fr]">
            <FormField label="Key" required error={errors.key?.message}>
              <Input
                className="font-mono uppercase"
                disabled={Boolean(project)}
                maxLength={6}
                {...form.register('key')}
              />
            </FormField>
            <FormField label="Project name" required error={errors.name?.message}>
              <Input autoFocus {...form.register('name')} />
            </FormField>
          </div>
          <FormField label="Description" error={errors.description?.message}>
            <Textarea rows={3} {...form.register('description')} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Project manager"
              required
              error={errors.manager?.message as string | undefined}
            >
              <Controller
                control={form.control}
                name="manager"
                render={({ field }) => (
                  <UserPicker value={field.value ?? null} onChange={field.onChange} />
                )}
              />
            </FormField>
            <FormField label="Business owner">
              <Controller
                control={form.control}
                name="owner"
                render={({ field }) => (
                  <UserPicker value={field.value ?? null} onChange={field.onChange} />
                )}
              />
            </FormField>
            <FormField label="Department">
              <Controller
                control={form.control}
                name="departmentId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No department</SelectItem>
                      {departments.data?.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
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
                      <SelectItem value={NONE}>Uncategorised</SelectItem>
                      {PROJECT_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>
            <FormField label="Priority">
              <Controller
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRIORITIES.map((p) => (
                        <SelectItem key={p} value={p}>
                          {PRIORITY_LABELS[p]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>
            <FormField label="Status">
              <Controller
                control={form.control}
                name="status"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROJECT_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>
            <FormField label="Start date">
              <Input type="date" {...form.register('startDate')} />
            </FormField>
            <FormField label="End date" error={errors.endDate?.message}>
              <Input type="date" {...form.register('endDate')} />
            </FormField>
            {slipsLater(watchedEnd) ? (
              <FormField
                className="sm:col-span-full"
                label="Why is the end date moving later?"
                required
                hint="Shown in the project's delay history, e.g. Client added two reports."
                error={errors.dateChangeReason?.message}
              >
                <Textarea rows={2} maxLength={500} {...form.register('dateChangeReason')} />
              </FormField>
            ) : null}
            <FormField label="Estimated hours" error={errors.estimatedHours?.message}>
              <Input
                type="number"
                min={0}
                step={1}
                {...form.register('estimatedHours', { valueAsNumber: true })}
              />
            </FormField>
            <FormField label="Budget (INR, optional)" error={errors.budget?.message}>
              <Input
                type="number"
                min={0}
                step={1000}
                {...form.register('budget', { valueAsNumber: true })}
              />
            </FormField>
          </div>
          {!project ? (
            <FormField
              label="Team members"
              hint="The manager and owner are added automatically. Manage roles later on the Team tab."
            >
              <Controller
                control={form.control}
                name="members"
                render={({ field }) => (
                  <MultiUserPicker value={field.value} onChange={field.onChange} />
                )}
              />
            </FormField>
          ) : null}
          <Controller
            control={form.control}
            name="autoAssign"
            render={({ field }) => (
              <label className="flex items-start gap-2 rounded-lg border p-3 text-sm">
                <Checkbox
                  checked={field.value}
                  onCheckedChange={(c) => field.onChange(Boolean(c))}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">Auto-assign new tasks</span>
                  <span className="block text-xs text-muted-foreground">
                    New unassigned tasks go to the best-scoring team member (workload, capacity,
                    skills, availability). If nobody is eligible the task stays unassigned.
                  </span>
                </span>
              </label>
            )}
          />
          <fieldset className="space-y-2">
            <div className="flex items-center justify-between">
              <legend className="text-xs font-medium">Objectives</legend>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => objectives.append({ text: '' })}
              >
                <Plus /> Add objective
              </Button>
            </div>
            {objectives.fields.map((f, i) => (
              <div key={f.id} className="flex gap-2">
                <Input
                  placeholder={`Objective ${i + 1}`}
                  aria-label={`Objective ${i + 1}`}
                  {...form.register(`objectives.${i}.text`)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove objective ${i + 1}`}
                  onClick={() => objectives.remove(i)}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </fieldset>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="project-form" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : project ? 'Save changes' : 'Create project'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
