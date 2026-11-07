import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Flag, Plus, UserCheck } from 'lucide-react';
import { useState } from 'react';
import {
  APPROVAL_ENTITY_LABELS,
  APPROVER_TYPE_LABELS,
  AUTOMATION_TRIGGER_LABELS,
  type ApprovalWorkflowDto,
  type AutomationRuleDto,
} from '@arihant/shared';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WorkflowEditor } from '@/features/collaboration/ApprovalsPage';
import { useWorkflows } from '@/features/collaboration/hooks';
import { useCan } from '@/hooks/use-permission';
import { cn } from '@/lib/utils';
import * as api from '@/services/api/intelligence';
import { RuleFields, RuleFlow, useRuleDraft } from './AutomationsPage';

/* ============================ Automation rules ============================ */

function RuleCanvas({ rule, onSaved }: { rule?: AutomationRuleDto; onSaved: () => void }) {
  const d = useRuleDraft(rule);
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(280px,380px)_1fr]">
      <section
        className="rounded-xl border bg-[radial-gradient(var(--border)_1px,transparent_1px)] [background-size:16px_16px] p-6"
        aria-label="Diagram"
      >
        <RuleFlow d={d} />
      </section>
      <section className="space-y-3 rounded-xl border bg-card p-4" aria-label="Rule editor">
        <RuleFields d={d} />
        <div className="flex justify-end">
          <Button
            disabled={d.saving || (rule ? !rule.canEdit : false)}
            onClick={() => d.submit(onSaved)}
          >
            {rule ? 'Save rule' : 'Create rule'}
          </Button>
        </div>
      </section>
    </div>
  );
}

function RulesBuilder() {
  const rules = useQuery({
    queryKey: ['automations', 'rules'],
    queryFn: () => api.fetchAutomations(),
  });
  const [selected, setSelected] = useState<string | 'new'>('new');
  if (rules.error) return <ErrorState error={rules.error} onRetry={() => void rules.refetch()} />;
  if (!rules.data) return <Skeleton className="h-96" />;
  const rule = selected === 'new' ? undefined : rules.data.find((r) => r.id === selected);
  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
      <nav aria-label="Rules" className="space-y-1">
        <Button
          variant={selected === 'new' ? 'secondary' : 'ghost'}
          className="w-full justify-start"
          onClick={() => setSelected('new')}
        >
          <Plus /> New rule
        </Button>
        {rules.data.map((r) => (
          <button
            key={r.id}
            type="button"
            aria-current={selected === r.id}
            onClick={() => setSelected(r.id)}
            className={cn(
              'w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted',
              selected === r.id && 'bg-muted font-medium',
            )}
          >
            <span className="block truncate">{r.name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {r.enabled ? '' : 'Off · '}
              {AUTOMATION_TRIGGER_LABELS[r.trigger]}
            </span>
          </button>
        ))}
      </nav>
      {/* Keyed so switching rules starts a fresh draft. */}
      <RuleCanvas key={selected} rule={rule} onSaved={() => void rules.refetch()} />
    </div>
  );
}

/* ============================ Approval workflows ============================ */

function StageFlow({ w }: { w: ApprovalWorkflowDto }) {
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label={`${w.name} stages`}>
      <li className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs">
        <Flag className="size-3.5 text-primary" aria-hidden /> Request raised
      </li>
      {w.stages.map((s, i) => (
        <li key={i} className="flex items-center gap-2">
          <span aria-hidden className="text-muted-foreground">
            →
          </span>
          <div className="rounded-xl border-2 border-status-warning/60 bg-card px-3 py-2 text-xs">
            <p className="flex items-center gap-1 font-semibold">
              <UserCheck className="size-3.5" aria-hidden /> {i + 1}. {s.name}
            </p>
            <p className="text-muted-foreground">
              {APPROVER_TYPE_LABELS[s.approverType]}
              {s.roleKey ? ` (${s.roleKey.replace('_', ' ')})` : ''} · {s.slaHours} h
            </p>
          </div>
        </li>
      ))}
      <li className="flex items-center gap-2">
        <span aria-hidden className="text-muted-foreground">
          →
        </span>
        <span className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs">
          <CheckCircle2 className="size-3.5" style={{ color: 'var(--status-good)' }} aria-hidden />{' '}
          Approved
        </span>
      </li>
    </ol>
  );
}

function ApprovalsBuilder() {
  const isAdmin = useCan('settings:manage', 'org');
  const wf = useWorkflows();
  if (wf.error) return <ErrorState error={wf.error} onRetry={() => void wf.refetch()} />;
  if (!wf.data) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-6">
      {wf.data.map((w) => (
        <section key={w.id} className="space-y-3" aria-label={APPROVAL_ENTITY_LABELS[w.entityType]}>
          <div className="rounded-xl border bg-[radial-gradient(var(--border)_1px,transparent_1px)] [background-size:16px_16px] p-4">
            <p className="mb-2 text-sm font-semibold">{w.name}</p>
            <StageFlow w={w} />
          </div>
          {isAdmin ? <WorkflowEditor key={w.id + w.updatedAt} workflow={w} /> : null}
        </section>
      ))}
      {!isAdmin ? (
        <p className="text-xs text-muted-foreground">
          Approval workflows are changed by administrators.
        </p>
      ) : null}
    </div>
  );
}

export function WorkflowBuilderPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Workflow Builder"
        description="See and edit automations and approval workflows as diagrams. The diagram updates as you edit."
      />
      <Tabs defaultValue="rules">
        <TabsList>
          <TabsTrigger value="rules">Automation rules</TabsTrigger>
          <TabsTrigger value="approvals">Approval workflows</TabsTrigger>
        </TabsList>
        <TabsContent value="rules" className="mt-4">
          <RulesBuilder />
        </TabsContent>
        <TabsContent value="approvals" className="mt-4">
          <ApprovalsBuilder />
        </TabsContent>
      </Tabs>
    </div>
  );
}
