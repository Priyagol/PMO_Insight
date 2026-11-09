import type { UserRef } from './dto';
import type { ProjectStatus, TaskStatus } from './enums';

/* ============================================================================
 * Project timeline and delay analysis.
 *
 * The baseline end date is the first end date a project was given (rebuilt from its version
 * history), so every later move is visible as a slip. "Who" columns name the person involved
 * at the time (assignee, approver, the person who moved a date); they are shown only to people
 * with a team-wide analytics scope (managers), never to developers, testers or employees.
 * ========================================================================= */

export const TIMELINE_STATES = [
  'on_track',
  'at_risk',
  'late',
  'done_on_time',
  'done_late',
  'no_dates',
] as const;
export type TimelineState = (typeof TIMELINE_STATES)[number];

export const TIMELINE_STATE_LABELS: Record<TimelineState, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  late: 'Late',
  done_on_time: 'Finished on time',
  done_late: 'Finished late',
  no_dates: 'No dates',
};

export interface TimelineProjectDto {
  project: { id: string; key: string; name: string; status: ProjectStatus };
  manager: UserRef | null;
  startDate: string | null;
  /** The first end date the project was given. */
  baselineEndDate: string | null;
  /** The current planned end date. */
  endDate: string | null;
  /** Expected finish from recent progress (open projects with enough history). */
  forecastDate: string | null;
  /** Day the project was marked completed. */
  finishedOn: string | null;
  /** Current end date minus baseline (days the plan has been moved). */
  slipDays: number;
  /** How many times the end date was moved later. */
  slips: number;
  /**
   * Days beyond the baseline: finished projects by their finish day, open ones by the latest
   * of today (once past the baseline) and the forecast.
   */
  lateDays: number;
  progress: number;
  state: TimelineState;
  milestones: { name: string; dueDate: string; status: 'open' | 'completed'; late: boolean }[];
  dependsOn: { id: string; key: string }[];
}

export interface DelaySlipDto {
  at: string;
  by: UserRef | null;
  from: string;
  to: string;
  days: number;
  reason: string | null;
}

export interface DelayTaskRef {
  id: string;
  key: string;
  title: string;
  status: TaskStatus;
}

export interface ProjectDelayDto {
  timeline: TimelineProjectDto;
  /** False for personal scope: names are hidden and only your own tasks are listed. */
  showPeople: boolean;
  slipHistory: DelaySlipDto[];
  /** Tasks finished after their due date, or still open past it. */
  lateTasks: (DelayTaskRef & {
    dueDate: string;
    finishedOn: string | null;
    daysLate: number;
    assignee: UserRef | null;
  })[];
  /** Periods tasks spent Blocked (the current one included). */
  blocked: (DelayTaskRef & {
    since: string;
    days: number;
    current: boolean;
    markedBy: UserRef | null;
    comment: string | null;
  })[];
  /** Tasks that waited more than 2 days in In review or Testing. */
  slowHandoffs: (DelayTaskRef & {
    stage: 'in_review' | 'testing';
    days: number;
    assignee: UserRef | null;
  })[];
  /** Approval stages decided (or still waiting) after their deadline. */
  approvalWaits: {
    id: string;
    key: string;
    title: string;
    stage: string;
    waitedDays: number;
    overdueDays: number;
    pending: boolean;
    approvers: UserRef[];
  }[];
  /** Task due dates moved later, and by whom. */
  dueDatePushes: (DelayTaskRef & {
    from: string;
    to: string;
    days: number;
    by: UserRef | null;
    at: string;
  })[];
  /** Upstream projects (this project waits on them) that are late. */
  upstream: { id: string; key: string; name: string; endDate: string | null; lateDays: number }[];
  /** Totals per person (managers only; empty otherwise). */
  people: {
    user: UserRef;
    lateTasks: number;
    lateTaskDays: number;
    approvalOverdueDays: number;
    dueDatePushDays: number;
  }[];
}
