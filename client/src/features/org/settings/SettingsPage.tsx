import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import { useEffect, useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { orgSettingsSchema, type OrgSettings } from '@arihant/shared';
import { ErrorState } from '@/components/common/ErrorState';
import { FormField } from '@/components/common/FormField';
import { PageHeader } from '@/components/common/PageHeader';
import { GitIntegrationPanel } from '@/features/integrations/GitIntegration';
import { OutboundPanel } from '@/features/integrations/OutboundPanel';
import { SecuritySettingsPanel } from '@/features/security/SecuritySettingsPanel';
import { AiSettingsPanel } from '@/features/intelligence/ai-kit';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan } from '@/hooks/use-permission';
import * as org from '@/services/api/org';
import { queryKeys } from '@/services/query-keys';
import { useOrgMutation, useSettings } from '../hooks';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-4 border-b py-6 last:border-0 md:grid-cols-[260px_1fr]">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function SettingsPage() {
  const canEdit = useCan('settings:manage', 'org');
  const { data, isLoading, error, refetch } = useSettings();
  const timezones = useMemo(() => {
    try {
      return Intl.supportedValuesOf('timeZone');
    } catch {
      return ['Asia/Kolkata', 'UTC'];
    }
  }, []);
  const form = useForm<OrgSettings>({ resolver: zodResolver(orgSettingsSchema) });
  const errors = form.formState.errors;
  const save = useOrgMutation(org.saveSettings, {
    success: 'Settings saved',
    invalidate: [queryKeys.settings],
  });

  useEffect(() => {
    if (data) {
      const { updatedAt: _u, ...values } = data;
      form.reset(values);
    }
  }, [data, form]);

  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  return (
    <div className="space-y-2">
      <PageHeader
        title="System Settings"
        description={
          data?.updatedAt
            ? `Last changed ${format(new Date(data.updatedAt), 'd MMM yyyy, HH:mm')}`
            : 'Organisation-wide configuration.'
        }
        actions={
          canEdit ? (
            <>
              <Button
                variant="ghost"
                disabled={!form.formState.isDirty || save.isPending}
                onClick={() => form.reset()}
              >
                Discard
              </Button>
              <Button
                type="submit"
                form="settings-form"
                disabled={!form.formState.isDirty || save.isPending}
              >
                {save.isPending ? 'Saving…' : 'Save settings'}
              </Button>
            </>
          ) : null
        }
      />
      {isLoading || !data ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <form
          id="settings-form"
          noValidate
          className="rounded-xl border bg-card px-6"
          onSubmit={form.handleSubmit((v) => save.mutate(v))}
        >
          <fieldset disabled={!canEdit} className="contents">
            <Section title="Organisation" description="Shown in e-mails and reports.">
              <FormField
                label="Organisation name"
                error={errors.organizationName?.message}
                className="sm:col-span-2"
              >
                <Input {...form.register('organizationName')} />
              </FormField>
              <FormField
                label="Timezone"
                error={errors.timezone?.message}
                hint="Day, week and overdue calculations use this zone."
              >
                <Input list="tz-options" {...form.register('timezone')} />
              </FormField>
              <datalist id="tz-options">
                {timezones.map((tz) => (
                  <option key={tz} value={tz} />
                ))}
              </datalist>
              <FormField label="Fiscal year starts in">
                <Controller
                  control={form.control}
                  name="fiscalYearStartMonth"
                  render={({ field }) => (
                    <Select
                      value={String(field.value)}
                      onValueChange={(v) => field.onChange(Number(v))}
                      disabled={!canEdit}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MONTHS.map((m, i) => (
                          <SelectItem key={m} value={String(i + 1)}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </FormField>
            </Section>
            <Section
              title="Working time"
              description="Used for capacity, utilisation and smart assignment."
            >
              <fieldset className="space-y-2 sm:col-span-2">
                <legend className="text-xs font-medium">Working days</legend>
                <Controller
                  control={form.control}
                  name="workingDays"
                  render={({ field }) => (
                    <div className="flex flex-wrap gap-3">
                      {DAYS.map((d, i) => (
                        <label key={d} className="flex items-center gap-1.5 text-sm">
                          <Checkbox
                            disabled={!canEdit}
                            checked={field.value?.includes(i)}
                            onCheckedChange={(c) =>
                              field.onChange(
                                c ? [...field.value, i].sort() : field.value.filter((x) => x !== i),
                              )
                            }
                          />
                          {d}
                        </label>
                      ))}
                    </div>
                  )}
                />
                {errors.workingDays ? (
                  <p className="text-xs text-destructive">{errors.workingDays.message}</p>
                ) : null}
              </fieldset>
              <FormField label="Working hours per day" error={errors.workingHoursPerDay?.message}>
                <Input
                  type="number"
                  step={0.5}
                  min={1}
                  max={24}
                  {...form.register('workingHoursPerDay', { valueAsNumber: true })}
                />
              </FormField>
              <FormField
                label="Default weekly capacity (hours)"
                error={errors.defaultWeeklyCapacityHours?.message}
                hint="Pre-filled for new employees."
              >
                <Input
                  type="number"
                  step={0.5}
                  min={1}
                  max={80}
                  {...form.register('defaultWeeklyCapacityHours', { valueAsNumber: true })}
                />
              </FormField>
            </Section>
          </fieldset>
        </form>
      )}
      <div className="pt-4">
        <AiSettingsPanel />
      </div>
      <div className="pt-4">
        <GitIntegrationPanel />
      </div>
      <div className="pt-4">
        <OutboundPanel />
      </div>
      <div className="pt-4">
        <SecuritySettingsPanel />
      </div>
    </div>
  );
}
