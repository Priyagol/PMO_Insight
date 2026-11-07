import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSIGNMENT_CONFIG, type AssignmentConfig, type Priority } from '@arihant/shared';
import {
  evaluate,
  planBatch,
  planRebalance,
  rank,
  type EngineCandidate,
  type EngineTask,
} from '../src/modules/assignment/engine';

const cfg: AssignmentConfig = { ...DEFAULT_ASSIGNMENT_CONFIG };

function person(
  id: string,
  over: Partial<Omit<EngineCandidate, 'skills'>> & { skills?: Record<string, number> } = {},
): EngineCandidate {
  const { skills, ...rest } = over;
  return {
    id,
    ref: { id, name: `Tester ${id}`, email: `${id}@x.test`, employeeId: id },
    skills: new Map(Object.entries(skills ?? { testing: 3 }).map(([k, v]) => [k.toLowerCase(), v])),
    capacityHours: 80, // 40 h/week over a 10-working-day horizon
    loadHours: 0,
    availableDays: 10,
    horizonDays: 10,
    openTasks: 0,
    lastAssignedAt: 0,
    ...rest,
  };
}

function tickets(n: number, over: Partial<EngineTask> = {}): EngineTask[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i + 1}`,
    key: `QA-${i + 1}`,
    title: `Test case ${i + 1}`,
    priority: 'medium' as Priority,
    complexity: 3,
    requiredSkills: [],
    effortHours: 2,
    dueDate: null,
    ...over,
  }));
}

const shares = (proposals: { toUserId: string | null }[]) => {
  const m: Record<string, number> = {};
  for (const p of proposals) if (p.toUserId) m[p.toUserId] = (m[p.toUserId] ?? 0) + 1;
  return m;
};

describe('scoring', () => {
  it('weights sum to 1 and an idle, fully available, skilled person scores high', () => {
    const w = cfg.weights;
    expect(w.workload + w.capacity + w.skill + w.priority + w.availability).toBeCloseTo(1);
    const e = evaluate(tickets(1)[0]!, person('a'), cfg);
    expect(e.eligible).toBe(true);
    expect(e.score).toBeGreaterThan(0.9);
  });

  it('higher workload lowers the score; more skill and capacity raise it', () => {
    const t = tickets(1, { requiredSkills: [{ name: 'Testing', minLevel: 2 }] })[0]!;
    const idle = evaluate(t, person('a'), cfg).score;
    const busy = evaluate(t, person('b', { loadHours: 60 }), cfg).score;
    const expert = evaluate(t, person('c', { skills: { testing: 5 } }), cfg).score;
    expect(busy).toBeLessThan(idle);
    expect(expert).toBeGreaterThan(idle);
  });

  it('explains why someone is ineligible', () => {
    const t = tickets(1, {
      requiredSkills: [{ name: 'Automation', minLevel: 3 }],
      effortHours: 10,
    })[0]!;
    const e = evaluate(t, person('a', { loadHours: 75, availableDays: 0, capacityHours: 0 }), cfg);
    expect(e.eligible).toBe(false);
    expect(e.reasons.join(' | ')).toMatch(/Unavailable/);
    expect(e.reasons.join(' | ')).toMatch(/Needs Automation level 3/);
  });
});

describe('batch allocation (brief §12 scenarios)', () => {
  it('100 tickets and 4 equally capable testers: exactly 25 each', () => {
    const { proposals, skipped } = planBatch(
      tickets(100),
      ['a', 'b', 'c', 'd'].map((id) => person(id)),
      cfg,
    );
    expect(skipped).toEqual([]);
    expect(shares(proposals)).toEqual({ a: 25, b: 25, c: 25, d: 25 });
  });

  it('unequal existing workloads: the busiest tester receives fewer tickets and loads converge', () => {
    const pool = [person('a', { loadHours: 40 }), person('b'), person('c'), person('d')];
    const { proposals, finalLoads } = planBatch(tickets(40), pool, cfg);
    const s = shares(proposals);
    // 80 h of new work cannot lift the others above A's existing 40 h, so A receives nothing...
    expect(s.a ?? 0).toBe(0);
    // ...and the other three end within one ticket (2 h) of each other.
    const others = ['b', 'c', 'd'].map((id) => finalLoads.get(id)!);
    expect(Math.max(...others) - Math.min(...others)).toBeLessThanOrEqual(2);
    expect(finalLoads.get('a')).toBe(40);
  });

  it('different capacity limits: allocation follows capacity, utilisation stays balanced', () => {
    const pool = [
      person('full', { capacityHours: 80 }),
      person('half', { capacityHours: 40, availableDays: 10 }),
    ];
    const { proposals, finalLoads } = planBatch(tickets(30), pool, cfg);
    const s = shares(proposals);
    expect(s.full).toBeGreaterThan(s.half!);
    const utilFull = finalLoads.get('full')! / 80;
    const utilHalf = finalLoads.get('half')! / 40;
    expect(Math.abs(utilFull - utilHalf)).toBeLessThan(0.1);
  });

  it('different skill requirements: only qualified testers get skill-bound tickets', () => {
    const pool = [
      person('manual', { skills: { manual: 5 } }),
      person('auto', { skills: { automation: 4, manual: 2 } }),
    ];
    const work = [
      ...tickets(6, { requiredSkills: [{ name: 'Automation', minLevel: 3 }] }),
      ...tickets(2).map((t) => ({ ...t, id: `m${t.id}`, key: `M-${t.key}` })),
    ];
    const { proposals } = planBatch(work, pool, cfg);
    for (const p of proposals.filter((x) => x.taskId.startsWith('t')))
      expect(p.toUserId).toBe('auto');
  });

  it('approved leave: someone unavailable for the whole window gets nothing; partial leave reduces share', () => {
    const pool = [
      person('away', { availableDays: 0, capacityHours: 0 }),
      person('half', { availableDays: 5, capacityHours: 40 }),
      person('full'),
    ];
    const s = shares(planBatch(tickets(30), pool, cfg).proposals);
    expect(s.away).toBeUndefined();
    expect(s.full).toBeGreaterThan(s.half!);
  });

  it('critical tickets go first and to the most proficient person when workloads are equal', () => {
    const pool = [
      person('junior', { skills: { testing: 2 } }),
      person('senior', { skills: { testing: 5 } }),
    ];
    const work = [
      ...tickets(3),
      {
        ...tickets(1)[0]!,
        id: 'crit',
        key: 'QA-999',
        priority: 'critical' as Priority,
        requiredSkills: [{ name: 'Testing', minLevel: 1 }],
      },
    ];
    const { proposals } = planBatch(work, pool, cfg);
    expect(proposals[0]!.taskId).toBe('crit');
    expect(proposals[0]!.toUserId).toBe('senior');
  });

  it('no eligible employees: every ticket is skipped with a reason', () => {
    const { proposals, skipped } = planBatch(
      tickets(5, { requiredSkills: [{ name: 'Mainframe', minLevel: 4 }] }),
      [person('a'), person('b')],
      cfg,
    );
    expect(proposals).toEqual([]);
    expect(skipped).toHaveLength(5);
    expect(skipped[0]!.reason).toMatch(/needs mainframe level 4/);
  });

  it('respects capacity: work beyond total capacity is skipped, nobody is over-allocated', () => {
    const pool = [person('a', { capacityHours: 10 }), person('b', { capacityHours: 10 })];
    const { proposals, skipped, finalLoads } = planBatch(tickets(15), pool, cfg);
    expect(proposals).toHaveLength(10);
    expect(skipped).toHaveLength(5);
    expect(skipped[0]!.reason).toMatch(/over capacity/);
    for (const l of finalLoads.values()) expect(l).toBeLessThanOrEqual(10);
  });

  it('does not keep assigning to the same person when everyone is equal (ties rotate)', () => {
    const { proposals } = planBatch(
      tickets(4),
      ['a', 'b', 'c', 'd'].map((id) => person(id)),
      cfg,
    );
    expect(new Set(proposals.map((p) => p.toUserId)).size).toBe(4);
  });

  it('ranking is deterministic for identical inputs', () => {
    const t = tickets(1)[0]!;
    const pool = ['d', 'b', 'a', 'c'].map((id) => person(id));
    expect(rank(t, pool, cfg).map((r) => r.candidate.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('rebalancing', () => {
  it('moves unstarted work from an overloaded person to an underused one until within thresholds', () => {
    const pool = [
      person('over', { loadHours: 100, openTasks: 10 }),
      person('idle', { loadHours: 8, openTasks: 1 }),
    ];
    const movable = new Map([['over', tickets(10, { effortHours: 10 })]]);
    const { moves, finalLoads } = planRebalance(pool, movable, cfg);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => m.fromUserId === 'over' && m.toUserId === 'idle')).toBe(true);
    expect(finalLoads.get('over')!).toBeLessThan(100);
    expect(finalLoads.get('idle')!).toBeLessThanOrEqual(finalLoads.get('over')!);
  });

  it('does nothing when the team is already balanced', () => {
    const pool = [person('a', { loadHours: 50 }), person('b', { loadHours: 55 })];
    expect(planRebalance(pool, new Map([['b', tickets(3)]]), cfg).moves).toEqual([]);
  });
});
