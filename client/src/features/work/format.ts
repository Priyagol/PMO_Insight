import { differenceInCalendarDays, format, parseISO } from 'date-fns';

/** Formats an organisation calendar date (YYYY-MM-DD) without timezone shifts. */
export function formatDay(date: string | undefined | null, pattern = 'd MMM yyyy'): string {
  if (!date) return '—';
  return format(parseISO(date), pattern);
}

/** "Today", "Tomorrow", "in 3 days", "2 days overdue" relative to the local calendar. */
export function relativeDue(date: string | undefined | null): string {
  if (!date) return 'No due date';
  const diff = differenceInCalendarDays(parseISO(date), new Date());
  if (diff === 0) return 'Due today';
  if (diff === 1) return 'Due tomorrow';
  if (diff > 1) return `Due in ${diff} days`;
  return `${-diff} day${diff === -1 ? '' : 's'} overdue`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const todayIso = () => format(new Date(), 'yyyy-MM-dd');
