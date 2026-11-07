import { Check, ChevronsUpDown, X } from 'lucide-react';
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
import { useFieldA11y } from '@/components/common/field-context';
import { cn } from '@/lib/utils';
import { useUsers } from '../hooks';

interface UserPickerProps {
  value: UserRef | null;
  onChange: (user: UserRef | null) => void;
  placeholder?: string;
  excludeId?: string;
  id?: string;
  disabled?: boolean;
}

/** Searchable single-user selector backed by the scoped /users endpoint. */
export function UserPicker({
  value,
  onChange,
  placeholder = 'Select a person',
  excludeId,
  id,
  disabled,
}: UserPickerProps) {
  const field = useFieldA11y();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search, 250);
  const { data, isFetching } = useUsers({ q: q || undefined, limit: 20, status: 'active' }, open);
  const options = (data?.items ?? []).filter((u) => u.id !== excludeId);

  return (
    <div className="flex gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id ?? field?.id}
            aria-describedby={field?.describedBy}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="h-9 flex-1 justify-between px-3 font-normal"
          >
            {value ? (
              <span className="flex min-w-0 items-center gap-2">
                <UserAvatar name={value.name} size="sm" />
                <span className="truncate">{value.name}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
            <ChevronsUpDown className="size-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] min-w-72 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search by name, e-mail or ID…"
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>{isFetching ? 'Searching…' : 'No matching people.'}</CommandEmpty>
              <CommandGroup>
                {options.map((u) => (
                  <CommandItem
                    key={u.id}
                    value={u.id}
                    onSelect={() => {
                      onChange({
                        id: u.id,
                        name: u.name,
                        email: u.email,
                        employeeId: u.employeeId,
                        designation: u.designation,
                      });
                      setOpen(false);
                    }}
                  >
                    <UserAvatar name={u.name} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-sm">{u.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {u.employeeId} · {u.designation ?? u.email}
                      </p>
                    </div>
                    <Check
                      className={cn(
                        'ml-auto size-4',
                        value?.id === u.id ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value && !disabled ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9"
          aria-label="Clear selection"
          onClick={() => onChange(null)}
        >
          <X className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}
