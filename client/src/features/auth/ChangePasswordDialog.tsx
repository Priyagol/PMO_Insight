import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { changePasswordSchema, type ChangePasswordInput } from '@arihant/shared';
import { FormField } from '@/components/common/FormField';
import { PasswordInput, PasswordRequirements } from '@/components/common/PasswordInput';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ApiClientError } from '@/services/api/client';
import { changePassword } from '@/services/api/auth';
import { useAuthActions } from './use-auth-actions';

export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { startSession } = useAuthActions();
  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });
  const watched = useWatch({ control: form.control, name: 'newPassword' }) ?? '';
  const mutation = useMutation({
    mutationFn: changePassword,
    onSuccess: (res) => {
      startSession(res);
      toast.success('Password changed. Other devices have been signed out.');
      form.reset();
      onOpenChange(false);
    },
    onError: (err) => {
      if (err instanceof ApiClientError && err.code === 'VALIDATION_ERROR') {
        form.setError('currentPassword', { message: err.message });
      } else {
        toast.error(err.message);
      }
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) form.reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>
            You will stay signed in here; other devices are signed out.
          </DialogDescription>
        </DialogHeader>
        <form
          id="change-password"
          className="space-y-4"
          noValidate
          onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
        >
          <FormField
            label="Current password"
            error={form.formState.errors.currentPassword?.message}
          >
            <PasswordInput autoComplete="current-password" {...form.register('currentPassword')} />
          </FormField>
          <FormField label="New password" error={form.formState.errors.newPassword?.message}>
            <PasswordInput autoComplete="new-password" {...form.register('newPassword')} />
          </FormField>
          <PasswordRequirements value={watched} />
        </form>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" form="change-password" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Change password'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
