import { describe, expect, it } from 'vitest';
import { gitSettingsSchema, parseGitReferences } from './integrations';

describe('parseGitReferences', () => {
  it('finds task keys in commit messages, PR text and branch names', () => {
    expect(parseGitReferences('TRD-42 add retry with backoff')).toEqual({
      keys: ['TRD-42'],
      fixes: [],
    });
    expect(parseGitReferences('PR title', null, 'feature/TRD-12-login')).toEqual({
      keys: ['TRD-12'],
      fixes: [],
    });
    expect(parseGitReferences('prefixTRD-1 and TRD-2x and trd-3').keys).toEqual([]);
    expect(parseGitReferences('Fix typo in README').keys).toEqual([]);
  });

  it('treats fixes / closes / resolves (any case) as commands for the keys that follow', () => {
    expect(parseGitReferences('fixes TRD-42')).toEqual({ keys: ['TRD-42'], fixes: ['TRD-42'] });
    expect(parseGitReferences('Closes: TRD-1, TRD-2 and TRD-3; see OPS-7')).toEqual({
      keys: ['TRD-1', 'TRD-2', 'TRD-3', 'OPS-7'],
      fixes: ['TRD-1', 'TRD-2', 'TRD-3'],
    });
    expect(parseGitReferences('TRD-42: RESOLVED TRD-43').fixes).toEqual(['TRD-43']);
    expect(parseGitReferences('Fixed TRD-5', 'also fix TRD-6').fixes).toEqual(['TRD-5', 'TRD-6']);
    expect(parseGitReferences('fixes #12 for TRD-9').fixes).toEqual([]);
  });

  it('validates repository names in settings', () => {
    expect(
      gitSettingsSchema.safeParse({
        enabled: true,
        repos: ['arihant/trading-platform'],
        moveOnFix: true,
      }).success,
    ).toBe(true);
    expect(
      gitSettingsSchema.safeParse({
        enabled: true,
        repos: ['https://github.com/x/y'],
        moveOnFix: true,
      }).success,
    ).toBe(false);
  });
});
