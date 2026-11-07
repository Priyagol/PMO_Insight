import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { KeyRound, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router';
import {
  loginSchema,
  type LoginInput,
  type LoginResponse,
  type MfaSetupDto,
} from '@arihant/shared';
import { FormField } from '@/components/common/FormField';
import { PasswordInput } from '@/components/common/PasswordInput';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MfaQr, RecoveryCodes } from '@/features/security/mfa-ui';
import { errorMessage } from '@/lib/errors';
import { enrollDuringLogin, login, loginWithCode } from '@/services/api/auth';
import { fetchAuthConfig, ssoStartUrl, startMfaSetup } from '@/services/api/security';
import { AuthLayout } from '../AuthLayout';
import { useAuthActions } from '../use-auth-actions';

function ErrorBox({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

/** Second step: a code from the authenticator app (or a recovery code). */
function VerifyStep({
  mfaToken,
  onDone,
}: {
  mfaToken: string;
  onDone: (s: LoginResponse) => void;
}) {
  const [code, setCode] = useState('');
  const verify = useMutation({
    mutationFn: () => loginWithCode(mfaToken, code),
    onSuccess: onDone,
  });
  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (code.trim()) verify.mutate();
      }}
    >
      {verify.isError ? <ErrorBox message={errorMessage(verify.error)} /> : null}
      <p className="text-sm text-muted-foreground">
        Enter the 6-digit code from your authenticator app. Lost your phone? Use one of your
        recovery codes.
      </p>
      <FormField label="Verification code">
        <Input
          autoFocus
          autoComplete="one-time-code"
          inputMode="text"
          maxLength={9}
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </FormField>
      <Button type="submit" className="w-full" disabled={verify.isPending || !code.trim()}>
        {verify.isPending ? 'Checking…' : 'Verify'}
      </Button>
    </form>
  );
}

/** Two-step verification is required for this person's role: set it up before continuing. */
function EnrollStep({
  mfaToken,
  onDone,
}: {
  mfaToken: string;
  onDone: (s: LoginResponse) => void;
}) {
  const [setup, setSetup] = useState<MfaSetupDto | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<{ list: string[]; session: LoginResponse } | null>(null);
  const begin = useMutation({ mutationFn: () => startMfaSetup(mfaToken), onSuccess: setSetup });
  const finish = useMutation({
    mutationFn: () => enrollDuringLogin(mfaToken, code),
    onSuccess: (r) => r.session && setCodes({ list: r.recoveryCodes, session: r.session }),
  });
  if (codes)
    return (
      <div className="space-y-4">
        <RecoveryCodes codes={codes.list} />
        <Button className="w-full" onClick={() => onDone(codes.session)}>
          I have saved them, continue
        </Button>
      </div>
    );
  return (
    <div className="space-y-4">
      {begin.isError ? <ErrorBox message={errorMessage(begin.error)} /> : null}
      {finish.isError ? <ErrorBox message={errorMessage(finish.error)} /> : null}
      <p className="text-sm text-muted-foreground">
        Your organisation requires two-step verification for your role. Set it up now; it takes a
        minute.
      </p>
      {setup ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (/^\d{6}$/.test(code)) finish.mutate();
          }}
        >
          <MfaQr setup={setup} />
          <FormField label="Code from the app">
            <Input
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
          </FormField>
          <Button
            type="submit"
            className="w-full"
            disabled={!/^\d{6}$/.test(code) || finish.isPending}
          >
            Turn on and sign in
          </Button>
        </form>
      ) : (
        <Button className="w-full" onClick={() => begin.mutate()} disabled={begin.isPending}>
          <ShieldCheck /> Set up two-step verification
        </Button>
      )}
    </div>
  );
}

export function LoginPage() {
  const { startSession } = useAuthActions();
  const [params] = useSearchParams();
  const [step, setStep] = useState<{ kind: 'verify' | 'enroll'; mfaToken: string } | null>(null);
  const config = useQuery({ queryKey: ['auth', 'config'], queryFn: fetchAuthConfig, retry: false });
  const sso = config.data?.sso;
  const ssoError = params.get('sso_error');
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const mutation = useMutation({
    mutationFn: login,
    // PublicOnly redirects to the ?next= target once the session is set.
    onSuccess: (res) => {
      if (res.mfaRequired) setStep({ kind: res.mfaRequired, mfaToken: res.mfaToken });
      else startSession(res);
    },
  });

  if (step)
    return (
      <AuthLayout
        title={step.kind === 'verify' ? 'Two-step verification' : 'Set up two-step verification'}
        subtitle="One more step to protect your account."
      >
        {step.kind === 'verify' ? (
          <VerifyStep mfaToken={step.mfaToken} onDone={startSession} />
        ) : (
          <EnrollStep mfaToken={step.mfaToken} onDone={startSession} />
        )}
        <button
          type="button"
          className="w-full text-center text-xs text-muted-foreground hover:underline"
          onClick={() => setStep(null)}
        >
          Back to sign in
        </button>
      </AuthLayout>
    );

  return (
    <AuthLayout title="Sign in" subtitle="Use your Arihant Workspace account.">
      {ssoError ? <ErrorBox message={ssoError} /> : null}
      {sso?.enabled ? (
        <div className="space-y-3">
          <Button asChild variant={sso.enforced ? 'default' : 'outline'} className="w-full">
            <a href={ssoStartUrl}>
              <KeyRound /> Sign in with {sso.providerName}
            </a>
          </Button>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" /> or with a password{' '}
            <span className="h-px flex-1 bg-border" />
          </div>
        </div>
      ) : null}
      <form
        className="space-y-4"
        noValidate
        onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
      >
        {mutation.isError ? <ErrorBox message={errorMessage(mutation.error)} /> : null}
        <FormField label="Work e-mail" error={form.formState.errors.email?.message}>
          <Input
            type="email"
            autoComplete="username"
            autoFocus
            placeholder="name@arihantcapital.com"
            {...form.register('email')}
          />
        </FormField>
        <FormField label="Password" error={form.formState.errors.password?.message}>
          <PasswordInput autoComplete="current-password" {...form.register('password')} />
        </FormField>
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-xs font-medium text-primary hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" className="w-full" disabled={mutation.isPending}>
          {mutation.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      <p className="text-center text-xs text-muted-foreground">
        New here? Your administrator creates your account and e-mails you an activation link.
      </p>
    </AuthLayout>
  );
}
