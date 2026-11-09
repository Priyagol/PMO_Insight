import { z } from 'zod';
import { objectIdSchema } from './api';
import type { UserRef } from './dto';
import type { TaskStatus } from './enums';

/* ============================================================================
 * Management summaries computed from the data itself (no AI service needed):
 * work summary, project status, performance trends and recurring bottlenecks.
 * Every sentence is built from counts the reader can check on the other pages.
 * ========================================================================= */

const day = z.iso.date('Use a valid date');

export const workSummaryQuerySchema = z
  .strictObject({
    from: day.optional(),
    to: day.optional(),
    departmentId: objectIdSchema.optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: 'The start must be before the end',
    path: ['from'],
  });
export type WorkSummaryQuery = z.infer<typeof workSummaryQuerySchema>;

export interface WorkSummaryPersonDto {
  user: UserRef;
  loggedHours: number;
  completed: { id: string; key: string; title: string }[];
  /** Tasks this person moved into review or testing in the period. */
  handedOver: number;
  /** Tasks this person started (moved to in progress) in the period. */
  started: number;
  /** Open tasks past their due date today. */
  overdue: number;
  /** Blockers written in the daily journal during the period. */
  blockers: string[];
  /** No time logged at all in the period. */
  noTimeLogged: boolean;
}

export interface WorkSummaryDto {
  period: { from: string; to: string };
  people: WorkSummaryPersonDto[];
  totals: { loggedHours: number; completed: number; handedOver: number; overdue: number };
  /** Plain-language observations, each derived from the figures above. */
  highlights: string[];
}

export const projectStatusQuerySchema = z
  .strictObject({
    from: day.optional(),
    to: day.optional(),
    departmentId: objectIdSchema.optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: 'The start must be before the end',
    path: ['from'],
  });
export type ProjectStatusQuery = z.infer<typeof projectStatusQuerySchema>;

export type Rag = 'green' | 'amber' | 'red';

export interface ProjectStatusRowDto {
  project: { id: string; key: string; name: string; endDate?: string };
  manager: UserRef | null;
  /** Red, amber or green: the worst of health band, forecast and overdue work. */
  rag: Rag;
  healthScore: number;
  progress: number;
  completedInPeriod: number;
  createdInPeriod: number;
  overdue: number;
  blocked: number;
  openCriticalRisks: number;
  forecastDate: string | null;
  slipDays: number | null;
  notes: string[];
}

export interface ProjectStatusDto {
  period: { from: string; to: string };
  projects: ProjectStatusRowDto[];
  counts: Record<Rag, number>;
  highlights: string[];
}

export type TrendDirection = 'improving' | 'declining' | 'steady' | 'not_enough_data';

export interface PerformanceTrendRowDto {
  user: UserRef;
  /** Tasks completed per week: the last 8 full weeks, then the current week (oldest first). */
  completedPerWeek: number[];
  /** On-time share of completed tasks with a due date, per week (null when none). */
  onTimePerWeek: (number | null)[];
  /** Average completed per week: the last 4 full weeks vs the 4 before. */
  recentAverage: number;
  previousAverage: number;
  direction: TrendDirection;
  explanation: string;
}

export interface PerformanceTrendsDto {
  /** Monday of each week, oldest first. */
  weeks: string[];
  people: PerformanceTrendRowDto[];
}

export interface BottlenecksDto {
  period: { from: string; to: string };
  /** Average time tasks waited in each status before moving on. */
  statusWaits: { status: TaskStatus; averageHours: number; moves: number }[];
  /** Projects where work was sent back most often (review, testing or done back to work). */
  rework: { project: { id: string; key: string; name: string }; sentBack: number }[];
  /** Tasks blocked for more than three days right now, per project. */
  longBlocked: { project: { id: string; key: string; name: string }; tasks: number }[];
  /** Tags that keep appearing on overdue or blocked tasks. */
  recurringTags: { tag: string; tasks: number }[];
  findings: string[];
}
