import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { errorMessage } from '@/lib/errors';

/** Mutations in documents / releases / stakeholders refresh those lists and approvals. */
export function useDeliveryMutation<TVars, TResult>(
  fn: (v: TVars) => Promise<TResult>,
  opts: { success?: string | ((r: TResult) => string) } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r) => {
      await Promise.all(
        [
          ['documents'],
          ['releases'],
          ['stakeholders'],
          ['change-requests'],
          ['feedback'],
          ['approvals'],
          ['tasks'],
        ].map((queryKey) => qc.invalidateQueries({ queryKey })),
      );
      if (opts.success)
        toast.success(typeof opts.success === 'function' ? opts.success(r) : opts.success);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

/** Opens a pre-signed URL in a new tab (the URL expires after a few minutes). */
export async function openSignedUrl(get: () => Promise<{ url: string }>) {
  try {
    const { url } = await get();
    window.open(url, '_blank', 'noopener');
  } catch (err) {
    toast.error(errorMessage(err));
  }
}
