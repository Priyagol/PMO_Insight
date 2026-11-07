import { describe, expect, it } from 'vitest';
import { checkAql, matchEnum, parseAql, savedFilterSchema, TASK_STATUSES } from './index';

describe('query language parser', () => {
  it('parses conditions, precedence, lists, functions and sorting', () => {
    const q = parseAql(
      'project = TRD AND (status IN ("To Do", in_progress) OR priority >= high) AND assignee = currentUser() ORDER BY due DESC, key',
    );
    expect(q.orderBy).toEqual([
      { field: 'due', dir: 'desc' },
      { field: 'key', dir: 'asc' },
    ]);
    expect(q.where).toMatchObject({
      type: 'and',
      children: [
        { type: 'clause', field: 'project', op: '=', values: [{ kind: 'word', value: 'TRD' }] },
        {
          type: 'or',
          children: [
            {
              field: 'status',
              op: 'IN',
              values: [
                { kind: 'string', value: 'To Do' },
                { kind: 'word', value: 'in_progress' },
              ],
            },
            { field: 'priority', op: '>=' },
          ],
        },
        { field: 'assignee', values: [{ kind: 'function', name: 'currentUser' }] },
      ],
    });
  });

  it('understands aliases, case, NOT, IS EMPTY and relative dates', () => {
    const q = parseAql(
      'Summary ~ "login" and not labels is empty and created >= -2w and due < today()',
    );
    expect(q.where).toMatchObject({
      type: 'and',
      children: [
        { field: 'title', op: '~' },
        { type: 'not', child: { field: 'label', op: 'IS', values: [{ kind: 'empty' }] } },
        { field: 'created', values: [{ kind: 'relative', days: -14 }] },
        { field: 'due', values: [{ kind: 'function', name: 'today' }] },
      ],
    });
    expect(parseAql('assignee IS NOT EMPTY').where).toMatchObject({ op: 'IS NOT' });
    expect(parseAql('status NOT IN (done, cancelled)').where).toMatchObject({ op: 'NOT IN' });
    expect(parseAql('').where).toBeNull();
    expect(parseAql('ORDER BY updated DESC').orderBy).toEqual([{ field: 'updated', dir: 'desc' }]);
  });

  it('reports clear errors with positions', () => {
    expect(checkAql('stats = done')).toEqual({
      ok: false,
      message: 'Unknown field "stats"',
      position: 0,
    });
    expect(checkAql('status ~ done')).toMatchObject({ ok: false, position: 7 });
    expect(checkAql('status = done priority = high')).toMatchObject({
      ok: false,
      message: expect.stringContaining('AND or OR'),
    });
    expect(checkAql('title ~ "open')).toMatchObject({ message: 'Closing quote missing' });
    expect(checkAql('(status = done')).toMatchObject({ message: 'Closing bracket missing' });
    expect(checkAql('due < yesterday()')).toMatchObject({
      message: 'Unknown function "yesterday()"',
    });
    expect(checkAql('ORDER BY description')).toMatchObject({ ok: false });
    expect(checkAql('status = done; drop')).toMatchObject({ ok: false });
    expect(checkAql(Array(51).fill('key = A-1').join(' OR '))).toMatchObject({ ok: false });
  });

  it('matches statuses by value or label', () => {
    expect(matchEnum('In Review', TASK_STATUSES)).toBe('in_review');
    expect(matchEnum('to do', TASK_STATUSES)).toBe('todo');
    expect(matchEnum('in-progress', TASK_STATUSES)).toBe('in_progress');
    expect(matchEnum('finished', TASK_STATUSES)).toBeNull();
  });

  it('requires a project when a filter is shared with a project', () => {
    expect(
      savedFilterSchema.safeParse({ name: 'x', aql: 'status = done', sharing: 'project' }).success,
    ).toBe(false);
    expect(savedFilterSchema.parse({ name: 'x', aql: 'status = done' }).sharing).toBe('private');
  });
});
