import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Link2, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { WEB_LINK_PROVIDER_LABELS } from '@arihant/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/errors';
import * as ob from '@/services/api/outbound';

/** Task panel: links to designs, documents and builds in other tools. */
export function WebLinksSection({ taskId, editable }: { taskId: string; editable: boolean }) {
  const qc = useQueryClient();
  const key = ['tasks', 'web-links', taskId];
  const q = useQuery({ queryKey: key, queryFn: () => ob.fetchWebLinks(taskId) });
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const add = useMutation({
    mutationFn: () => ob.addWebLink(taskId, { url: url.trim(), title: title.trim() || undefined }),
    onSuccess: async () => {
      setUrl('');
      setTitle('');
      setAdding(false);
      await qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => ob.removeWebLink(taskId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const links = q.data ?? [];
  if (!links.length && !editable) return null;
  return (
    <section aria-label="Web links" className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Web links
        </h3>
        {editable && !adding ? (
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setAdding(true)}>
            <Plus /> Add link
          </Button>
        ) : null}
      </div>
      {links.length ? (
        <ul className="space-y-1">
          {links.map((l) => (
            <li key={l.id} className="group flex items-center gap-2 text-sm">
              <Link2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <a
                href={l.url}
                target="_blank"
                rel="noreferrer noopener"
                className="min-w-0 flex-1 truncate hover:underline"
              >
                {l.title}
              </a>
              <span className="text-xs text-muted-foreground">
                {WEB_LINK_PROVIDER_LABELS[l.provider]}
              </span>
              <ExternalLink className="size-3 text-muted-foreground" aria-hidden />
              {editable ? (
                <button
                  type="button"
                  aria-label={`Remove link ${l.title}`}
                  className="opacity-0 group-hover:opacity-70 focus:opacity-100"
                  onClick={() => remove.mutate(l.id)}
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {adding ? (
        <form
          className="space-y-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (/^https:\/\//.test(url.trim())) add.mutate();
          }}
        >
          <Input
            autoFocus
            className="h-8"
            aria-label="Link address"
            placeholder="https://www.figma.com/… or a Confluence / Drive page"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <div className="flex gap-1.5">
            <Input
              className="h-8"
              aria-label="Link title"
              placeholder="Title (optional)"
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Button
              type="submit"
              size="sm"
              disabled={!/^https:\/\//.test(url.trim()) || add.isPending}
            >
              Add
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
