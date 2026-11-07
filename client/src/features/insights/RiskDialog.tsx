import { useState } from 'react';
import {
  RISK_STATUSES,
  RISK_TYPES,
  riskSeverity,
  type RiskDto,
  type RiskStatus,
  type RiskType,
  type UserRef,
} from '@arihant/shared';
import { SeverityBadge } from '@/components/charts/HealthBadge';
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
import { UserPicker } from '@/features/org/components/UserPicker';
import { useProjects } from '@/features/work/hooks';
import * as api from '@/services/api/insights';
import { useRiskMutation } from './hooks';

export const RISK_TYPE_LABELS: Record<RiskType, string> = {
  risk: 'Risk',
  issue: 'Issue',
  blocker: 'Blocker',
};
export const RISK_STATUS_LABELS: Record<RiskStatus, string> = {
  open: 'Open',
  mitigating: 'Mitigating',
  resolved: 'Resolved',
  closed: 'Closed',
};
const SCALE = [
  { v: 1, label: '1 · Very low' },
  { v: 2, label: '2 · Low' },
  { v: 3, label: '3 · Medium' },
  { v: 4, label: '4 · High' },
  { v: 5, label: '5 · Very high' },
];

function ScaleSelect({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))} disabled={disabled}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SCALE.map((s) => (
          <SelectItem key={s.v} value={String(s.v)}>
            {s.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Create (risk undefined) or view/edit a risk. Mounted only while open. */
export function RiskDialog({
  risk,
  projectId,
  onClose,
}: {
  risk?: RiskDto;
  projectId?: string;
  onClose: () => void;
}) {
  const readOnly = Boolean(risk && !risk.canEdit);
  const [project, setProject] = useState(risk?.project.id ?? projectId ?? '');
  const [type, setType] = useState<RiskType>(risk?.type ?? 'risk');
  const [title, setTitle] = useState(risk?.title ?? '');
  const [description, setDescription] = useState(risk?.description ?? '');
  const [probability, setProbability] = useState(risk?.probability ?? 3);
  const [impact, setImpact] = useState(risk?.impact ?? 3);
  const [owner, setOwner] = useState<UserRef | null>(risk?.owner ?? null);
  const [mitigation, setMitigation] = useState(risk?.mitigation ?? '');
  const [dueDate, setDueDate] = useState(risk?.dueDate ?? '');
  const [status, setStatus] = useState<RiskStatus>(risk?.status ?? 'open');
  const [note, setNote] = useState('');
  const projects = useProjects({ limit: 100, archived: 'false' }, !risk && !projectId);

  const save = useRiskMutation(
    () =>
      risk
        ? api.updateRisk(risk.id, {
            type,
            title,
            description: description || undefined,
            probability,
            impact,
            ownerId: owner?.id ?? null,
            mitigation: mitigation || undefined,
            dueDate: dueDate || null,
            status,
            ...(note.trim() ? { note: note.trim() } : {}),
          })
        : api.createRisk({
            projectId: project,
            type,
            title,
            description: description || undefined,
            probability,
            impact,
            ownerId: owner?.id ?? null,
            mitigation: mitigation || undefined,
            dueDate: dueDate || null,
            linkedTaskIds: [],
          }),
    risk ? 'Risk updated' : 'Risk raised',
  );
  const score = probability * impact;
  const valid = project && title.trim().length >= 3;

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {risk ? `${risk.key} · ${risk.title}` : 'Raise a risk, issue or blocker'}
          </DialogTitle>
          <DialogDescription>
            {risk
              ? `${risk.project.key} · ${risk.project.name}`
              : 'Score = probability × impact (1–25). Critical items notify the project manager.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          {!risk && !projectId ? (
            <FormField label="Project" required className="sm:col-span-2">
              <Select value={project} onValueChange={setProject}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a project" />
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
          <FormField label="Type">
            <Select value={type} onValueChange={(v) => setType(v as RiskType)} disabled={readOnly}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RISK_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {RISK_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          {risk ? (
            <FormField label="Status">
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as RiskStatus)}
                disabled={readOnly}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RISK_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {RISK_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          ) : (
            <div />
          )}
          <FormField
            label="Title"
            required
            className="sm:col-span-2"
            error={title && title.trim().length < 3 ? 'Enter a short title' : undefined}
          >
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              disabled={readOnly}
            />
          </FormField>
          <FormField label="Description" className="sm:col-span-2">
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={readOnly}
            />
          </FormField>
          <FormField label="Probability">
            <ScaleSelect value={probability} onChange={setProbability} disabled={readOnly} />
          </FormField>
          <FormField label="Impact">
            <ScaleSelect value={impact} onChange={setImpact} disabled={readOnly} />
          </FormField>
          <p className="text-sm sm:col-span-2" aria-live="polite">
            Score <strong className="tabular">{score}</strong> ·{' '}
            <SeverityBadge severity={riskSeverity(score)} />
          </p>
          <FormField label="Owner">
            <UserPicker
              value={owner}
              onChange={setOwner}
              placeholder="Unassigned"
              disabled={readOnly}
            />
          </FormField>
          <FormField label="Target date">
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              disabled={readOnly}
            />
          </FormField>
          <FormField label="Mitigation / action plan" className="sm:col-span-2">
            <Textarea
              rows={3}
              value={mitigation}
              onChange={(e) => setMitigation(e.target.value)}
              disabled={readOnly}
            />
          </FormField>
          {risk && !readOnly ? (
            <FormField label="Update note (optional, kept in history)" className="sm:col-span-2">
              <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
            </FormField>
          ) : null}
        </div>
        {risk?.history.length ? (
          <section className="rounded-lg border p-3">
            <h4 className="mb-2 text-xs font-semibold text-muted-foreground">History</h4>
            <ol className="max-h-40 space-y-1 overflow-auto text-xs">
              {[...risk.history].reverse().map((h, i) => (
                <li key={i}>
                  <span className="text-muted-foreground">
                    {new Date(h.at).toLocaleString('en-IN')}
                  </span>{' '}
                  · {h.by?.name ?? 'System'} · {h.action}
                  {h.note ? <span className="text-muted-foreground"> — {h.note}</span> : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
          {readOnly ? null : (
            <Button
              disabled={!valid || save.isPending}
              onClick={() => save.mutate(undefined, { onSuccess: onClose })}
            >
              {risk ? 'Save changes' : 'Raise'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Escalation needs a reason; the level rises by one (max 3) and the PM is notified. */
export function EscalateDialog({ risk, onClose }: { risk: RiskDto; onClose: () => void }) {
  const [note, setNote] = useState('');
  const escalate = useRiskMutation(
    () => api.escalateRisk(risk.id, note.trim()),
    `${risk.key} escalated`,
  );
  return (
    <Dialog open onOpenChange={(o) => !o && !escalate.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Escalate {risk.key}</DialogTitle>
          <DialogDescription>
            Raises the escalation level to {risk.escalationLevel + 1} of 3 and notifies the project
            manager. The reason is kept in the risk history and audit log.
          </DialogDescription>
        </DialogHeader>
        <FormField
          label="Reason"
          required
          error={note && note.trim().length < 3 ? 'Explain why' : undefined}
        >
          <Textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
          />
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={escalate.isPending}>
            Cancel
          </Button>
          <Button
            disabled={note.trim().length < 3 || escalate.isPending}
            onClick={() => escalate.mutate(undefined, { onSuccess: onClose })}
          >
            Escalate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
