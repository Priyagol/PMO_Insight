import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { MailCheck } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { forgotPasswordSchema, type ForgotPasswordInput } from '@arihant/shared';
import { FormField } from '@/components/common/FormField';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/errors';
import { forgotPassword } from '@/services/api/auth';
import { AuthLayout } from '../AuthLayout';

export function ForgotPasswordPage() {
  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });
  const mutation = useMutation({ mutationFn: forgotPassword });

  if (mutation.isSuccess) {
    return (
      <AuthLayout title="Check your e-mail">
        <div className="flex gap-3 rounded-lg border bg-card p-4 text-sm">
          <MailCheck className="size-5 shrink-0 text-success" />
          <p>
            If an account exists for <strong>{form.getValues('email')}</strong>, we have sent a link
            to reset the password. The link expires in 30 minutes.
          </p>
        </div>
        <Button asChild variant="outline" className="w-full">
          <Link to="/login">Back to sign in</Link>
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Enter your work e-mail and we'll send you a reset link."
    >
      <form
        className="space-y-4"
        noValidate
        onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
      >
        {mutation.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(mutation.error)}
          </p>
        ) : null}
        <FormField label="Work e-mail" error={form.formState.errors.email?.message}>
          <Input type="email" autoComplete="username" autoFocus {...form.register('email')} />
        </FormField>
        <Button type="submit" className="w-full" disabled={mutation.isPending}>
          {mutation.isPending ? 'Sending…' : 'Send reset link'}
        </Button>
        <Link
          to="/login"
          className="block text-center text-xs font-medium text-primary hover:underline"
        >
          Back to sign in
        </Link>
      </form>
    </AuthLayout>
  );
}
