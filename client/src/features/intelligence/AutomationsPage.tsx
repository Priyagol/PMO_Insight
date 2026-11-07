import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { formatDistanceToNow } from 'date-fns';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleSlash,
  FlaskConical,
  Pause,
  Plus,
  Trash2,
  Workflow,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import {
  AUTOMATION_ACTIONS,
  AUTOMATION_ACTION_LABELS,
  AUTOMATION_TRIGGERS,
  AUTOMATION_TRIGGER_LABELS,
  CONDITION_FIELDS,
  CONDITION_OPS,
  CONDITION_OP_LABELS,
  NOTIFY_TARGETS,
  PRIORITIES,
  PRIORITY_LABELS,
  TASK_ACTIONS,
  TRIGGER_FIELDS,
  createAutomationSchema,
  describeSchedule,
  WEEKDAY_LABELS,
  type AutomationAction,
  type AutomationActionType,
  type AutomationRuleDto,
  type AutomationRunDto,
  type AutomationRunStatus,
  type AutomationSchedule,
  type AutomationTestResultDto,
  type AutomationTrigger,
  type Condition,
  type ConditionField,
  type ConditionOp,
  type UserRef,
} from '@arihant/shared';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { DataTable } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { FormField } from '@/components/common/FormField';
import { PageHeader } from '@/components/common/PageHeader';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCollabMutation } from '@/features/collaboration/hooks';
import { UserPicker } from '@/features/org/components/UserPicker';
import { useProjects, useTasks } from '@/features/work/hooks';
import { useCan } from '@/hooks/use-permission';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { cn } from '@/lib/utils';
import * as api from '@/services/api/intelligence';

const ORG = '__org__';
const keys = {
  rules: ['automations', 'rules'] as const,
  runs: (q: object) => ['automations', 'runs', q] as const,
};

const RUN_STATUS: Record<AutomationRunStatus, { label: string; icon: LucideIcon; color: string }> =
  {
    success: { label: 'Succeeded', icon: CheckCircle2, color: 'var(--status-good)' },
    partial: { label: 'Partly failed', icon: AlertTriangle, color: 'var(--status-warning)' },
    failed: { label: 'Failed', icon: XCircle, color: 'var(--status-critical)' },
    throttled: { label: 'Throttled', icon: Pause, color: 'var(--status-serious)' },
    loop_blocked: { label: 'Loop stopped', icon: Ban, color: 'var(--status-serious)' },
  };
function RunStatus({ status }: { status?: AutomationRunStatus }) {
  if (!status) return <span className="text-xs text-muted-foreground">Never run</span>;
  const s = RUN_STATUS[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
      <s.icon className="size-3.5" style={{ color: s.color }} aria-hidden />
      {s.label}
    </span>
  );
}

/* ============================ Rule editor ============================ */

const taskless = (t: AutomationTrigger) => t === 'risk.critical' || t === 'project.status_changed';

function defaultAction(type: AutomationActionType): AutomationAction {
  switch (type) {
    case 'notify':
      return { type, to: ['assignee'], message: '' };
    case 'set_priority':
      return { type, priority: 'high' };
    case 'add_tag':
      return { type, tag: '' };
    case 'add_comment':
      return { type, text: '' };
    case 'assign_user':
      return { type, userId: '' };
    case 'smart_assign':
      return { type };
    case 'create_task':
      return { type, title: '', priority: 'medium', dueInDays: null, assignTo: 'none' };
  }
}

/** A new condition starts with a real value for its field, so what is shown is what is saved. */
function newCondition(field: ConditionField): Condition {
  const def = CONDITION_FIELDS[field];
  const value =
    def.type === 'boolean'
      ? true
      : def.type === 'enum' && 'options' in def
        ? (def.options[0] ?? null)
        : null;
  return { field, op: 'eq', value };
}

function ValueInput({ c, onChange }: { c: Condition; onChange: (v: Condition['value']) => void }) {
  const def = CONDITION_FIELDS[c.field];
  if (c.op === 'is_empty' || c.op === 'not_empty') return null;
  const multi = c.op === 'in' || c.op === 'nin';
  if (def.type === 'boolean')
    return (
      <Select value={String(c.value ?? true)} onValueChange={(v) => onChange(v === 'true')}>
        <SelectTrigger size="sm" className="w-24" aria-label="Value">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">Yes</SelectItem>
          <SelectItem value="false">No</SelectItem>
        </SelectContent>
      </Select>
    );
  if (def.type === 'enum' && !multi)
    return (
      <Select value={typeof c.value === 'string' ? c.value : ''} onValueChange={onChange}>
        <SelectTrigger size="sm" className="w-36" aria-label="Value">
          <SelectValue placeholder="Value" />
        </SelectTrigger>
        <SelectContent>
          {'options' in def &&
            def.options.map((o) => (
              <SelectItem key={o} value={o}>
                {o.replace('_', ' ')}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    );
  return (
    <Input
      className="h-8 w-44"
      aria-label="Value"
      type={def.type === 'number' ? 'number' : 'text'}
      placeholder={multi ? 'comma, separated' : 'Value'}
      value={Array.isArray(c.value) ? c.value.join(', ') : c.value == null ? '' : String(c.value)}
      onChange={(e) =>
        onChange(
          multi
            ? e.target.value
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean)
            : def.type === 'number'
              ? e.target.value === ''
                ? null
                : Number(e.target.value)
              : e.target.value,
        )
      }
    />
  );
}

function ActionEditor({
  a,
  onChange,
  i,
}: {
  a: AutomationAction;
  onChange: (a: AutomationAction) => void;
  i: number;
}) {
  const [person, setPerson] = useState<UserRef | null>(null);
  switch (a.type) {
    case 'notify':
      return (
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {NOTIFY_TARGETS.filter((t) => t !== 'users').map((t) => (
            <label key={t} className="flex items-center gap-1 text-xs">
              <Checkbox
                checked={a.to.includes(t)}
                onCheckedChange={(c) =>
                  onChange({ ...a, to: c === true ? [...a.to, t] : a.to.filter((x) => x !== t) })
                }
              />
              {t.replace('_', ' ')}
            </label>
          ))}
          <Input
            className="h-8 min-w-56 flex-1"
            aria-label={`Action ${i + 1} message`}
            placeholder="Message"
            value={a.message}
            onChange={(e) => onChange({ ...a, message: e.target.value })}
          />
        </div>
      );
    case 'set_priority':
      return (
        <Select
          value={a.priority}
          onValueChange={(v) => onChange({ ...a, priority: v as typeof a.priority })}
        >
          <SelectTrigger size="sm" className="w-32" aria-label={`Action ${i + 1} priority`}>
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
      );
    case 'add_tag':
      return (
        <Input
          className="h-8 w-44"
          aria-label={`Action ${i + 1} tag`}
          placeholder="Tag"
          value={a.tag}
          onChange={(e) => onChange({ ...a, tag: e.target.value })}
        />
      );
    case 'add_comment':
      return (
        <Input
          className="h-8 flex-1"
          aria-label={`Action ${i + 1} comment`}
          placeholder="Comment text"
          value={a.text}
          onChange={(e) => onChange({ ...a, text: e.target.value })}
        />
      );
    case 'assign_user':
      return (
        <div className="min-w-56 flex-1">
          <UserPicker
            value={person}
            placeholder={a.userId ? 'Keep the chosen person' : 'Choose a person'}
            onChange={(u) => {
              setPerson(u);
              onChange({ ...a, userId: u?.id ?? '' });
            }}
          />
        </div>
      );
    case 'smart_assign':
      return (
        <span className="text-xs text-muted-foreground">
          Best-scoring eligible person (skills, workload, capacity)
        </span>
      );
    case 'create_task':
      return (
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <Input
            className="h-8 min-w-48 flex-1"
            aria-label={`Action ${i + 1} task title`}
            placeholder="Task title"
            value={a.title}
            onChange={(e) => onChange({ ...a, title: e.target.value })}
          />
          <Input
            className="h-8 w-24"
            type="number"
            min={0}
            aria-label={`Action ${i + 1} due in days`}
            placeholder="Due in days"
            value={a.dueInDays ?? ''}
            onChange={(e) =>
              onChange({ ...a, dueInDays: e.target.value === '' ? null : Number(e.target.value) })
            }
          />
          <Select
            value={a.assignTo}
            onValueChange={(v) => onChange({ ...a, assignTo: v as typeof a.assignTo })}
          >
            <SelectTrigger size="sm" className="w-44" aria-label={`Action ${i + 1} assign to`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Unassigned</SelectItem>
              <SelectItem value="same_assignee">Same assignee</SelectItem>
              <SelectItem value="project_manager">Project manager</SelectItem>
            </SelectContent>
          </Select>
        </div>
      );
  }
}

/* ============================ Rule draft (shared by dialog and Workflow Builder) ============================ */

export interface RuleDraft {
  rule?: AutomationRuleDto;
  name: string;
  setName: (v: string) => void;
  scope: string;
  setScope: (v: string) => void;
  trigger: AutomationTrigger;
  changeTrigger: (t: AutomationTrigger) => void;
  schedule: AutomationSchedule;
  setSchedule: (s: AutomationSchedule) => void;
  match: 'all' | 'any';
  setMatch: (m: 'all' | 'any') => void;
  conditions: Condition[];
  setConditions: React.Dispatch<React.SetStateAction<Condition[]>>;
  actions: AutomationAction[];
  setActions: React.Dispatch<React.SetStateAction<AutomationAction[]>>;
  error: string | null;
  saving: boolean;
  submit: (onDone?: () => void) => void;
}

export function useRuleDraft(rule?: AutomationRuleDto): RuleDraft {
  const [name, setName] = useState(rule?.name ?? '');
  const [scope, setScope] = useState(rule ? (rule.project?.id ?? ORG) : '');
  const [trigger, setTrigger] = useState<AutomationTrigger>(rule?.trigger ?? 'task.created');
  const [schedule, setSchedule] = useState<AutomationSchedule>(
    rule?.schedule ?? { frequency: 'daily', weekday: null, hour: 9 },
  );
  const [match, setMatch] = useState<'all' | 'any'>(rule?.conditions.match ?? 'all');
  const [conditions, setConditions] = useState<Condition[]>(rule?.conditions.conditions ?? []);
  const [actions, setActions] = useState<AutomationAction[]>(
    rule?.actions ?? [defaultAction('add_tag')],
  );
  const [error, setError] = useState<string | null>(null);
  const save = useCollabMutation(
    (body: Parameters<typeof api.createAutomation>[0]) =>
      rule
        ? api.updateAutomation(rule.id, {
            name: body.name,
            trigger: body.trigger,
            conditions: body.conditions,
            actions: body.actions,
            schedule: body.schedule,
          })
        : api.createAutomation(body),
    { success: rule ? 'Automation saved' : 'Automation created' },
  );
  const changeTrigger = (t: AutomationTrigger) => {
    setTrigger(t);
    setConditions((cs) => cs.filter((c) => TRIGGER_FIELDS[t].includes(c.field)));
    if (taskless(t)) setActions((as) => as.filter((a) => !TASK_ACTIONS.includes(a.type)));
  };
  const submit = (onDone?: () => void) => {
    const body = {
      name,
      projectId: scope === ORG ? null : scope || null,
      trigger,
      conditions: { match, conditions },
      actions,
      schedule: trigger === 'schedule' ? schedule : null,
    };
    if (!scope) return setError('Choose a project (or organisation-wide)');
    const parsed = createAutomationSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      return setError(`${issue.path.join(' › ') || 'Rule'}: ${issue.message}`);
    }
    setError(null);
    save.mutate(body, { onSuccess: () => onDone?.() });
  };
  return {
    rule,
    name,
    setName,
    scope,
    setScope,
    trigger,
    changeTrigger,
    schedule,
    setSchedule,
    match,
    setMatch,
    conditions,
    setConditions,
    actions,
    setActions,
    error,
    saving: save.isPending,
    submit,
  };
}

function ScheduleFields({ d }: { d: RuleDraft }) {
  const s = d.schedule;
  return (
    <div
      className="flex flex-wrap items-center gap-2 text-sm sm:col-span-2"
      role="group"
      aria-label="Schedule"
    >
      <Select
        value={s.frequency}
        onValueChange={(v) =>
          d.setSchedule({
            ...s,
            frequency: v as 'daily' | 'weekly',
            weekday: v === 'weekly' ? (s.weekday ?? 1) : null,
          })
        }
      >
        <SelectTrigger size="sm" className="w-32" aria-label="Frequency">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="daily">Every day</SelectItem>
          <SelectItem value="weekly">Every week</SelectItem>
        </SelectContent>
      </Select>
      {s.frequency === 'weekly' ? (
        <Select
          value={String(s.weekday ?? 1)}
          onValueChange={(v) => d.setSchedule({ ...s, weekday: Number(v) })}
        >
          <SelectTrigger size="sm" className="w-36" aria-label="Weekday">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4, 5, 6, 7].map((w) => (
              <SelectItem key={w} value={String(w)}>
                {WEEKDAY_LABELS[w]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      <span className="text-muted-foreground">at</span>
      <Select
        value={String(s.hour)}
        onValueChange={(v) => d.setSchedule({ ...s, hour: Number(v) })}
      >
        <SelectTrigger size="sm" className="w-24" aria-label="Hour">
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
      <span className="text-xs text-muted-foreground">
        Organisation time. Each open task in scope is checked against the conditions (up to 200 per
        run).
      </span>
    </div>
  );
}

/** The form part of the rule editor. */
export function RuleFields({ d }: { d: RuleDraft }) {
  const orgWide = useCan('automation:manage', 'org');
  const projects = useProjects({ limit: 100, archived: 'false' });
  const fields = TRIGGER_FIELDS[d.trigger];
  const actionTypes = AUTOMATION_ACTIONS.filter(
    (t) => !(taskless(d.trigger) && TASK_ACTIONS.includes(t)),
  );
  const { conditions, setConditions, actions, setActions } = d;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Name" required>
          <Input value={d.name} onChange={(e) => d.setName(e.target.value)} maxLength={120} />
        </FormField>
        <FormField label="Applies to" required>
          <Select value={d.scope} onValueChange={d.setScope} disabled={Boolean(d.rule)}>
            <SelectTrigger className="w-full" aria-label="Applies to">
              <SelectValue placeholder="Choose a project" />
            </SelectTrigger>
            <SelectContent>
              {orgWide ? (
                <SelectItem value={ORG}>All projects (organisation-wide)</SelectItem>
              ) : null}
              {projects.data?.items
                .filter((p) => p.can.update)
                .map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.key} · {p.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="When" className="sm:col-span-2">
          <Select value={d.trigger} onValueChange={(v) => d.changeTrigger(v as AutomationTrigger)}>
            <SelectTrigger className="w-full" aria-label="Trigger">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUTOMATION_TRIGGERS.map((t) => (
                <SelectItem key={t} value={t}>
                  {AUTOMATION_TRIGGER_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        {d.trigger === 'schedule' ? <ScheduleFields d={d} /> : null}
      </div>

      <section className="space-y-2" aria-label="Conditions">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">If</span>
          <Select value={d.match} onValueChange={(v) => d.setMatch(v as 'all' | 'any')}>
            <SelectTrigger size="sm" className="w-24" aria-label="Match">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">all</SelectItem>
              <SelectItem value="any">any</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-muted-foreground">
            of these are true {conditions.length ? '' : '(no conditions: always)'}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            disabled={conditions.length >= 10}
            onClick={() => setConditions((cs) => [...cs, newCondition(fields[0]!)])}
          >
            <Plus /> Condition
          </Button>
        </div>
        {conditions.map((c, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
            <Select
              value={c.field}
              onValueChange={(v) =>
                setConditions((cs) =>
                  cs.map((x, j) => (j === i ? newCondition(v as ConditionField) : x)),
                )
              }
            >
              <SelectTrigger size="sm" className="w-52" aria-label={`Condition ${i + 1} field`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {fields.map((f) => (
                  <SelectItem key={f} value={f}>
                    {CONDITION_FIELDS[f].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={c.op}
              onValueChange={(v) =>
                setConditions((cs) =>
                  cs.map((x, j) => (j === i ? { ...x, op: v as ConditionOp } : x)),
                )
              }
            >
              <SelectTrigger size="sm" className="w-32" aria-label={`Condition ${i + 1} operator`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONDITION_OPS.map((o) => (
                  <SelectItem key={o} value={o}>
                    {CONDITION_OP_LABELS[o]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ValueInput
              c={c}
              onChange={(value) =>
                setConditions((cs) => cs.map((x, j) => (j === i ? { ...x, value } : x)))
              }
            />
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto size-7"
              aria-label={`Remove condition ${i + 1}`}
              onClick={() => setConditions((cs) => cs.filter((_, j) => j !== i))}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </section>

      <section className="space-y-2" aria-label="Actions">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">Then</span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            disabled={actions.length >= 5}
            onClick={() => setActions((as) => [...as, defaultAction(actionTypes[0]!)])}
          >
            <Plus /> Action
          </Button>
        </div>
        {actions.map((a, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
            <Select
              value={a.type}
              onValueChange={(v) =>
                setActions((as) =>
                  as.map((x, j) => (j === i ? defaultAction(v as AutomationActionType) : x)),
                )
              }
            >
              <SelectTrigger size="sm" className="w-52" aria-label={`Action ${i + 1} type`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {actionTypes.map((t) => (
                  <SelectItem key={t} value={t}>
                    {AUTOMATION_ACTION_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ActionEditor
              i={i}
              a={a}
              onChange={(next) => setActions((as) => as.map((x, j) => (j === i ? next : x)))}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={`Remove action ${i + 1}`}
              disabled={actions.length === 1}
              onClick={() => setActions((as) => as.filter((_, j) => j !== i))}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          Safety: a chain of automations stops after 3 steps, each rule runs at most 100 times an
          hour, and each event is handled once.
        </p>
      </section>
      {d.error ? (
        <p className="text-sm text-destructive" role="alert">
          {d.error}
        </p>
      ) : null}
    </div>
  );
}

const describeCondition = (c: Condition) => {
  const v =
    c.op === 'is_empty' || c.op === 'not_empty'
      ? ''
      : ` ${Array.isArray(c.value) ? c.value.join(', ') : String(c.value ?? '…')}`;
  return `${CONDITION_FIELDS[c.field].label} ${CONDITION_OP_LABELS[c.op]}${v}`;
};

/** Visual map of a rule: trigger → conditions → actions, updated live while editing. */
function FlowNode({
  kind,
  children,
  tone,
}: {
  kind: string;
  children: React.ReactNode;
  tone: string;
}) {
  return (
    <li className="relative w-full max-w-sm">
      <div className={cn('rounded-xl border-2 bg-card px-4 py-3 shadow-xs', tone)}>
        <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          {kind}
        </p>
        <div className="mt-0.5 text-sm">{children}</div>
      </div>
    </li>
  );
}

function FlowArrow({ label }: { label?: string }) {
  return (
    <li aria-hidden className="flex flex-col items-center text-xs text-muted-foreground">
      <span className="h-4 w-px bg-border" />
      {label ? <span className="rounded bg-muted px-1.5">{label}</span> : null}
      <span className="h-4 w-px bg-border" />
      <span className="-mt-1 text-border">▼</span>
    </li>
  );
}

export function RuleFlow({ d }: { d: RuleDraft }) {
  return (
    <ol className="flex flex-col items-center" aria-label="Rule diagram">
      <FlowNode kind="When" tone="border-primary/50">
        {AUTOMATION_TRIGGER_LABELS[d.trigger]}
        {d.trigger === 'schedule' ? (
          <span className="block text-xs text-muted-foreground">
            {describeSchedule(d.schedule)}
          </span>
        ) : null}
      </FlowNode>
      <FlowArrow />
      <FlowNode kind={`If ${d.match} of`} tone="border-status-warning/60">
        {d.conditions.length ? (
          <ul className="list-disc pl-4">
            {d.conditions.map((c, i) => (
              <li key={i}>{describeCondition(c)}</li>
            ))}
          </ul>
        ) : (
          <span className="text-muted-foreground">Always (no conditions)</span>
        )}
      </FlowNode>
      {d.actions.map((a, i) => (
        <React.Fragment key={i}>
          <FlowArrow label={i === 0 ? 'then' : 'and'} />
          <FlowNode kind={`Action ${i + 1}`} tone="border-status-good/60">
            {describeActionText(a)}
          </FlowNode>
        </React.Fragment>
      ))}
    </ol>
  );
}

function describeActionText(a: AutomationAction): string {
  switch (a.type) {
    case 'notify':
      return `Notify ${a.to.join(', ').replaceAll('_', ' ') || '…'}: “${a.message || '…'}”`;
    case 'set_priority':
      return `Set priority to ${PRIORITY_LABELS[a.priority]}`;
    case 'add_tag':
      return `Add tag “${a.tag || '…'}”`;
    case 'add_comment':
      return `Comment: “${a.text || '…'}”`;
    case 'assign_user':
      return a.userId ? 'Assign to the chosen person' : 'Assign to … (choose a person)';
    case 'smart_assign':
      return 'Smart-assign to the best-scoring eligible person';
    case 'create_task':
      return `Create task “${a.title || '…'}”${a.dueInDays != null ? `, due in ${a.dueInDays} day(s)` : ''}`;
  }
}

/** Mounted only while open. */
function RuleDialog({ rule, onClose }: { rule?: AutomationRuleDto; onClose: () => void }) {
  const d = useRuleDraft(rule);
  return (
    <Dialog open onOpenChange={(o) => !o && !d.saving && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{rule ? 'Edit automation' : 'New automation'}</DialogTitle>
          <DialogDescription>
            When <strong>trigger</strong> happens and the <strong>conditions</strong> match, run the{' '}
            <strong>actions</strong>. Actions run with your permissions; saving makes you the rule’s
            owner.
          </DialogDescription>
        </DialogHeader>
        <RuleFields d={d} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={d.saving}>
            Cancel
          </Button>
          <Button disabled={d.saving} onClick={() => d.submit(onClose)}>
            {rule ? 'Save' : 'Create automation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================ Dry run ============================ */

function TestDialog({ rule, onClose }: { rule: AutomationRuleDto; onClose: () => void }) {
  const [q, setQ] = useState('');
  const search = useDebouncedValue(q, 250);
  const tasks = useTasks({
    q: search || undefined,
    limit: 10,
    ...(rule.project ? { projectId: rule.project.id } : {}),
  });
  const [result, setResult] = useState<AutomationTestResultDto | null>(null);
  const test = useCollabMutation((taskId: string) => api.testAutomation(rule.id, taskId));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Test “{rule.name}”</DialogTitle>
          <DialogDescription>
            Checks the conditions against a task as it is now. Nothing is changed.
          </DialogDescription>
        </DialogHeader>
        <Input
          placeholder="Search tasks by key or title"
          aria-label="Search tasks"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <ul className="max-h-40 divide-y overflow-y-auto rounded-lg border">
          {(tasks.data?.items ?? []).map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => test.mutate(t.id, { onSuccess: setResult })}
              >
                <span className="font-mono text-xs">{t.key}</span> {t.title}
              </button>
            </li>
          ))}
        </ul>
        {result ? (
          <section className="space-y-2 text-sm" aria-label="Test result">
            <p className="font-medium">
              {result.matched ? 'The conditions match.' : 'The conditions do not match.'}
            </p>
            {result.checks.length ? (
              <ul className="space-y-0.5 text-xs">
                {result.checks.map((c, i) => (
                  <li key={i}>
                    {c.passed ? '✓' : '✗'}{' '}
                    {CONDITION_FIELDS[c.field as ConditionField]?.label ?? c.field}{' '}
                    {CONDITION_OP_LABELS[c.op]} {JSON.stringify(c.expected)} — actual{' '}
                    {JSON.stringify(c.actual)}
                  </li>
                ))}
              </ul>
            ) : null}
            {result.wouldRun.length ? (
              <div>
                <p className="text-xs font-medium">Would run:</p>
                <ul className="list-disc pl-5 text-xs">
                  {result.wouldRun.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/* ============================ Page ============================ */

function RulesTab() {
  const rules = useQuery({ queryKey: keys.rules, queryFn: () => api.fetchAutomations() });
  const [editing, setEditing] = useState<AutomationRuleDto | 'new' | null>(null);
  const [testing, setTesting] = useState<AutomationRuleDto | null>(null);
  const [deleting, setDeleting] = useState<AutomationRuleDto | null>(null);
  const toggle = useCollabMutation(
    (r: AutomationRuleDto) => api.updateAutomation(r.id, { enabled: !r.enabled }),
    {
      success: (r) => (r.enabled ? `"${r.name}" turned on` : `"${r.name}" turned off`),
    },
  );
  const remove = useCollabMutation((id: string) => api.deleteAutomation(id), {
    success: 'Automation deleted',
  });

  if (rules.error) return <ErrorState error={rules.error} onRetry={() => void rules.refetch()} />;
  if (!rules.data) return <Skeleton className="h-48" />;
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setEditing('new')}>
          <Plus /> New automation
        </Button>
      </div>
      {rules.data.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <EmptyState
            icon={Workflow}
            title="No automations yet"
            description="For example: when a critical task is created, tag it and notify the project manager."
          />
        </div>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {rules.data.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <Checkbox
                aria-label={r.enabled ? `Turn off ${r.name}` : `Turn on ${r.name}`}
                checked={r.enabled}
                disabled={!r.canEdit || toggle.isPending}
                onCheckedChange={() => toggle.mutate(r)}
              />
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                disabled={!r.canEdit}
                onClick={() => setEditing(r)}
              >
                <span className="block truncate font-medium">
                  {r.name}
                  {!r.enabled ? (
                    <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
                      <CircleSlash className="size-3" aria-hidden /> Off
                    </span>
                  ) : null}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {r.project ? r.project.key : 'All projects'} ·{' '}
                  {r.schedule ? describeSchedule(r.schedule) : AUTOMATION_TRIGGER_LABELS[r.trigger]}{' '}
                  · {r.conditions.conditions.length} condition(s) ·{' '}
                  {r.actions.map((a) => AUTOMATION_ACTION_LABELS[a.type]).join(', ')} · owner{' '}
                  {r.owner?.name ?? '—'}
                </span>
              </button>
              <span className="w-40 text-right">
                <RunStatus status={r.lastStatus} />
                <span className="block text-xs text-muted-foreground">
                  {r.runCount} run(s)
                  {r.lastRunAt
                    ? ` · ${formatDistanceToNow(new Date(r.lastRunAt), { addSuffix: true })}`
                    : ''}
                </span>
              </span>
              {r.trigger.startsWith('task.') || r.trigger === 'schedule' ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={`Test ${r.name}`}
                  onClick={() => setTesting(r)}
                >
                  <FlaskConical />
                </Button>
              ) : null}
              {r.canEdit ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={`Delete ${r.name}`}
                  onClick={() => setDeleting(r)}
                >
                  <Trash2 />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <RuleDialog
          rule={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {testing ? <TestDialog rule={testing} onClose={() => setTesting(null)} /> : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete "${deleting?.name ?? ''}"?`}
        description="The rule stops immediately. Its run history is kept for 90 days."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (deleting) await remove.mutateAsync(deleting.id);
        }}
      />
    </div>
  );
}

function RunsTab() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>('any');
  const q = {
    page,
    limit: 25,
    status: status === 'any' ? undefined : (status as AutomationRunStatus),
  };
  const runs = useQuery({ queryKey: keys.runs(q), queryFn: () => api.fetchAutomationRuns(q) });
  const columns = useMemo<ColumnDef<AutomationRunDto, unknown>[]>(
    () => [
      {
        header: 'When',
        cell: ({ row: { original: r } }) => (
          <span className="text-xs">{new Date(r.createdAt).toLocaleString('en-IN')}</span>
        ),
      },
      { header: 'Rule', cell: ({ row: { original: r } }) => r.ruleName },
      {
        header: 'Subject',
        cell: ({ row: { original: r } }) => <span className="text-xs">{r.subject ?? '—'}</span>,
      },
      { header: 'Result', cell: ({ row: { original: r } }) => <RunStatus status={r.status} /> },
      {
        header: 'Details',
        cell: ({ row: { original: r } }) => (
          <span className="text-xs text-muted-foreground">
            {r.error ?? r.actions.map((a) => `${a.ok ? '✓' : '✗'} ${a.detail}`).join(' · ')}
          </span>
        ),
      },
    ],
    [],
  );
  return (
    <div className="space-y-3">
      <Select
        value={status}
        onValueChange={(v) => {
          setStatus(v);
          setPage(1);
        }}
      >
        <SelectTrigger size="sm" className="w-44" aria-label="Filter by result">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="any">All results</SelectItem>
          {(Object.keys(RUN_STATUS) as AutomationRunStatus[]).map((s) => (
            <SelectItem key={s} value={s}>
              {RUN_STATUS[s].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <DataTable
        columns={columns}
        data={runs.data?.items}
        meta={runs.data?.meta}
        onPageChange={setPage}
        isLoading={runs.isLoading}
        error={runs.error}
        onRetry={() => void runs.refetch()}
        getRowId={(r) => r.id}
        empty={
          <EmptyState
            compact
            icon={Workflow}
            title="No runs yet"
            description="Runs appear when a rule’s conditions match."
          />
        }
      />
    </div>
  );
}

export function AutomationsPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Automation Center"
        description="Rules that react to work as it happens. Every run is recorded."
      />
      <Tabs defaultValue="rules">
        <TabsList>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="runs">Run history</TabsTrigger>
        </TabsList>
        <TabsContent value="rules" className="mt-4">
          <RulesTab />
        </TabsContent>
        <TabsContent value="runs" className="mt-4">
          <RunsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
