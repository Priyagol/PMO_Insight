import { useState } from 'react';
import type { AiMinutesResult, AiProjectSummaryOutput, AiResult } from '@arihant/shared';
import * as ai from '@/services/api/intelligence';
import { AiButton, AiResultDialog, BulletList, useAiAvailable, useAiCall } from './ai-kit';

/** "Explain" next to a health score. Renders nothing when AI is unavailable. */
export function ExplainHealthButton({ projectId }: { projectId: string }) {
  const available = useAiAvailable();
  const [result, setResult] = useState<Awaited<ReturnType<typeof ai.aiExplainHealth>> | null>(null);
  const call = useAiCall(() => ai.aiExplainHealth(projectId));
  if (!available) return null;
  return (
    <>
      <AiButton
        size="sm"
        busy={call.isPending}
        onClick={() => call.mutate(undefined, { onSuccess: setResult })}
      >
        Explain with AI
      </AiButton>
      {result ? (
        <AiResultDialog
          title="Why this health score"
          model={result.model}
          disclaimer={result.disclaimer}
          onClose={() => setResult(null)}
        >
          <p className="text-sm">{result.proposal.explanation}</p>
          <BulletList title="What would raise it" items={result.proposal.actions} />
        </AiResultDialog>
      ) : null}
    </>
  );
}

export function ProjectSummaryButton({ projectId }: { projectId: string }) {
  const available = useAiAvailable();
  const [result, setResult] = useState<AiResult<AiProjectSummaryOutput> | null>(null);
  const call = useAiCall(() => ai.aiProjectSummary(projectId));
  if (!available) return null;
  return (
    <>
      <AiButton
        size="sm"
        busy={call.isPending}
        onClick={() => call.mutate(undefined, { onSuccess: setResult })}
      >
        AI summary
      </AiButton>
      {result ? (
        <AiResultDialog
          title="Project status summary"
          model={result.model}
          disclaimer={result.disclaimer}
          onClose={() => setResult(null)}
        >
          <p className="text-sm">{result.proposal.summary}</p>
          <BulletList title="Highlights" items={result.proposal.highlights} />
          <BulletList title="Concerns" items={result.proposal.concerns} />
          <BulletList title="Suggested next steps" items={result.proposal.nextSteps} />
        </AiResultDialog>
      ) : null}
    </>
  );
}

/** Drafts decisions and action items from the minutes text; the caller puts them in the editor (unsaved). */
export function MinutesAiButton({
  meetingId,
  text,
  onDraft,
}: {
  meetingId: string;
  text: string;
  onDraft: (r: AiMinutesResult) => void;
}) {
  const available = useAiAvailable();
  const call = useAiCall(() => ai.aiMinutesToActions(meetingId, text));
  if (!available) return null;
  return (
    <AiButton
      size="sm"
      busy={call.isPending}
      disabled={text.trim().length < 20}
      onClick={() => call.mutate(undefined, { onSuccess: onDraft })}
    >
      Draft decisions &amp; actions
    </AiButton>
  );
}
