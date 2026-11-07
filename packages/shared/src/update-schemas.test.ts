import { describe, expect, it } from 'vitest';
import * as shared from './index';

/**
 * PATCH schemas must only contain the fields the client sent. `.partial()` keeps inner
 * `.default()`s, which would silently reset omitted fields (e.g. a project's status).
 */
describe('update schemas', () => {
  const updates = Object.entries(shared).filter(([name]) => /^update\w*Schema$/.test(name));

  it('finds the update schemas', () => {
    expect(updates.map(([n]) => n)).toEqual(
      expect.arrayContaining([
        'updateProjectSchema',
        'updateWorklogSchema',
        'updateRiskSchema',
        'updateTaskSchema',
      ]),
    );
  });

  it.each(updates)('%s never injects default values', (_name, schema) => {
    const result = (
      schema as { safeParse: (v: unknown) => { success: boolean; data?: unknown } }
    ).safeParse({});
    if (result.success) expect(result.data).toEqual({});
  });

  it('create schemas still apply their defaults', () => {
    const risk = shared.createRiskSchema.parse({
      projectId: '0'.repeat(24),
      title: 'Vendor delay',
      probability: 2,
      impact: 3,
    });
    expect(risk.type).toBe('risk');
    expect(risk.linkedTaskIds).toEqual([]);
  });
});
