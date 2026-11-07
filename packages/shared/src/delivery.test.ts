import { describe, expect, it } from 'vitest';
import {
  createChangeRequestSchema,
  createDocumentSchema,
  createFeedbackSchema,
  createReleaseSchema,
  deploySchema,
  rollbackSchema,
  updateDocumentSchema,
  updateReleaseSchema,
} from './delivery';

const id = '64b000000000000000000001';

describe('delivery schemas', () => {
  it('defaults new documents to internal-only and rejects unknown keys', () => {
    const d = createDocumentSchema.parse({ projectId: id, title: 'Design notes' });
    expect(d).toMatchObject({ category: 'other', tags: [], sharedWithStakeholders: false });
    expect(
      createDocumentSchema.safeParse({ projectId: id, title: 'x2', status: 'published' }).success,
    ).toBe(false);
  });

  it('does not apply create defaults on partial document updates', () => {
    expect(updateDocumentSchema.parse({ title: 'Renamed' })).toEqual({ title: 'Renamed' });
  });

  it('accepts common release version formats and rejects unsafe ones', () => {
    for (const version of ['2.4.0', '2026.11-r1', 'v1.0.0+build.7']) {
      expect(createReleaseSchema.safeParse({ projectId: id, version }).success).toBe(true);
    }
    for (const version of ['', '../etc', '1.0 beta', '-1']) {
      expect(createReleaseSchema.safeParse({ projectId: id, version }).success).toBe(false);
    }
  });

  it('never lets a release be marked released or rolled back through a plain update', () => {
    expect(updateReleaseSchema.safeParse({ status: 'released' }).success).toBe(false);
    expect(updateReleaseSchema.safeParse({ status: 'rolled_back' }).success).toBe(false);
    expect(updateReleaseSchema.safeParse({ status: 'cancelled' }).success).toBe(true);
  });

  it('defaults a deployment to success and requires a rollback reason', () => {
    expect(deploySchema.parse({ environment: 'uat' })).toEqual({
      environment: 'uat',
      outcome: 'deployed',
    });
    expect(deploySchema.safeParse({ environment: 'staging' }).success).toBe(false);
    expect(rollbackSchema.safeParse({ environment: 'prod', reason: '' }).success).toBe(false);
    expect(rollbackSchema.safeParse({ environment: 'prod', reason: 'Login broken' }).success).toBe(
      true,
    );
  });

  it('validates change requests and feedback ratings', () => {
    expect(
      createChangeRequestSchema.safeParse({ projectId: id, title: 'Add CSV export' }).success,
    ).toBe(true);
    expect(
      createChangeRequestSchema.safeParse({
        projectId: id,
        title: 'Add CSV export',
        status: 'approved',
      }).success,
    ).toBe(false);
    const fb = { projectId: id, stakeholderId: id, receivedOn: '2026-11-02' };
    expect(createFeedbackSchema.safeParse({ ...fb, rating: 5 }).success).toBe(true);
    expect(createFeedbackSchema.safeParse({ ...fb, rating: 0 }).success).toBe(false);
    expect(createFeedbackSchema.safeParse({ ...fb, rating: 4.5 }).success).toBe(false);
  });
});
