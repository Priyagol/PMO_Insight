import { useQuery } from '@tanstack/react-query';
import {
  FileText,
  FolderKanban,
  ListTodo,
  Monitor,
  Moon,
  Search,
  Sun,
  UserRound,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { STATUS_LABELS, type TaskStatus } from '@arihant/shared';
import { globalSearch } from '@/services/api/search';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import type { NavSection } from '@/routes/nav-config';
import { useAppDispatch } from '@/store';
import { setTheme, type ThemePreference } from '@/store/ui-slice';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: NavSection[];
}

const THEMES: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light theme', icon: Sun },
  { value: 'dark', label: 'Dark theme', icon: Moon },
  { value: 'system', label: 'System theme', icon: Monitor },
];

/**
 * Ctrl/⌘+K palette: jump to any module the user can access, find tasks, projects, people
 * and documents (only those the user may see), and run quick actions.
 */
export function CommandPalette({ open, onOpenChange: setOpen, sections }: CommandPaletteProps) {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [term, setTerm] = useState('');
  // Closing clears the search so the palette opens fresh next time.
  const onOpenChange = (next: boolean) => {
    if (!next) setTerm('');
    setOpen(next);
  };
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);
  const found = useQuery({
    queryKey: ['search', 'global', debounced],
    queryFn: () => globalSearch(debounced),
    enabled: open && debounced.length >= 2,
    staleTime: 30_000,
  });
  const r = found.data;
  // Server results already match the term; prefix values so the palette's own filter keeps them.
  const v = (s: string) => `${term} ${s}`;

  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Search for a page or run a command"
    >
      <CommandInput
        placeholder="Search tasks, projects, people, pages…"
        value={term}
        onValueChange={setTerm}
      />
      <CommandList>
        <CommandEmpty>{found.isFetching ? 'Searching…' : 'Nothing found.'}</CommandEmpty>
        {r?.tasks.length ? (
          <CommandGroup heading="Tasks">
            {r.tasks.map((t) => (
              <CommandItem
                key={t.id}
                value={v(`task ${t.key} ${t.title}`)}
                onSelect={() => run(() => navigate({ search: `?task=${t.id}` }))}
              >
                <ListTodo className="text-muted-foreground" />
                <span className="font-mono text-xs">{t.key}</span>
                <span className="truncate">{t.title}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {STATUS_LABELS[t.status as TaskStatus] ?? t.status}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {r?.projects.length ? (
          <CommandGroup heading="Projects">
            {r.projects.map((p) => (
              <CommandItem
                key={p.id}
                value={v(`project ${p.key} ${p.name}`)}
                onSelect={() => run(() => navigate(`/projects/${p.id}`))}
              >
                <FolderKanban className="text-muted-foreground" />
                <span className="font-mono text-xs">{p.key}</span> {p.name}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {r?.people.length ? (
          <CommandGroup heading="People">
            {r.people.map((u) => (
              <CommandItem
                key={u.id}
                value={v(`person ${u.name}`)}
                onSelect={() => run(() => navigate(`/employees?person=${u.id}`))}
              >
                <UserRound className="text-muted-foreground" />
                {u.name}
                {u.designation ? (
                  <span className="ml-auto text-xs text-muted-foreground">{u.designation}</span>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {r?.documents.length ? (
          <CommandGroup heading="Documents">
            {r.documents.map((d) => (
              <CommandItem
                key={d.id}
                value={v(`document ${d.title}`)}
                onSelect={() => run(() => navigate(`/documents?doc=${d.id}`))}
              >
                <FileText className="text-muted-foreground" />
                {d.title}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {sections.map((section) => (
          <CommandGroup key={section.id} heading={section.label}>
            {section.items.map((item) => (
              <CommandItem
                key={item.id}
                value={`${item.label} ${item.description} ${(item.keywords ?? []).join(' ')}`}
                onSelect={() => run(() => navigate(item.path))}
              >
                <item.icon className="text-muted-foreground" />
                <span>{item.label}</span>
                <span className="ml-auto hidden truncate text-xs text-muted-foreground sm:inline">
                  {item.description}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        <CommandSeparator />
        <CommandGroup heading="Preferences">
          {THEMES.map((t) => (
            <CommandItem
              key={t.value}
              value={t.label}
              onSelect={() => run(() => dispatch(setTheme(t.value)))}
            >
              <t.icon className="text-muted-foreground" />
              {t.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
      {term.trim().length >= 2 ? (
        <button
          type="button"
          className="flex w-full items-center gap-2 border-t px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted"
          onClick={() =>
            run(() =>
              navigate(
                `/search?aql=${encodeURIComponent(`text ~ "${term.trim().replace(/"/g, '')}"`)}`,
              ),
            )
          }
        >
          <Search className="size-4" />
          Search all tasks for “{term.trim()}” with the query language
        </button>
      ) : null}
    </CommandDialog>
  );
}
