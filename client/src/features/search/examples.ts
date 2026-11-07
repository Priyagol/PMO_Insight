/** Starter queries shown on the search page. */
export const EXAMPLES: { label: string; aql: string }[] = [
  { label: 'My open work', aql: 'assignee = currentUser() AND status NOT IN (done, cancelled)' },
  { label: 'Overdue', aql: 'due < today() AND status NOT IN (done, cancelled) ORDER BY due' },
  { label: 'Open bugs by severity', aql: 'type = bug AND status != done ORDER BY priority DESC' },
  { label: 'Updated this week', aql: 'updated >= startOfWeek() ORDER BY updated DESC' },
  { label: 'Unassigned high priority', aql: 'assignee IS EMPTY AND priority >= high' },
];
