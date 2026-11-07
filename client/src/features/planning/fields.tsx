import { useState } from 'react';
import {
  describeRecurrence,
  type CustomFieldDef,
  type CustomFieldValue,
  type CustomValues,
  type RecurrenceInput,
} from '@arihant/shared';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatDay } from '@/features/work/format';
import { cn } from '@/lib/utils';
import { useMilestones } from './hooks';

const NONE = '__none__';

/* ---------- Milestone ---------- */

export function MilestoneSelect({
  projectId,
  value,
  onChange,
  disabled,
  className,
  id,
}: {
  projectId: string | undefined;
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
}) {
  const milestones = useMilestones(projectId);
  const items = milestones.data ?? [];
  return (
    <Select
      value={value ?? NONE}
      onValueChange={(v) => onChange(v === NONE ? null : v)}
      disabled={disabled || !projectId}
    >
      <SelectTrigger id={id} size="sm" className={cn('w-full', className)} aria-label="Milestone">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>No milestone</SelectItem>
        {items.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.name} · {formatDay(m.dueDate, 'd MMM')}
            {m.status === 'completed' ? ' (completed)' : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* ---------- Recurrence ---------- */

type Preset = 'none' | 'daily' | 'workdays' | 'weekly' | 'monthly';
const PRESETS: { value: Preset; label: string }[] = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'workdays', label: 'Every working day' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];
const presetOf = (r: RecurrenceInput | null | undefined): Preset =>
  !r ? 'none' : r.frequency === 'daily' ? (r.workdaysOnly ? 'workdays' : 'daily') : r.frequency;

/** Repeat rule editor. Changing any part reports the complete rule (or null). */
export function RecurrenceEditor({
  value,
  onChange,
  disabled,
  hasDueDate,
}: {
  value: RecurrenceInput | null | undefined;
  onChange: (r: RecurrenceInput | null) => void;
  disabled?: boolean;
  hasDueDate: boolean;
}) {
  const preset = presetOf(value);
  const [interval, setInterval] = useState(String(value?.interval ?? 1));
  const build = (p: Preset, n: number, until: string | null | undefined): RecurrenceInput | null =>
    p === 'none'
      ? null
      : {
          frequency: p === 'workdays' ? 'daily' : p,
          workdaysOnly: p === 'workdays',
          interval: Math.min(30, Math.max(1, n || 1)),
          until: until || null,
        };
  const unit = {
    none: '',
    daily: 'day(s)',
    workdays: 'working day(s)',
    weekly: 'week(s)',
    monthly: 'month(s)',
  }[preset];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={preset}
          disabled={disabled}
          onValueChange={(p) => onChange(build(p as Preset, Number(interval), value?.until))}
        >
          <SelectTrigger size="sm" className="w-48" aria-label="Repeat">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRESETS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {preset !== 'none' ? (
          <>
            <span className="text-xs text-muted-foreground">every</span>
            <Input
              type="number"
              min={1}
              max={30}
              className="h-8 w-16"
              aria-label="Repeat interval"
              disabled={disabled}
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
              onBlur={() => onChange(build(preset, Number(interval), value?.until))}
            />
            <span className="text-xs text-muted-foreground">{unit}, until</span>
            <Input
              type="date"
              className="h-8 w-40"
              aria-label="Repeat until"
              disabled={disabled}
              value={value?.until ?? ''}
              onChange={(e) => onChange(build(preset, Number(interval), e.target.value))}
            />
          </>
        ) : null}
      </div>
      {preset !== 'none' && !hasDueDate ? (
        <p className="text-xs text-destructive">
          Set a due date: each new occurrence is scheduled from it.
        </p>
      ) : preset !== 'none' && value ? (
        <p className="text-xs text-muted-foreground">
          {describeRecurrence(
            {
              frequency: value.frequency,
              interval: value.interval ?? 1,
              workdaysOnly: value.workdaysOnly ?? false,
              until: value.until ?? null,
            },
            (d) => formatDay(d),
          )}
          . The next occurrence is created when this one is marked Done.
        </p>
      ) : null}
    </div>
  );
}

/* ---------- Custom fields ---------- */

function FieldInput({
  def,
  value,
  onChange,
  disabled,
  commitOnBlur,
}: {
  def: CustomFieldDef;
  value: CustomFieldValue | undefined;
  onChange: (v: CustomFieldValue) => void;
  disabled?: boolean;
  commitOnBlur?: boolean;
}) {
  const [draft, setDraft] = useState(value === undefined || value === null ? '' : String(value));
  const id = `cf-${def.key}`;
  const label = `${def.label}${def.required ? ' (required)' : ''}`;
  switch (def.type) {
    case 'checkbox':
      return (
        <Checkbox
          id={id}
          aria-label={label}
          checked={value === true}
          disabled={disabled}
          onCheckedChange={(c) => onChange(c === true)}
        />
      );
    case 'select':
      return (
        <Select
          value={typeof value === 'string' ? value : NONE}
          disabled={disabled}
          onValueChange={(v) => onChange(v === NONE ? null : v)}
        >
          <SelectTrigger id={id} size="sm" className="w-full" aria-label={label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Not set</SelectItem>
            {def.options.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    default: {
      const commit = (raw: string) => {
        const v: CustomFieldValue = raw === '' ? null : def.type === 'number' ? Number(raw) : raw;
        if (v !== (value ?? null)) onChange(v);
      };
      return (
        <Input
          id={id}
          aria-label={label}
          className="h-8"
          type={def.type === 'number' ? 'number' : def.type === 'date' ? 'date' : 'text'}
          disabled={disabled}
          value={commitOnBlur ? draft : value === undefined || value === null ? '' : String(value)}
          onChange={(e) =>
            commitOnBlur && def.type !== 'date' ? setDraft(e.target.value) : commit(e.target.value)
          }
          onBlur={(e) => commitOnBlur && def.type !== 'date' && commit(e.target.value)}
        />
      );
    }
  }
}

/**
 * Inputs for a project's custom task fields. In forms (`commitOnBlur` off) every keystroke is
 * reported; in the task panel text and numbers are saved when the field loses focus.
 */
export function CustomFieldInputs({
  defs,
  values,
  onChange,
  errors = {},
  disabled,
  commitOnBlur,
  layout = 'grid',
}: {
  defs: CustomFieldDef[];
  values: CustomValues;
  onChange: (key: string, v: CustomFieldValue) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
  commitOnBlur?: boolean;
  layout?: 'grid' | 'rows';
}) {
  if (!defs.length) return null;
  return (
    <div className={layout === 'grid' ? 'grid gap-3 sm:grid-cols-2' : 'space-y-2.5'}>
      {defs.map((d) => (
        <div
          key={d.key}
          className={
            layout === 'rows' ? 'grid grid-cols-[110px_1fr] items-center gap-2' : 'space-y-1'
          }
        >
          <label htmlFor={`cf-${d.key}`} className="text-xs text-muted-foreground">
            {d.label}
            {d.required ? <span className="text-destructive"> *</span> : null}
          </label>
          <div>
            <FieldInput
              def={d}
              value={values[d.key]}
              onChange={(v) => onChange(d.key, v)}
              disabled={disabled}
              commitOnBlur={commitOnBlur}
            />
            {errors[d.key] ? (
              <p className="mt-1 text-xs text-destructive">{errors[d.key]}</p>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
