import { describe, expect, it } from 'vitest';
import {
  createAutomationSchema,
  describeSchedule,
  titleSimilarity,
  titleTokens,
} from './automation';

describe('title similarity', () => {
  it('normalises case, punctuation, stop words and plurals', () => {
    expect([...titleTokens('Fix the Login bugs!')]).toEqual(['fix', 'login', 'bug']);
  });
  it('scores near-duplicates high and unrelated titles low', () => {
    expect(
      titleSimilarity('Fix login bug on Safari', 'Login bug fix for safari'),
    ).toBeGreaterThanOrEqual(0.8);
    expect(titleSimilarity('Fix login bug', 'Fix logn bug')).toBeGreaterThanOrEqual(0.45);
    expect(titleSimilarity('Fix login bug', 'Quarterly audit report')).toBeLessThan(0.2);
    expect(titleSimilarity('', 'anything')).toBe(0);
  });
});

describe('scheduled rules', () => {
  const base = {
    name: 'Nudge',
    projectId: null,
    conditions: { match: 'all' as const, conditions: [] },
    actions: [{ type: 'add_tag' as const, tag: 'x' }],
  };
  it('requires a schedule (and a weekday for weekly ones)', () => {
    expect(createAutomationSchema.safeParse({ ...base, trigger: 'schedule' }).success).toBe(false);
    expect(
      createAutomationSchema.safeParse({
        ...base,
        trigger: 'schedule',
        schedule: { frequency: 'weekly', hour: 9 },
      }).success,
    ).toBe(false);
    expect(
      createAutomationSchema.safeParse({
        ...base,
        trigger: 'schedule',
        schedule: { frequency: 'daily', hour: 9 },
      }).success,
    ).toBe(true);
  });
  it('describes schedules in plain language', () => {
    expect(describeSchedule({ frequency: 'daily', weekday: null, hour: 9 })).toBe(
      'Every day at 09:00',
    );
    expect(describeSchedule({ frequency: 'weekly', weekday: 1, hour: 17 })).toBe(
      'Every Monday at 17:00',
    );
  });
});
