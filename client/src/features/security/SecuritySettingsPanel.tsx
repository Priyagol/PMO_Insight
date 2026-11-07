import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  ROLE_LABELS,
  SYSTEM_ROLES,
  type SecuritySettingsDto,
  type SystemRole,
} from '@arihant/shared';
import { ErrorState } from '@/components/common/ErrorState';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import * as sec from '@/services/api/security';

const KEY = ['security', 'settings'] as const;

function Editor({ data }: { data: SecuritySettingsDto }) {
  const qc = useQueryClient();
  const [roles, setRoles] = useState<SystemRole[]>(data.mfaRequiredRoles);
  const [tokensOn, setTokensOn] = useState(data.apiTokensEnabled);
  const [maxDays, setMaxDays] = useState(String(data.apiTokenMaxDays));
  const [ssoOn, setSsoOn] = useState(data.ssoEnabled);
  const [ssoEnforced, setSsoEnforced] = useState(data.ssoEnforced);
  const edit = data.canEdit;
  const save = useMutation({
    mutationFn: () =>
      sec.saveSecuritySettings({
        mfaRequiredRoles: roles,
        apiTokensEnabled: tokensOn,
        apiTokenMaxDays: Number(maxDays),
        ssoEnabled: ssoOn,
        ssoEnforced: ssoOn && ssoEnforced,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: KEY });
      toast.success('Security settings saved');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const tokens = useQuery({
    queryKey: ['security', 'tokens', 'all'],
    queryFn: sec.fetchAllApiTokens,
    enabled: edit,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => sec.revokeApiToken(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['security', 'tokens', 'all'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="space-y-5 text-sm">
      <fieldset className="space-y-2" disabled={!edit}>
        <legend className="font-medium">Two-step verification required for</legend>
        <div className="flex flex-wrap gap-1.5">
          {SYSTEM_ROLES.map((r) => {
            const on = roles.includes(r);
            return (
              <button
                key={r}
                type="button"
                aria-pressed={on}
                onClick={() => setRoles((xs) => (on ? xs.filter((x) => x !== r) : [...xs, r]))}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-xs',
                  on
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {ROLE_LABELS[r]}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          People in these roles set it up at their next sign-in and cannot turn it off. Anyone else
          may turn it on from Security &amp; API tokens in their menu.
        </p>
      </fieldset>

      <fieldset className="space-y-2" disabled={!edit}>
        <legend className="font-medium">Personal API tokens</legend>
        <label className="flex items-center gap-2">
          <Checkbox checked={tokensOn} onCheckedChange={(c) => setTokensOn(c === true)} />
          Allow people to create API tokens (they act as the person, with read-only or
          read-and-write access)
        </label>
        <label className="flex items-center gap-2">
          Longest validity
          <Input
            className="h-8 w-20"
            type="number"
            min={1}
            max={365}
            aria-label="Longest validity in days"
            value={maxDays}
            onChange={(e) => setMaxDays(e.target.value)}
          />
          days
        </label>
      </fieldset>

      <fieldset className="space-y-2" disabled={!edit}>
        <legend className="font-medium">Single sign-on</legend>
        {data.ssoConfigured ? (
          <>
            <label className="flex items-center gap-2">
              <Checkbox checked={ssoOn} onCheckedChange={(c) => setSsoOn(c === true)} />
              Show “Sign in with {data.ssoProviderName}” on the sign-in page
            </label>
            <label className={cn('flex items-center gap-2', !ssoOn && 'opacity-50')}>
              <Checkbox
                checked={ssoEnforced}
                disabled={!ssoOn}
                onCheckedChange={(c) => setSsoEnforced(c === true)}
              />
              People who have used single sign-on can no longer sign in with a password (super
              administrators keep password access)
            </label>
          </>
        ) : (
          <p role="status" className="rounded-lg border border-dashed p-3 text-xs">
            Not configured on the server. Set <code className="font-mono">OIDC_ISSUER</code>,{' '}
            <code className="font-mono">OIDC_CLIENT_ID</code> and{' '}
            <code className="font-mono">OIDC_CLIENT_SECRET</code> (from Microsoft Entra ID, Google
            Workspace or another OpenID Connect provider) on the API. People must already have an
            account here with the same e-mail address.
          </p>
        )}
      </fieldset>

      {edit ? (
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          Save security settings
        </Button>
      ) : null}

      {edit && tokens.data?.length ? (
        <div className="space-y-2">
          <p className="font-medium">All API tokens</p>
          <ul className="divide-y rounded-lg border">
            {tokens.data.map((t) => (
              <li key={t.id} className="flex items-center gap-2 px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate">
                  {t.owner?.name} · {t.name}{' '}
                  <span className="text-xs text-muted-foreground">
                    ({t.scope},{' '}
                    {t.revokedAt
                      ? 'revoked'
                      : `expires ${new Date(t.expiresAt).toLocaleDateString('en-IN')}`}
                    )
                  </span>
                </span>
                {!t.revokedAt ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    aria-label={`Revoke ${t.name} of ${t.owner?.name ?? ''}`}
                    onClick={() => revoke.mutate(t.id)}
                  >
                    <Trash2 />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Administration: two-step verification policy, API tokens and single sign-on. */
export function SecuritySettingsPanel() {
  const q = useQuery({ queryKey: KEY, queryFn: sec.fetchSecuritySettings });
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4" aria-label="Security">
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <ShieldCheck className="size-4" /> Security
        </h2>
        <p className="text-xs text-muted-foreground">
          Two-step verification, API access and single sign-on. Changes are audited.
        </p>
      </div>
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data ? (
        <Editor key={JSON.stringify(q.data)} data={q.data} />
      ) : (
        <Skeleton className="h-40" />
      )}
    </section>
  );
}
