import { describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { signAccessToken, verifyAccessToken } from '../src/core/auth/jwt';
import { eventBus } from '../src/core/events';
import { escapeRegex, toPageMeta, toPageWindow } from '../src/core/pagination';
import { startOfOrgDay, toOrgDate, tzOffsetMinutes } from '../src/core/time';
import { stripMongoOperators } from '../src/middleware/sanitize';

describe('pagination', () => {
  it('computes skip/limit and a stable sort from an allow-listed field', () => {
    const w = toPageWindow({ page: 3, limit: 20, sort: '-dueDate' }, ['dueDate', 'createdAt']);
    expect(w).toEqual({ skip: 40, limit: 20, sort: { dueDate: -1, _id: -1 } });
  });

  it('rejects sorting by a field outside the allow-list', () => {
    expect(() => toPageWindow({ page: 1, limit: 20, sort: 'passwordHash' }, ['createdAt'])).toThrow(
      /not supported/,
    );
  });

  it('builds page meta', () => {
    expect(toPageMeta({ page: 2, limit: 10 }, 45)).toEqual({
      page: 2,
      limit: 10,
      total: 45,
      totalPages: 5,
    });
    expect(toPageMeta({ page: 1, limit: 10 }, 0).totalPages).toBe(0);
  });

  it('escapes regex metacharacters in search text', () => {
    expect(new RegExp(escapeRegex('a.b*(c)')).test('a.b*(c)')).toBe(true);
    expect(new RegExp(escapeRegex('a.b')).test('axb')).toBe(false);
  });
});

describe('org timezone helpers (Asia/Kolkata)', () => {
  it('IST is UTC+05:30', () => {
    expect(tzOffsetMinutes(new Date('2026-11-06T00:00:00Z'))).toBe(330);
  });

  it('an instant just after IST midnight belongs to the IST day, not the UTC day', () => {
    // 2026-11-05T19:00Z == 2026-11-06 00:30 IST
    expect(toOrgDate(new Date('2026-11-05T19:00:00Z'))).toBe('2026-11-06');
  });

  it('startOfOrgDay returns the UTC instant of IST midnight', () => {
    expect(startOfOrgDay('2026-11-06').toISOString()).toBe('2026-11-05T18:30:00.000Z');
  });

  it('handles DST zones correctly', () => {
    // New York switches to EST on 2026-11-01.
    expect(startOfOrgDay('2026-11-02', 'America/New_York').toISOString()).toBe(
      '2026-11-02T05:00:00.000Z',
    );
    expect(startOfOrgDay('2026-10-30', 'America/New_York').toISOString()).toBe(
      '2026-10-30T04:00:00.000Z',
    );
  });
});

describe('access tokens', () => {
  it('round-trips claims', () => {
    const token = signAccessToken({ sub: 'user-1', tv: 3 });
    expect(verifyAccessToken(token)).toEqual({ sub: 'user-1', tv: 3 });
  });

  it('rejects tampered, foreign and alg-none tokens', () => {
    const token = signAccessToken({ sub: 'user-1', tv: 0 });
    expect(() => verifyAccessToken(`${token}x`)).toThrow('Invalid access token');
    const foreign = jwt.sign({ sub: 'user-1', tv: 0 }, 'some-other-secret-that-is-long-enough!!', {
      issuer: 'arihant-workspace',
      audience: 'arihant-workspace-api',
    });
    expect(() => verifyAccessToken(foreign)).toThrow('Invalid access token');
    const none = jwt.sign({ sub: 'user-1', tv: 0 }, '', { algorithm: 'none' });
    expect(() => verifyAccessToken(none)).toThrow();
  });

  it('reports expiry distinctly', () => {
    const expired = jwt.sign({ sub: 'u', tv: 0 }, process.env.JWT_ACCESS_SECRET!, {
      issuer: 'arihant-workspace',
      audience: 'arihant-workspace-api',
      expiresIn: -10,
    });
    expect(() => verifyAccessToken(expired)).toThrow('Access token expired');
  });
});

describe('stripMongoOperators', () => {
  it('removes operator and dotted keys at any depth, keeps normal data', () => {
    const input = {
      name: 'ok',
      $where: 'sleep(1000)',
      nested: { 'a.b': 1, keep: [{ $ne: null, v: 2 }] },
      createdAt: new Date(0),
    };
    expect(stripMongoOperators(input)).toEqual({
      name: 'ok',
      nested: { keep: [{ v: 2 }] },
      createdAt: new Date(0),
    });
  });

  it('drops prototype-pollution keys', () => {
    const polluted = JSON.parse('{"__proto__": {"admin": true}, "x": 1}');
    const clean = stripMongoOperators(polluted) as Record<string, unknown>;
    expect(clean).toEqual({ x: 1 });
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
  });
});

describe('eventBus', () => {
  it('delivers events and isolates failing subscribers', async () => {
    const good = vi.fn();
    const offBad = eventBus.subscribe('test.event', () => {
      throw new Error('boom');
    });
    const offGood = eventBus.subscribe('test.event', good);
    expect(() => eventBus.publish('test.event', { id: 1 }, { actorId: 'u1' })).not.toThrow();
    await new Promise((r) => setImmediate(r));
    expect(good).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'test.event', payload: { id: 1 }, actorId: 'u1', depth: 0 }),
    );
    offBad();
    offGood();
  });
});
