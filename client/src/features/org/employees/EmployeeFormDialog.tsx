import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';
import type { UserDto, UserRef } from '@arihant/shared';
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
import * as org from '@/services/api/org';
import { useDepartments, useOrgMutation, useRoles, useSkills } from '../hooks';
import { UserPicker } from '../components/UserPicker';

const NONE = '__none__';

const formSchema = z.object({
  name: z.string().trim().min(2, 'Enter the full name').max(120),
  email: z.email('Enter a valid email address').trim().max(254),
  employeeId: z
    .string()
    .trim()
    .min(1, 'Enter the employee ID')
    .max(30)
    .regex(/^[A-Za-z0-9._-]+$/, 'Letters, numbers, dot, dash and underscore only'),
  departmentId: z.string(),
  designation: z.string().trim().max(100),
  manager: z.custom<UserRef | null>(),
  roleIds: z.array(z.string()).min(1, 'Select at least one role'),
  weeklyCapacityHours: z.number({ error: 'Enter hours' }).min(0).max(80),
  joinedAt: z.string(),
  phone: z.string().trim().max(30),
  skills: z.array(
    z.object({
      name: z.string().trim().min(1, 'Name required').max(60),
      level: z.number().min(1).max(5),
    }),
  ),
});
type FormValues = z.infer<typeof formSchema>;

function defaults(user?: UserDto): FormValues {
  return {
    name: user?.name ?? '',
    email: user?.email ?? '',
    employeeId: user?.employeeId ?? '',
    departmentId: user?.department?.id ?? NONE,
    designation: user?.designation ?? '',
    manager: user?.manager ?? null,
    roleIds: user?.roles.map((r) => r.id) ?? [],
    weeklyCapacityHours: user?.weeklyCapacityHours ?? 40,
    joinedAt: user?.joinedAt ?? '',
    phone: user?.phone ?? '',
    skills: user?.skills ?? [],
  };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing. */
  user?: UserDto;
}

export function EmployeeFormDialog({ open, onOpenChange, user }: Props) {
  const isEdit = Boolean(user);
  const departments = useDepartments();
  const roles = useRoles(open);
  const skillOptions = useSkills('');
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: defaults(user),
  });
  const skills = useFieldArray({ control: form.control, name: 'skills' });
  const errors = form.formState.errors;

  useEffect(() => {
    if (open) form.reset(defaults(user));
  }, [open, user, form]);

  const create = useOrgMutation(org.createUser, {
    success: (r) =>
      r.inviteSent
        ? `${r.user.name} added. An activation e-mail has been sent.`
        : `${r.user.name} added, but the invite e-mail could not be queued. Use "Resend invite".`,
  });
  const update = useOrgMutation(
    async (v: FormValues) => {
      const updated = await org.updateUser(user!.id, {
        name: v.name,
        email: v.email,
        employeeId: v.employeeId,
        departmentId: v.departmentId === NONE ? null : v.departmentId,
        designation: v.designation || undefined,
        managerId: v.manager?.id ?? null,
        weeklyCapacityHours: v.weeklyCapacityHours,
        joinedAt: v.joinedAt || undefined,
        phone: v.phone || undefined,
        skills: v.skills,
      });
      const current = [...user!.roles.map((r) => r.id)].sort().join();
      if ([...v.roleIds].sort().join() !== current) return org.setUserRoles(user!.id, v.roleIds);
      return updated;
    },
    { success: (u) => `${u.name} updated` },
  );
  const pending = create.isPending || update.isPending;

  const onSubmit = form.handleSubmit(async (v) => {
    if (isEdit) {
      await update.mutateAsync(v);
    } else {
      await create.mutateAsync({
        name: v.name,
        email: v.email,
        employeeId: v.employeeId,
        departmentId: v.departmentId === NONE ? null : v.departmentId,
        designation: v.designation || undefined,
        managerId: v.manager?.id ?? null,
        roleIds: v.roleIds,
        weeklyCapacityHours: v.weeklyCapacityHours,
        joinedAt: v.joinedAt || undefined,
        phone: v.phone || undefined,
        skills: v.skills,
      });
    }
    onOpenChange(false);
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${user!.name}` : 'Add employee'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Changes are recorded in the audit log.'
              : 'The employee receives an e-mail to set their own password. No temporary passwords are created.'}
          </DialogDescription>
        </DialogHeader>

        <form
          id="employee-form"
          noValidate
          onSubmit={(e) => void onSubmit(e).catch(() => undefined)}
          className="space-y-5"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Full name" required error={errors.name?.message}>
              <Input autoFocus {...form.register('name')} />
            </FormField>
            <FormField label="Work e-mail" required error={errors.email?.message}>
              <Input type="email" {...form.register('email')} />
            </FormField>
            <FormField label="Employee ID" required error={errors.employeeId?.message}>
              <Input className="font-mono" {...form.register('employeeId')} />
            </FormField>
            <FormField label="Designation" error={errors.designation?.message}>
              <Input placeholder="e.g. QA Engineer" {...form.register('designation')} />
            </FormField>
            <FormField label="Department">
              <Controller
                control={form.control}
                name="departmentId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select department" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No department</SelectItem>
                      {departments.data?.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name} ({d.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>
            <FormField label="Reporting manager">
              <Controller
                control={form.control}
                name="manager"
                render={({ field }) => (
                  <UserPicker value={field.value} onChange={field.onChange} excludeId={user?.id} />
                )}
              />
            </FormField>
            <FormField
              label="Weekly capacity (hours)"
              error={errors.weeklyCapacityHours?.message}
              hint="Used by smart assignment"
            >
              <Input
                type="number"
                min={0}
                max={80}
                step={0.5}
                {...form.register('weeklyCapacityHours', { valueAsNumber: true })}
              />
            </FormField>
            <FormField label="Joining date" error={errors.joinedAt?.message}>
              <Input type="date" {...form.register('joinedAt')} />
            </FormField>
            <FormField label="Phone" error={errors.phone?.message}>
              <Input type="tel" {...form.register('phone')} />
            </FormField>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-xs font-medium">
              Roles <span className="text-destructive">*</span>
            </legend>
            {roles.isLoading ? (
              <p className="text-xs text-muted-foreground">Loading roles…</p>
            ) : (
              <Controller
                control={form.control}
                name="roleIds"
                render={({ field }) => (
                  <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-3">
                    {roles.data?.map((r) => {
                      const checked = field.value.includes(r.id);
                      return (
                        <label key={r.id} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(c) =>
                              field.onChange(
                                c
                                  ? [...field.value, r.id]
                                  : field.value.filter((id) => id !== r.id),
                              )
                            }
                          />
                          {r.name}
                        </label>
                      );
                    })}
                  </div>
                )}
              />
            )}
            {errors.roleIds ? (
              <p className="text-xs text-destructive">{errors.roleIds.message}</p>
            ) : null}
          </fieldset>

          <fieldset className="space-y-2">
            <div className="flex items-center justify-between">
              <legend className="text-xs font-medium">Skills</legend>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => skills.append({ name: '', level: 3 })}
              >
                <Plus /> Add skill
              </Button>
            </div>
            {skills.fields.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No skills added. Skills drive smart assignment matching.
              </p>
            ) : null}
            <datalist id="skill-options">
              {skillOptions.data?.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            {skills.fields.map((f, i) => (
              <div key={f.id} className="flex items-start gap-2">
                <div className="flex-1">
                  <Input
                    list="skill-options"
                    placeholder="Skill name"
                    aria-label={`Skill ${i + 1} name`}
                    {...form.register(`skills.${i}.name`)}
                  />
                  {errors.skills?.[i]?.name ? (
                    <p className="mt-1 text-xs text-destructive">
                      {errors.skills[i]?.name?.message}
                    </p>
                  ) : null}
                </div>
                <Controller
                  control={form.control}
                  name={`skills.${i}.level`}
                  render={({ field }) => (
                    <Select
                      value={String(field.value)}
                      onValueChange={(v) => field.onChange(Number(v))}
                    >
                      <SelectTrigger className="w-36" aria-label={`Skill ${i + 1} level`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {['Beginner', 'Basic', 'Proficient', 'Advanced', 'Expert'].map(
                          (label, idx) => (
                            <SelectItem key={label} value={String(idx + 1)}>
                              {idx + 1} · {label}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                  )}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove skill ${i + 1}`}
                  onClick={() => skills.remove(i)}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </fieldset>
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="employee-form" disabled={pending}>
            {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Add employee'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
