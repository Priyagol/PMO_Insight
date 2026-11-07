import { useState } from 'react';
import { AVAILABILITY_TYPES, type AvailabilityDto } from '@arihant/shared';
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
import { cn } from '@/lib/utils';
import * as t from '@/services/api/tracking';
import { useTrackMutation } from './hooks';

const TYPE_LABELS: Record<(typeof AVAILABILITY_TYPES)[number], string> = {
  leave: 'Leave (unavailable)',
  partial: 'Partial availability',
  training: 'Training',
  other: 'Other absence',
};

const AVAILABILITY_STATUS_TONE: Record<AvailabilityDto['status'], string> = {
  pending: 'bg-info/10 text-info',
  approved: 'bg-success/10 text-success',
  rejected: 'bg-destructive/10 text-destructive',
  cancelled: 'bg-muted text-muted-foreground',
};

export function AvailabilityBadge({ status }: { status: AvailabilityDto['status'] }) {
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-xs font-medium capitalize',
        AVAILABILITY_STATUS_TONE[status],
      )}
    >
      {status}
    </span>
  );
}

/** Mounted only while open. */
export function LeaveDialog({ onClose }: { onClose: () => void }) {
  const [type, setType] = useState<(typeof AVAILABILITY_TYPES)[number]>('leave');
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const [hours, setHours] = useState('4');
  const [reason, setReason] = useState('');
  const save = useTrackMutation(
    () =>
      t.requestAvailability({
        type,
        from,
        to,
        reason: reason || undefined,
        ...(type === 'partial' ? { hoursPerDay: Number(hours) } : {}),
      }),
    { success: 'Request sent to your manager' },
  );
  const valid = from && to && from <= to && (type !== 'partial' || Number(hours) >= 0);
  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Request leave or reduced availability</DialogTitle>
          <DialogDescription>
            Approved requests reduce your capacity, so smart assignment will not give you work for
            those days.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Type" className="sm:col-span-2">
            <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AVAILABILITY_TYPES.map((x) => (
                  <SelectItem key={x} value={x}>
                    {TYPE_LABELS[x]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="From">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </FormField>
          <FormField label="To" error={from > to ? 'End must be on or after start' : undefined}>
            <Input type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} />
          </FormField>
          {type === 'partial' ? (
            <FormField label="Hours available per day" className="sm:col-span-2">
              <Input
                type="number"
                min={0}
                max={24}
                step={0.5}
                value={hours}
                onChange={(e) => setHours(e.target.value)}
              />
            </FormField>
          ) : null}
          <FormField label="Reason (optional)" className="sm:col-span-2">
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!valid || save.isPending}
            onClick={() => save.mutate(undefined, { onSuccess: onClose })}
          >
            Send request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
