import { useSearchParams } from 'react-router';

/** Opens the task drawer from anywhere by setting `?task=<id>` (shareable links). */
export function useTaskDrawer() {
  const [params, setParams] = useSearchParams();
  return {
    openTaskId: params.get('task'),
    open: (id: string) =>
      setParams((p) => {
        p.set('task', id);
        return p;
      }),
    close: () =>
      setParams((p) => {
        p.delete('task');
        return p;
      }),
  };
}
