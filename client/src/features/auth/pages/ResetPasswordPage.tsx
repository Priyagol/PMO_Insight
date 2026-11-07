import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router';
import { z } from 'zod';
import { passwordSchema } from '@arihant/shared';
import { FormField } from '@/components/common/FormField';
import { PasswordInput, PasswordRequirements } from '@/components/common/PasswordInput';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/errors';
import { resetPassword } from '@/services/api/auth';
import { AuthLayout } from '../AuthLayout';

const formSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  });
type FormValues = z.infer<typeof formSchema>;

/** Completes both account activation (invite) and password reset. */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const isInvite = params.get('mode') === 'invite';
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { password: '', confirm: '' },
  });
  const password = useWatch({ control: form.control, name: 'password' }) ?? '';
  const mutation = useMutation({
    mutationFn: (v: FormValues) => resetPassword({ token, password: v.password }),
  });
  const title = isInvite ? 'Activate your account' : 'Choose a new password';

  if (!token) {
    return (
      <AuthLayout title={title}>
        <p role="alert" className="flex gap-2 text-sm text-destructive">
          <TriangleAlert className="size-4 shrink-0" /> This link is incomplete. Open the link from
          your e-mail again.
        </p>
        <Button asChild variant="outline" className="w-full">
          <Link to="/forgot-password">Request a new link</Link>
        </Button>
      </AuthLayout>
    );
  }

  if (mutation.isSuccess) {
    return (
      <AuthLayout title={isInvite ? 'Account activated' : 'Password updated'}>
        <div className="flex gap-3 rounded-lg border bg-card p-4 text-sm">
          <CircleCheck className="size-5 shrink-0 text-success" />
          <p>Your password has been set. Sign in with {mutation.data.email}.</p>
        </div>
        <Button asChild className="w-full">
          <Link to="/login">Sign in</Link>
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={title}
      subtitle={
        isInvite
          ? 'Set a password to start using Arihant Workspace.'
          : 'Your new password signs you out of other devices.'
      }
    >
      <form
        className="space-y-4"
        noValidate
        onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
      >
        {mutation.isError ? (
          <div
            role="alert"
            className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            <p>{errorMessage(mutation.error)}</p>
            <Link to="/forgot-password" className="font-medium underline">
              Request a new link
            </Link>
          </div>
        ) : null}
        <FormField label="New password" error={form.formState.errors.password?.message}>
          <PasswordInput autoComplete="new-password" autoFocus {...form.register('password')} />
        </FormField>
        <PasswordRequirements value={password} />
        <FormField label="Confirm password" error={form.formState.errors.confirm?.message}>
          <PasswordInput autoComplete="new-password" {...form.register('confirm')} />
        </FormField>
        <Button type="submit" className="w-full" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : isInvite ? 'Activate account' : 'Update password'}
        </Button>
      </form>
    </AuthLayout>
  );
}
