import { formatDistanceToNow } from 'date-fns';
import { MessageSquare, Pencil, Trash2 } from 'lucide-react';
import { Fragment, useRef, useState } from 'react';
import type { CommentDto, ProjectMemberDto } from '@arihant/shared';
import { MENTION_PATTERN } from '@arihant/shared';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { UserAvatar } from '@/components/common/UserAvatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import * as work from '@/services/api/work';
import { useComments, useWorkMutation, workKeys } from '../hooks';

/** Renders comment text with @mentions highlighted. Text is never injected as HTML. */
export function CommentBody({ body }: { body: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of body.matchAll(new RegExp(MENTION_PATTERN.source, 'gi'))) {
    parts.push(body.slice(last, m.index));
    parts.push(
      <span key={m.index} className="rounded bg-primary/10 px-1 font-medium text-primary">
        @{m[1]}
      </span>,
    );
    last = (m.index ?? 0) + m[0].length;
  }
  parts.push(body.slice(last));
  return (
    <p className="text-sm whitespace-pre-wrap">
      {parts.map((p, i) => (
        <Fragment key={i}>{p}</Fragment>
      ))}
    </p>
  );
}

/** Textarea with "@" autocomplete over the project team; inserts @[Name](id) tokens. */
function MentionInput({
  value,
  onChange,
  members,
  placeholder,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  members: ProjectMemberDto[];
  placeholder?: string;
  onSubmit: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<{ text: string; start: number } | null>(null);
  const [highlight, setHighlight] = useState(0);
  const matches = query
    ? members
        .filter((m) => m.user.name.toLowerCase().includes(query.text.toLowerCase()))
        .slice(0, 6)
    : [];

  const detect = (text: string, caret: number) => {
    const upto = text.slice(0, caret);
    const m = /(^|\s)@([\w .-]{0,30})$/.exec(upto);
    setQuery(m ? { text: m[2]!, start: caret - m[2]!.length - 1 } : null);
    setHighlight(0);
  };

  const pick = (member: ProjectMemberDto) => {
    if (!query || !ref.current) return;
    const caret = ref.current.selectionStart;
    const token = `@[${member.user.name}](${member.user.id}) `;
    const next = value.slice(0, query.start) + token + value.slice(caret);
    onChange(next);
    setQuery(null);
    requestAnimationFrame(() => {
      const pos = query.start + token.length;
      ref.current?.setSelectionRange(pos, pos);
      ref.current?.focus();
    });
  };

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        rows={3}
        value={value}
        placeholder={placeholder}
        aria-label="Comment"
        onChange={(e) => {
          onChange(e.target.value);
          detect(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={(e) => {
          if (matches.length) {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHighlight((h) => (h + 1) % matches.length);
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlight((h) => (h - 1 + matches.length) % matches.length);
              return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              pick(matches[highlight]!);
              return;
            }
            if (e.key === 'Escape') {
              setQuery(null);
              return;
            }
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
      {matches.length ? (
        <ul
          role="listbox"
          aria-label="Mention a teammate"
          className="absolute bottom-full left-0 z-20 mb-1 w-64 rounded-lg border bg-popover p-1 shadow-md"
        >
          {matches.map((m, i) => (
            <li key={m.user.id} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(m);
                }}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${i === highlight ? 'bg-accent' : ''}`}
              >
                <UserAvatar name={m.user.name} size="sm" /> {m.user.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CommentItem({
  c,
  taskId,
  members,
}: {
  c: CommentDto;
  taskId: string;
  members: ProjectMemberDto[];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.body);
  const invalidate = [workKeys.comments(taskId), workKeys.tasks];
  const edit = useWorkMutation(() => work.editComment(c.id, draft), { invalidate });
  const remove = useWorkMutation(() => work.deleteComment(c.id), {
    success: 'Comment deleted',
    invalidate,
  });
  return (
    <li className="flex gap-3">
      <UserAvatar name={c.author?.name ?? 'Deleted user'} size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium">{c.author?.name ?? 'Deleted user'}</span>
          <span className="text-muted-foreground" title={new Date(c.createdAt).toLocaleString()}>
            {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}
            {c.edited ? ' · edited' : ''}
          </span>
          {c.canEdit && !editing ? (
            <span className="ml-auto flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label="Edit comment"
                onClick={() => setEditing(true)}
              >
                <Pencil className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label="Delete comment"
                onClick={() => remove.mutate(undefined)}
              >
                <Trash2 className="size-3" />
              </Button>
            </span>
          ) : null}
        </div>
        {editing ? (
          <div className="space-y-2">
            <MentionInput
              value={draft}
              onChange={setDraft}
              members={members}
              onSubmit={() => edit.mutate(undefined, { onSuccess: () => setEditing(false) })}
            />
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraft(c.body);
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!draft.trim() || edit.isPending}
                onClick={() => edit.mutate(undefined, { onSuccess: () => setEditing(false) })}
              >
                Save
              </Button>
            </div>
          </div>
        ) : (
          <CommentBody body={c.body} />
        )}
      </div>
    </li>
  );
}

export function CommentsPanel({
  taskId,
  members,
  canComment,
}: {
  taskId: string;
  members: ProjectMemberDto[];
  canComment: boolean;
}) {
  const comments = useComments(taskId);
  const [draft, setDraft] = useState('');
  const add = useWorkMutation(() => work.addComment(taskId, draft), {
    invalidate: [workKeys.comments(taskId), workKeys.tasks],
  });
  const submit = () => draft.trim() && add.mutate(undefined, { onSuccess: () => setDraft('') });

  return (
    <div className="space-y-4">
      {comments.error ? (
        <ErrorState error={comments.error} onRetry={() => void comments.refetch()} />
      ) : comments.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : comments.data?.length === 0 ? (
        <EmptyState
          compact
          icon={MessageSquare}
          title="No comments yet"
          description="Use @ to mention a teammate."
        />
      ) : (
        <ul className="space-y-4">
          {comments.data?.map((c) => (
            <CommentItem key={c.id} c={c} taskId={taskId} members={members} />
          ))}
        </ul>
      )}
      {canComment ? (
        <div className="space-y-2">
          <MentionInput
            value={draft}
            onChange={setDraft}
            members={members}
            placeholder="Write a comment… (@ to mention, Ctrl+Enter to send)"
            onSubmit={submit}
          />
          <div className="flex justify-end">
            <Button size="sm" disabled={!draft.trim() || add.isPending} onClick={submit}>
              {add.isPending ? 'Posting…' : 'Comment'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
