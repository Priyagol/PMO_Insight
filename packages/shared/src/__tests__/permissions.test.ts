import { describe, expect, it } from 'vitest';
import { hasPermission, mergeGrants } from '../permissions';
import { paginationQuerySchema } from '../api';

describe('mergeGrants', () => {
  it('keeps the widest scope per permission', () => {
    const map = mergeGrants([
      { permission: 'task:read', scope: 'own' },
      { permission: 'task:read', scope: 'department' },
      { permission: 'task:read', scope: 'project' },
      { permission: 'worklog:write', scope: 'own' },
    ]);
    expect(map).toEqual({ 'task:read': 'department', 'worklog:write': 'own' });
  });
});

describe('hasPermission', () => {
  const map = mergeGrants([{ permission: 'project:read', scope: 'project' }]);

  it('grants when scope is wide enough', () => {
    expect(hasPermission(map, 'project:read')).toBe(true);
    expect(hasPermission(map, 'project:read', 'project')).toBe(true);
  });

  it('denies when scope is too narrow or permission missing', () => {
    expect(hasPermission(map, 'project:read', 'org')).toBe(false);
    expect(hasPermission(map, 'project:create')).toBe(false);
    expect(hasPermission(null, 'project:read')).toBe(false);
  });
});

describe('paginationQuerySchema', () => {
  it('applies defaults and coerces strings', () => {
    expect(paginationQuerySchema.parse({ page: '3' })).toEqual({ page: 3, limit: 20 });
  });

  it('rejects oversize pages and injection-like sort fields', () => {
    expect(paginationQuerySchema.safeParse({ limit: '1000' }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ sort: '$where' }).success).toBe(false);
  });
});
