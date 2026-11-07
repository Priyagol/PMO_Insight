import { useQueryClient } from '@tanstack/react-query';
import { Bot, Copy } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  PRIORITY_LABELS,
  type AiProjectSummaryOutput,
  type AiRequirementsOutput,
  type AiResult,
  type AiWorklogOutput,
} from '@arihant/shared';
import { EmptyState } from '@/components/common/EmptyState';
import { FormField } from '@/components/common/FormField';
import { PageHeader } from '@/components/common/PageHeader';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { todayIso } from '@/features/work/format';
import { useProjects } from '@/features/work/hooks';
import { useCan } from '@/hooks/use-permission';
import { errorMessage } from '@/lib/errors';
import * as ai from '@/services/api/intelligence';
import * as work from '@/services/api/work';
import { AiBadge, AiButton, BulletList, useAiAvailable, useAiCall } from './ai-kit';
import { AskDataTool } from './AskData';

function ProjectPicker({
  value,
  onChange,
  onlyCreatable,
}: {
  value: string;
  onChange: (v: string) => void;
  onlyCreatable?: boolean;
}) {
  const projects = useProjects({ limit: 100, archived: 'false' });
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full" aria-label="Project">
        <SelectValue placeholder="Choose a project" />
      </SelectTrigger>
      <SelectContent>
        {(projects.data?.items ?? [])
          .filter((p) => !onlyCreatable || p.can.createTask)
          .map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.key} · {p.name}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}

/* ---------- Requirements → tasks ---------- */

function RequirementsTool() {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState('');
  const [text, setText] = useState('');
  const [result, setResult] = useState<AiResult<AiRequirementsOutput> | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [creating, setCreating] = useState(false);
  const call = useAiCall(() => ai.aiRequirementsToTasks(projectId, text));

  const generate = () =>
    call.mutate(undefined, {
      onSuccess: (r) => {
        setResult(r);
        setPicked(new Set(r.proposal.tasks.map((_, i) => i)));
      },
    });

  /** Creates the chosen tasks (and their subtasks) through the normal task API, one by one. */
  const create = async () => {
    if (!result) return;
    setCreating(true);
    let made = 0;
    try {
      for (const i of [...picked].sort((a, b) => a - b)) {
        const t = result.proposal.tasks[i]!;
        const parent = await work.createTask({
          projectId,
          title: t.title.slice(0, 200),
          description: t.description,
          priority: t.priority,
          estimatedHours: t.estimatedHours,
          tags: t.tags.slice(0, 20),
        });
        made += 1;
        for (const s of t.subtasks.slice(0, 20))
          await work.createTask({ projectId, parentId: parent.id, title: s.slice(0, 200) });
      }
      toast.success(`${made} task(s) created`);
      setResult(null);
      setText('');
    } catch (err) {
      toast.error(`${made} task(s) created, then: ${errorMessage(err)}`);
    } finally {
      setCreating(false);
      await qc.invalidateQueries({ queryKey: ['tasks'] });
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 rounded-xl border bg-card p-4">
        <FormField label="Project" required>
          <ProjectPicker value={projectId} onChange={setProjectId} onlyCreatable />
        </FormField>
        <FormField
          label="Requirements"
          required
          hint="Paste a BRD extract, user stories or meeting notes (up to 20,000 characters)."
        >
          <Textarea
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={20_000}
          />
        </FormField>
        <div>
          <AiButton
            busy={call.isPending}
            disabled={!projectId || text.trim().length < 20}
            onClick={generate}
          >
            Propose tasks
          </AiButton>
        </div>
      </div>
      {result ? (
        <section className="space-y-3 rounded-xl border bg-card p-4" aria-label="Proposed tasks">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">
                Proposed tasks ({result.proposal.tasks.length})
              </h3>
              <AiBadge />
            </div>
            <Button disabled={!picked.size || creating} onClick={() => void create()}>
              Create {picked.size} selected task{picked.size === 1 ? '' : 's'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{result.disclaimer}</p>
          <ul className="divide-y rounded-lg border">
            {result.proposal.tasks.map((t, i) => (
              <li key={i} className="flex gap-3 p-3 text-sm">
                <Checkbox
                  aria-label={`Include ${t.title}`}
                  checked={picked.has(i)}
                  onCheckedChange={(c) =>
                    setPicked((s) => {
                      const n = new Set(s);
                      if (c === true) n.add(i);
                      else n.delete(i);
                      return n;
                    })
                  }
                />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{t.title}</p>
                  <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                    {t.description}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {PRIORITY_LABELS[t.priority]}
                    {t.estimatedHours != null ? ` · ${t.estimatedHours} h` : ''}
                    {t.tags.length ? ` · ${t.tags.join(', ')}` : ''}
                    {t.subtasks.length
                      ? ` · ${t.subtasks.length} subtask(s): ${t.subtasks.join('; ')}`
                      : ''}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <BulletList title="Assumptions" items={result.proposal.assumptions} />
        </section>
      ) : null}
    </div>
  );
}

/* ---------- Project summary ---------- */

function SummaryTool() {
  const [projectId, setProjectId] = useState('');
  const [result, setResult] = useState<AiResult<AiProjectSummaryOutput> | null>(null);
  const call = useAiCall(() => ai.aiProjectSummary(projectId));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <div className="min-w-64 flex-1">
          <FormField label="Project">
            <ProjectPicker value={projectId} onChange={setProjectId} />
          </FormField>
        </div>
        <AiButton
          busy={call.isPending}
          disabled={!projectId}
          onClick={() => call.mutate(undefined, { onSuccess: setResult })}
        >
          Summarise
        </AiButton>
      </div>
      {result ? <SummaryView result={result} /> : null}
    </div>
  );
}

export function SummaryView({ result }: { result: AiResult<AiProjectSummaryOutput> }) {
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4" aria-label="Project summary">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">Status summary</h3>
        <AiBadge />
      </div>
      <p className="text-sm">{result.proposal.summary}</p>
      <BulletList title="Highlights" items={result.proposal.highlights} />
      <BulletList title="Concerns" items={result.proposal.concerns} />
      <BulletList title="Suggested next steps" items={result.proposal.nextSteps} />
      <p className="text-xs text-muted-foreground">
        {result.disclaimer} Model: {result.model}.
      </p>
    </section>
  );
}

/* ---------- Work-log draft ---------- */

function WorklogTool() {
  const [date, setDate] = useState(todayIso());
  const [result, setResult] = useState<AiResult<AiWorklogOutput> | null>(null);
  const call = useAiCall(() => ai.aiWorklogDraft(date));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <FormField label="Day">
          <Input
            type="date"
            value={date}
            max={todayIso()}
            onChange={(e) => setDate(e.target.value)}
          />
        </FormField>
        <AiButton
          busy={call.isPending}
          onClick={() => call.mutate(undefined, { onSuccess: setResult })}
        >
          Draft descriptions
        </AiButton>
        <p className="w-full text-xs text-muted-foreground">
          Drafts are written from your own recorded actions that day. Time is never estimated: you
          enter it when you log work.
        </p>
      </div>
      {result ? (
        <section className="space-y-2 rounded-xl border bg-card p-4" aria-label="Work log draft">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Draft entries</h3>
            <AiBadge />
          </div>
          {result.proposal.entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No recorded activity on this day to describe.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {result.proposal.entries.map((e, i) => (
                <li key={i} className="flex items-center gap-3 p-2.5 text-sm">
                  <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">
                    {e.taskKey ?? '—'}
                  </span>
                  <span className="flex-1">{e.description}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label="Copy description"
                    onClick={() =>
                      void navigator.clipboard
                        ?.writeText(e.description)
                        .then(() => toast.success('Copied'))
                    }
                  >
                    <Copy />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">{result.disclaimer}</p>
        </section>
      ) : null}
    </div>
  );
}

export function AiAssistantPage() {
  const available = useAiAvailable();
  const isAdmin = useCan('settings:manage', 'org');
  return (
    <div className="space-y-5">
      <PageHeader
        title="AI Assistant"
        description="Drafts and summaries from your own records. Every result is a proposal you review."
      />
      {!available ? (
        <div className="rounded-xl border bg-card">
          <EmptyState
            icon={Bot}
            title="The AI assistant is not available"
            description={
              isAdmin
                ? 'Enable it in System Settings once an API key is configured on the server.'
                : 'Your administrator has not enabled it yet.'
            }
          />
        </div>
      ) : (
        <Tabs defaultValue="ask">
          <TabsList>
            <TabsTrigger value="ask">Ask Your Data</TabsTrigger>
            <TabsTrigger value="requirements">Requirements → tasks</TabsTrigger>
            <TabsTrigger value="summary">Project summary</TabsTrigger>
            <TabsTrigger value="worklog">Work-log draft</TabsTrigger>
          </TabsList>
          <TabsContent value="ask" className="mt-4">
            <AskDataTool />
          </TabsContent>
          <TabsContent value="requirements" className="mt-4">
            <RequirementsTool />
          </TabsContent>
          <TabsContent value="summary" className="mt-4">
            <SummaryTool />
          </TabsContent>
          <TabsContent value="worklog" className="mt-4">
            <WorklogTool />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
