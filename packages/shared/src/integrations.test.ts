import { describe, expect, it } from 'vitest';
import {
  gitSettingsSchema,
  normaliseTransitionName,
  parseGitReferences,
  parseSmartCommits,
} from './integrations';

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

describe('parseSmartCommits', () => {
  it('reads Jira-style commands with their arguments', () => {
    expect(
      parseSmartCommits('TRD-42 #comment Fixed the timeout #time 1w 2d 4h 30m Tuning #in-review'),
    ).toEqual([
      {
        keys: ['TRD-42'],
        commands: [
          { kind: 'comment', text: 'Fixed the timeout' },
          { kind: 'time', minutes: 2400 + 960 + 240 + 30, text: 'Tuning' },
          { kind: 'transition', name: 'in-review', text: '' },
        ],
      },
    ]);
    expect(parseSmartCommits('JRA-1 JRA-2 #done Shipped')).toEqual([
      {
        keys: ['JRA-1', 'JRA-2'],
        commands: [{ kind: 'transition', name: 'done', text: 'Shipped' }],
      },
    ]);
    expect(parseSmartCommits('TRD-7 #time 1.5h')[0]!.commands).toEqual([
      { kind: 'time', minutes: 90, text: '' },
    ]);
  });

  it('keeps commands on their own line and ignores keys, issue numbers and empty commands', () => {
    expect(
      parseSmartCommits('TRD-1 #start-progress\n\nTRD-2 #comment Second line\n#done with no key'),
    ).toEqual([
      { keys: ['TRD-1'], commands: [{ kind: 'transition', name: 'start-progress', text: '' }] },
      { keys: ['TRD-2'], commands: [{ kind: 'comment', text: 'Second line' }] },
    ]);
    // "#TRD-42" is a key mention, "#12" a pull request, "a#b" not a command.
    expect(parseSmartCommits('Work on #TRD-42, see #12 and a#b')).toEqual([]);
    expect(parseSmartCommits('TRD-3 #comment')).toEqual([]);
    expect(parseSmartCommits('TRD-3 #time soon')).toEqual([]);
    expect(normaliseTransitionName('Start_progress  -now')).toBe('start progress now');
  });
});
