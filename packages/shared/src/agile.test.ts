import { describe, expect, it } from 'vitest';
import {
  createSprintSchema,
  createTaskSchema,
  median,
  projectAgileSettingsSchema,
  storyPointsSchema,
  updateTaskSchema,
} from './index';

const id = '64b000000000000000000001';

describe('agile schemas', () => {
  it('accepts whole and half story points only, within 0-100', () => {
    for (const ok of [0, 0.5, 3, 13, 100, null])
      expect(storyPointsSchema.safeParse(ok).success).toBe(true);
    for (const bad of [-1, 1.25, 101]) expect(storyPointsSchema.safeParse(bad).success).toBe(false);
  });

  it('defaults new tasks to type task and keeps bug details for bugs only', () => {
    expect(createTaskSchema.parse({ projectId: id, title: 'Do it' })).toMatchObject({
      type: 'task',
      components: [],
    });
    expect(
      createTaskSchema.safeParse({
        projectId: id,
        title: 'Bug',
        type: 'bug',
        bug: { severity: 'minor' },
      }).success,
    ).toBe(true);
    expect(
      createTaskSchema.safeParse({
        projectId: id,
        title: 'Story',
        type: 'story',
        bug: { severity: 'minor' },
      }).success,
    ).toBe(false);
    expect(
      createTaskSchema.safeParse({ projectId: id, title: 'Epic', type: 'epic', parentId: id })
        .success,
    ).toBe(false);
  });

  it('does not inject the default type on partial updates', () => {
    expect(updateTaskSchema.parse({ title: 'Renamed' })).toEqual({ title: 'Renamed' });
  });

  it('validates sprint dates and unique component names', () => {
    expect(
      createSprintSchema.safeParse({
        projectId: id,
        startDate: '2026-11-10',
        endDate: '2026-11-01',
      }).success,
    ).toBe(false);
    expect(
      projectAgileSettingsSchema.safeParse({ components: [{ name: 'API' }, { name: 'api' }] })
        .success,
    ).toBe(false);
    expect(projectAgileSettingsSchema.safeParse({ wipLimits: { in_progress: 3 } }).success).toBe(
      true,
    );
  });

  it('computes medians', () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
