import { describe, expect, it } from 'vitest';
import { isValidRank, rankBetween } from '../rank';
import { canTransition, createProjectSchema, taskListQuerySchema } from '../work';

describe('rankBetween', () => {
  it('orders between neighbours and at both ends', () => {
    const a = rankBetween(null, null);
    const b = rankBetween(a, null);
    const c = rankBetween(null, a);
    const mid = rankBetween(a, b);
    expect([c, a, mid, b]).toEqual([c, a, mid, b].slice().sort());
    expect(new Set([a, b, c, mid]).size).toBe(4);
  });

  it('keeps inserting at the same spot without collisions (500 times)', () => {
    let low = rankBetween(null, null);
    const high = rankBetween(low, null);
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const r = rankBetween(low, high);
      expect(r > low && r < high).toBe(true);
      expect(isValidRank(r)).toBe(true);
      expect(seen.has(r)).toBe(false);
      seen.add(r);
      low = r;
    }
  });

  it('prepending 1000 items stays ordered', () => {
    let first: string | null = null;
    for (let i = 0; i < 1000; i += 1) {
      const r = rankBetween(null, first);
      if (first) expect(r < first).toBe(true);
      expect(isValidRank(r)).toBe(true);
      first = r;
    }
  });

  it('appending 1000 items keeps ranks short', () => {
    let last: string | null = null;
    for (let i = 0; i < 1000; i += 1) {
      const r = rankBetween(last, null);
      expect(typeof r).toBe('string');
      if (last) expect(r > last).toBe(true);
      expect(isValidRank(r)).toBe(true);
      last = r;
    }
    expect(last!.length).toBeLessThan(30);
  });
});

describe('task workflow', () => {
  it('allows defined transitions and blocks shortcuts', () => {
    expect(canTransition('todo', 'in_progress')).toBe(true);
    expect(canTransition('done', 'in_progress')).toBe(true);
    expect(canTransition('backlog', 'done')).toBe(false);
    expect(canTransition('cancelled', 'done')).toBe(false);
    expect(canTransition('testing', 'testing')).toBe(true);
  });
});

describe('schemas', () => {
  it('normalises project keys and checks date order', () => {
    const base = { name: 'Trading Revamp', managerId: 'a'.repeat(24) };
    expect(createProjectSchema.parse({ ...base, key: 'trd' }).key).toBe('TRD');
    expect(createProjectSchema.safeParse({ ...base, key: '1AB' }).success).toBe(false);
    expect(
      createProjectSchema.safeParse({
        ...base,
        key: 'TRD',
        startDate: '2026-12-01',
        endDate: '2026-11-01',
      }).success,
    ).toBe(false);
  });

  it('accepts comma-separated multi-value filters', () => {
    expect(taskListQuerySchema.parse({ status: 'todo,in_progress' }).status).toEqual([
      'todo',
      'in_progress',
    ]);
    expect(taskListQuerySchema.safeParse({ status: 'todo,nope' }).success).toBe(false);
  });
});
