import { Eye, EyeOff } from 'lucide-react';
import { useState, type ComponentProps } from 'react';
import { PASSWORD_MIN_LENGTH } from '@arihant/shared';
import { Input } from '@/components/ui/input';

export function PasswordInput(props: Omit<ComponentProps<typeof Input>, 'type'>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? 'text' : 'password'} className="pr-9" />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground hover:text-foreground"
        aria-label={visible ? 'Hide password' : 'Show password'}
        tabIndex={-1}
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

/** Live checklist mirroring the server password policy. */
export function PasswordRequirements({ value }: { value: string }) {
  const rules = [
    {
      ok: value.length >= PASSWORD_MIN_LENGTH,
      label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    },
    { ok: /[A-Za-z]/.test(value), label: 'A letter' },
    { ok: /\d/.test(value), label: 'A number' },
  ];
  return (
    <ul className="grid grid-cols-3 gap-2 text-[11px]" aria-label="Password requirements">
      {rules.map((r) => (
        <li key={r.label} className={r.ok ? 'text-success' : 'text-muted-foreground'}>
          {r.ok ? '✓' : '○'} {r.label}
        </li>
      ))}
    </ul>
  );
}
