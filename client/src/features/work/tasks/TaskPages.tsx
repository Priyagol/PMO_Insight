import { useSearchParams } from 'react-router';
import { PageHeader } from '@/components/common/PageHeader';
import { useCan } from '@/hooks/use-permission';
import { TaskWorkspace } from './TaskWorkspace';

export function TaskBoardPage() {
  const canCreate = useCan('task:create');
  // "Open on board" from the search page passes the query in the address.
  const [params] = useSearchParams();
  const aql = params.get('aql') ?? undefined;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Task Board"
        description="All tasks you can see, as a board, list, calendar or timeline."
      />
      <TaskWorkspace
        key={aql ?? ''}
        canCreate={canCreate}
        initialView="board"
        initialFilters={aql ? { aql } : undefined}
      />
    </div>
  );
}

export function MyTasksPage() {
  const canCreate = useCan('task:create');
  return (
    <div className="space-y-5">
      <PageHeader title="My Tasks" description="Everything assigned to you, across projects." />
      <TaskWorkspace
        canCreate={canCreate}
        initialView="list"
        initialFilters={{ assigneeId: 'me' }}
      />
    </div>
  );
}

export function CalendarPage() {
  const canCreate = useCan('task:create');
  return (
    <div className="space-y-5">
      <PageHeader
        title="Calendar"
        description="Task due dates. Drag a task to reschedule it. Meetings and leave join this calendar in later phases."
      />
      <TaskWorkspace
        canCreate={canCreate}
        initialView="calendar"
        views={['calendar', 'timeline']}
      />
    </div>
  );
}
