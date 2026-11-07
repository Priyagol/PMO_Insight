import type { AssignmentConfig, Priority, ScoreBreakdown, UserRef } from '@arihant/shared';

/**
 * Smart assignment scoring and planning. Pure functions: no database access, so the
 * algorithm can be tested exhaustively and reasoned about in isolation.
 *
 * Score (0..1) = Σ weight × factor, every factor normalised to 0..1:
 *   workload     = 1 − min(load / capacity, 1)            (less loaded → higher)
 *   capacity     = max(capacity − load − effort, 0) / capacity   (room left after this task)
 *   skill        = mean(level / 5) over required skills, 1 when none are required
 *   priority     = 1 − |complexity − proficiency| / 4; critical tasks use proficiency / 5
 *   availability = available working days / horizon days
 */

export interface EngineCandidate {
  id: string;
  ref: UserRef;
  /** Lower-cased skill name → level 1..5. */
  skills: Map<string, number>;
  capacityHours: number;
  loadHours: number;
  availableDays: number;
  horizonDays: number;
  openTasks: number;
  /** Epoch ms of the person's most recent assignment (0 if never); older wins ties. */
  lastAssignedAt: number;
}

export interface EngineTask {
  id: string;
  key: string;
  title: string;
  priority: Priority;
  complexity: number | null;
  requiredSkills: { name: string; minLevel: number }[];
  effortHours: number;
  dueDate: string | null;
}

export interface Evaluation {
  eligible: boolean;
  score: number;
  breakdown: ScoreBreakdown;
  reasons: string[];
}

const PRIORITY_RANK: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const ZERO: ScoreBreakdown = { workload: 0, capacity: 0, skill: 0, priority: 0, availability: 0 };
const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

function proficiency(task: EngineTask, c: EngineCandidate): number {
  const levels = task.requiredSkills.length
    ? task.requiredSkills.map((s) => c.skills.get(s.name.toLowerCase()) ?? 0)
    : [...c.skills.values()];
  return levels.length ? levels.reduce((a, b) => a + b, 0) / levels.length : 3;
}

export function evaluate(task: EngineTask, c: EngineCandidate, cfg: AssignmentConfig): Evaluation {
  const reasons: string[] = [];
  if (c.capacityHours <= 0 || c.availableDays <= 0)
    reasons.push('Unavailable for the whole planning window (leave)');
  for (const s of task.requiredSkills) {
    const level = c.skills.get(s.name.toLowerCase()) ?? 0;
    if (level < s.minLevel)
      reasons.push(`Needs ${s.name} level ${s.minLevel} (has ${level || 'none'})`);
  }
  if (
    !cfg.allowOverCapacity &&
    c.capacityHours > 0 &&
    c.loadHours + task.effortHours > c.capacityHours + 1e-9
  ) {
    reasons.push(
      `Over capacity: ${round(c.loadHours, 1)} h + ${round(task.effortHours, 1)} h > ${round(c.capacityHours, 1)} h available`,
    );
  }
  if (reasons.length) return { eligible: false, score: 0, breakdown: ZERO, reasons };

  const workload = 1 - Math.min(c.loadHours / c.capacityHours, 1);
  const capacity = Math.max(c.capacityHours - c.loadHours - task.effortHours, 0) / c.capacityHours;
  const skill = task.requiredSkills.length
    ? task.requiredSkills.reduce(
        (sum, s) => sum + Math.min((c.skills.get(s.name.toLowerCase()) ?? 0) / 5, 1),
        0,
      ) / task.requiredSkills.length
    : 1;
  const prof = proficiency(task, c);
  const complexity = task.complexity ?? 3;
  const priority =
    task.priority === 'critical' ? Math.min(prof / 5, 1) : 1 - Math.abs(complexity - prof) / 4;
  const availability = c.horizonDays > 0 ? Math.min(c.availableDays / c.horizonDays, 1) : 0;
  const breakdown: ScoreBreakdown = {
    workload: round(workload),
    capacity: round(capacity),
    skill: round(skill),
    priority: round(Math.max(priority, 0)),
    availability: round(availability),
  };
  const w = cfg.weights;
  const score =
    w.workload * breakdown.workload +
    w.capacity * breakdown.capacity +
    w.skill * breakdown.skill +
    w.priority * breakdown.priority +
    w.availability * breakdown.availability;
  if (c.loadHours + task.effortHours > c.capacityHours)
    reasons.push('Will exceed capacity (allowed by configuration)');
  return { eligible: true, score: round(score), breakdown, reasons };
}

/** Deterministic ranking: score, then least recently assigned, then fewest open tasks, then id. */
export function rank(task: EngineTask, candidates: EngineCandidate[], cfg: AssignmentConfig) {
  return candidates
    .map((c) => ({ candidate: c, ...evaluate(task, c, cfg) }))
    .sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      if (Math.abs(b.score - a.score) > 1e-9) return b.score - a.score;
      if (a.candidate.lastAssignedAt !== b.candidate.lastAssignedAt)
        return a.candidate.lastAssignedAt - b.candidate.lastAssignedAt;
      if (a.candidate.openTasks !== b.candidate.openTasks)
        return a.candidate.openTasks - b.candidate.openTasks;
      return a.candidate.id.localeCompare(b.candidate.id);
    });
}

/** Order in which tickets are allocated: most urgent first, larger first among equals (better packing). */
export function allocationOrder(tasks: EngineTask[]): EngineTask[] {
  return [...tasks].sort(
    (a, b) =>
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') ||
      b.effortHours - a.effortHours ||
      a.key.localeCompare(b.key, undefined, { numeric: true }),
  );
}

export interface Allocation {
  taskId: string;
  toUserId: string | null;
  score: number;
  reason: string;
}

/**
 * Greedy batch allocation. After each assignment the chosen person's load and
 * "last assigned" stamp are updated in memory, so the next ticket sees the new
 * workload: equal people with equal tickets receive an equal share.
 */
export function planBatch(
  tasks: EngineTask[],
  candidates: EngineCandidate[],
  cfg: AssignmentConfig,
) {
  const pool = candidates.map((c) => ({ ...c, skills: c.skills }));
  const proposals: Allocation[] = [];
  const skipped: { taskId: string; reason: string }[] = [];
  let clock = Date.now();

  for (const task of allocationOrder(tasks)) {
    if (pool.length === 0) {
      skipped.push({ taskId: task.id, reason: 'No eligible people in the selected pool' });
      continue;
    }
    const ranked = rank(task, pool, cfg);
    const best = ranked[0]!;
    if (!best.eligible) {
      // Report the most common blocking reason across candidates.
      const counts = new Map<string, number>();
      ranked.forEach((r) =>
        r.reasons.forEach((x) =>
          counts.set(x.replace(/:.*$/, ''), (counts.get(x.replace(/:.*$/, '')) ?? 0) + 1),
        ),
      );
      const top = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'No eligible person';
      skipped.push({ taskId: task.id, reason: `No eligible person: ${top.toLowerCase()}` });
      continue;
    }
    const chosen = best.candidate;
    chosen.loadHours += task.effortHours;
    chosen.openTasks += 1;
    clock += 1;
    chosen.lastAssignedAt = clock;
    const runnerUp = ranked[1];
    const reason =
      `Score ${Math.round(best.score * 100)}` +
      ` (workload ${Math.round(best.breakdown.workload * 100)}%, capacity left ${Math.round(best.breakdown.capacity * 100)}%` +
      `, skills ${Math.round(best.breakdown.skill * 100)}%)` +
      (runnerUp?.eligible
        ? `; next best ${runnerUp.candidate.ref.name} at ${Math.round(runnerUp.score * 100)}`
        : '');
    proposals.push({ taskId: task.id, toUserId: chosen.id, score: best.score, reason });
  }
  return { proposals, skipped, finalLoads: new Map(pool.map((c) => [c.id, c.loadHours])) };
}

/**
 * Rebalancing: while someone is above `rebalanceHigh` utilisation and someone else is below
 * `rebalanceLow`, move the movable task that best closes the gap to the best eligible person.
 * `movable` maps a person to their unstarted, non-critical tasks.
 */
export function planRebalance(
  candidates: EngineCandidate[],
  movable: Map<string, EngineTask[]>,
  cfg: AssignmentConfig,
  maxMoves = 200,
) {
  const pool = candidates.map((c) => ({ ...c }));
  const util = (c: EngineCandidate) =>
    c.capacityHours > 0 ? c.loadHours / c.capacityHours : Infinity;
  const moves: {
    taskId: string;
    fromUserId: string;
    toUserId: string;
    score: number;
    reason: string;
  }[] = [];
  const remaining = new Map([...movable].map(([k, v]) => [k, [...v]]));

  for (let i = 0; i < maxMoves; i += 1) {
    const sorted = pool.filter((c) => c.capacityHours > 0).sort((a, b) => util(b) - util(a));
    const over = sorted[0];
    const under = sorted[sorted.length - 1];
    if (
      !over ||
      !under ||
      over === under ||
      util(over) <= cfg.rebalanceHigh ||
      util(under) >= cfg.rebalanceLow
    )
      break;

    const options = (remaining.get(over.id) ?? []).sort((a, b) => b.effortHours - a.effortHours);
    let moved = false;
    for (const task of options) {
      const receivers = rank(
        task,
        pool.filter((c) => c.id !== over.id),
        cfg,
      ).filter((r) => r.eligible);
      const target = receivers.find(
        (r) =>
          util(r.candidate) < util(over) &&
          r.candidate.loadHours + task.effortHours <= over.loadHours - task.effortHours + 1e-9,
      );
      if (!target) continue;
      over.loadHours -= task.effortHours;
      over.openTasks -= 1;
      target.candidate.loadHours += task.effortHours;
      target.candidate.openTasks += 1;
      remaining.set(
        over.id,
        options.filter((t) => t.id !== task.id),
      );
      moves.push({
        taskId: task.id,
        fromUserId: over.id,
        toUserId: target.candidate.id,
        score: target.score,
        reason: `Rebalance: ${over.ref.name} at ${Math.round(util(over) * 100 + (task.effortHours / over.capacityHours) * 100)}% → ${target.candidate.ref.name}`,
      });
      moved = true;
      break;
    }
    if (!moved) break;
  }
  return { moves, finalLoads: new Map(pool.map((c) => [c.id, c.loadHours])) };
}
