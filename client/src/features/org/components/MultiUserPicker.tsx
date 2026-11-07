import { Check, Plus, X } from 'lucide-react';
import { useState } from 'react';
import type { UserRef } from '@arihant/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { cn } from '@/lib/utils';
import { useUsers } from '../hooks';

interface MultiUserPickerProps {
  value: UserRef[];
  onChange: (users: UserRef[]) => void;
  /** Ids that are always included and cannot be removed here (e.g. the manager). */
  lockedIds?: string[];
  addLabel?: string;
}

/** Chips + searchable add menu for choosing several people. */
export function MultiUserPicker({
  value,
  onChange,
  lockedIds = [],
  addLabel = 'Add people',
}: MultiUserPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search, 250);
  const { data, isFetching } = useUsers({ q: q || undefined, limit: 20, status: 'active' }, open);
  const selected = new Set(value.map((u) => u.id));

  const toggle = (u: UserRef) =>
    onChange(selected.has(u.id) ? value.filter((v) => v.id !== u.id) : [...value, u]);

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border p-1.5">
      {value.map((u) => (
        <span
          key={u.id}
          className="inline-flex items-center gap-1.5 rounded-full bg-muted py-0.5 pr-1 pl-0.5 text-xs"
        >
          <UserAvatar name={u.name} size="sm" />
          {u.name}
          {lockedIds.includes(u.id) ? null : (
            <button
              type="button"
              aria-label={`Remove ${u.name}`}
              onClick={() => toggle(u)}
              className="rounded-full p-0.5 hover:bg-background"
            >
              <X className="size-3" />
            </button>
          )}
        </span>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="h-7">
            <Plus /> {addLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Search people…" value={search} onValueChange={setSearch} />
            <CommandList>
              <CommandEmpty>{isFetching ? 'Searching…' : 'No matching people.'}</CommandEmpty>
              <CommandGroup>
                {(data?.items ?? []).map((u) => (
                  <CommandItem
                    key={u.id}
                    value={u.id}
                    disabled={lockedIds.includes(u.id)}
                    onSelect={() =>
                      toggle({
                        id: u.id,
                        name: u.name,
                        email: u.email,
                        employeeId: u.employeeId,
                        designation: u.designation,
                      })
                    }
                  >
                    <UserAvatar name={u.name} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-sm">{u.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {u.designation ?? u.email}
                      </p>
                    </div>
                    <Check
                      className={cn(
                        'ml-auto size-4',
                        selected.has(u.id) ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
