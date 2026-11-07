import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, ShieldCheck, ShieldOff, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { ApiTokenScope, CreatedApiTokenDto, MfaSetupDto } from '@arihant/shared';
import { FormField } from '@/components/common/FormField';
import { PasswordInput } from '@/components/common/PasswordInput';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { errorMessage } from '@/lib/errors';
import * as sec from '@/services/api/security';
import { MfaQr, RecoveryCodes } from './mfa-ui';

const keys = {
  mfa: ['security', 'mfa'] as const,
  tokens: ['security', 'tokens'] as const,
};
const onError = (e: unknown) => toast.error(errorMessage(e));

function TwoStep() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: keys.mfa, queryFn: sec.fetchMfaStatus });
  const [setup, setSetup] = useState<MfaSetupDto | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: keys.mfa });
  const begin = useMutation({
    mutationFn: () => sec.startMfaSetup(),
    onSuccess: setSetup,
    onError,
  });
  const enable = useMutation({
    mutationFn: () => sec.enableMfa(code),
    onSuccess: async (r) => {
      setCodes(r.recoveryCodes);
      setSetup(null);
      setCode('');
      await refresh();
      toast.success('Two-step verification is on');
    },
    onError,
  });
  const disable = useMutation({
    mutationFn: () => sec.disableMfa(password, code),
    onSuccess: async () => {
      setCode('');
      setPassword('');
      await refresh();
      toast.success('Two-step verification is off');
    },
    onError,
  });
  const regenerate = useMutation({
    mutationFn: () => sec.regenerateRecoveryCodes(code),
    onSuccess: async (r) => {
      setCodes(r.recoveryCodes);
      setCode('');
      await refresh();
    },
    onError,
  });
  const s = status.data;
  if (!s) return <Skeleton className="h-32" />;
  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-sm">
        {s.enabled ? (
          <>
            <ShieldCheck className="size-4 text-success" /> On since{' '}
            {s.enabledAt ? new Date(s.enabledAt).toLocaleDateString('en-IN') : '—'} ·{' '}
            {s.recoveryCodesLeft} recovery code(s) left
          </>
        ) : (
          <>
            <ShieldOff className="size-4 text-muted-foreground" /> Off
            {s.required
              ? ' — required for your role; you will be asked to set it up at sign-in'
              : ''}
          </>
        )}
      </p>
      {codes ? <RecoveryCodes codes={codes} /> : null}
      {!s.enabled ? (
        setup ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (/^\d{6}$/.test(code)) enable.mutate();
            }}
          >
            <MfaQr setup={setup} />
            <FormField label="Code from the app">
              <Input
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </FormField>
            <Button type="submit" disabled={!/^\d{6}$/.test(code) || enable.isPending}>
              Turn on
            </Button>
          </form>
        ) : (
          <Button onClick={() => begin.mutate()} disabled={begin.isPending}>
            <ShieldCheck /> Set up two-step verification
          </Button>
        )
      ) : (
        <div className="space-y-3 rounded-lg border p-3">
          <FormField label="Current code (or a recovery code)">
            <Input maxLength={9} value={code} onChange={(e) => setCode(e.target.value)} />
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!code.trim() || regenerate.isPending}
              onClick={() => regenerate.mutate()}
            >
              New recovery codes
            </Button>
          </div>
          {!s.required ? (
            <div className="space-y-2 border-t pt-3">
              <FormField label="Password (to turn it off)">
                <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} />
              </FormField>
              <Button
                variant="destructive"
                size="sm"
                disabled={!code.trim() || !password || disable.isPending}
                onClick={() => disable.mutate()}
              >
                Turn off two-step verification
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ApiTokens() {
  const qc = useQueryClient();
  const tokens = useQuery({ queryKey: keys.tokens, queryFn: sec.fetchMyApiTokens });
  const [name, setName] = useState('');
  const [scope, setScope] = useState<ApiTokenScope>('read');
  const [days, setDays] = useState('30');
  const [created, setCreated] = useState<CreatedApiTokenDto | null>(null);
  const create = useMutation({
    mutationFn: () => sec.createApiToken({ name: name.trim(), scope, expiresInDays: Number(days) }),
    onSuccess: async (t) => {
      setCreated(t);
      setName('');
      await qc.invalidateQueries({ queryKey: keys.tokens });
    },
    onError,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => sec.revokeApiToken(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.tokens }),
    onError,
  });
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        For scripts and integrations: send{' '}
        <code className="font-mono">Authorization: Bearer &lt;token&gt;</code>. A token acts as you,
        with your access. Read tokens cannot change anything.
      </p>
      {created ? (
        <div
          role="status"
          className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
        >
          <p>Copy the token now; it will not be shown again.</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs">
              {created.token}
            </code>
            <Button
              size="sm"
              variant="outline"
              aria-label="Copy token"
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(created.token)
                  .then(() => toast.success('Copied'))
              }
            >
              <Copy />
            </Button>
          </div>
        </div>
      ) : null}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <FormField label="Token name">
          <Input
            className="w-48"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>
        <Select value={scope} onValueChange={(v) => setScope(v as ApiTokenScope)}>
          <SelectTrigger className="w-32" aria-label="Access">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="read">Read only</SelectItem>
            <SelectItem value="write">Read and write</SelectItem>
          </SelectContent>
        </Select>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-32" aria-label="Expires after">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {['7', '30', '60', '90'].map((d) => (
              <SelectItem key={d} value={d}>
                {d} days
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" disabled={!name.trim() || create.isPending}>
          <KeyRound /> Create token
        </Button>
      </form>
      <ul className="divide-y rounded-lg border text-sm">
        {(tokens.data ?? []).map((t) => {
          const dead = Boolean(t.revokedAt) || new Date(t.expiresAt) < new Date();
          return (
            <li key={t.id} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className={dead ? 'text-muted-foreground line-through' : ''}>
                  {t.name}{' '}
                  <span className="font-mono text-xs text-muted-foreground">{t.prefix}…</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {t.scope === 'read' ? 'Read only' : 'Read and write'} · expires{' '}
                  {new Date(t.expiresAt).toLocaleDateString('en-IN')} ·{' '}
                  {t.lastUsedAt
                    ? `last used ${new Date(t.lastUsedAt).toLocaleString('en-IN')}`
                    : 'never used'}
                  {t.revokedAt ? ' · revoked' : ''}
                </p>
              </div>
              {!t.revokedAt ? (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  aria-label={`Revoke ${t.name}`}
                  onClick={() => revoke.mutate(t.id)}
                >
                  <Trash2 />
                </Button>
              ) : null}
            </li>
          );
        })}
        {tokens.data && !tokens.data.length ? (
          <li className="px-3 py-2 text-xs text-muted-foreground">No tokens yet.</li>
        ) : null}
      </ul>
    </div>
  );
}

/** Account security: two-step verification and personal API tokens. */
export function AccountSecurityDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Account security</DialogTitle>
          <DialogDescription>
            Two-step verification and API tokens for your account.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="mfa">
          <TabsList>
            <TabsTrigger value="mfa">Two-step verification</TabsTrigger>
            <TabsTrigger value="tokens">API tokens</TabsTrigger>
          </TabsList>
          <TabsContent value="mfa" className="mt-4">
            <TwoStep />
          </TabsContent>
          <TabsContent value="tokens" className="mt-4">
            <ApiTokens />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
