import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AuditLog } from '../src/modules/audit/audit-log.model';
import { Task } from '../src/modules/tasks/task.model';
import { createDepartment, loginAs, useHarness } from './helpers/harness';

const h = useHarness();
const api = () => request(h.app);

let seq = 0;
async function setup() {
  seq += 1;
  const dept = await createDepartment(`SR${seq}`);
  const other = await createDepartment(`SO${seq}`);
  const pm = await loginAs(h.app, 'project_manager', { departmentId: dept._id });
  const dev = await loginAs(h.app, 'developer', { departmentId: dept._id, managerId: pm.user._id });
  const outsider = await loginAs(h.app, 'developer', { departmentId: other._id });
  const key = `SR${seq}`;
  const p = await api()
    .post('/api/v1/projects')
    .set(pm.auth)
    .send({
      key,
      name: 'Search Project',
      managerId: pm.user._id.toString(),
      memberIds: [dev.user._id.toString()],
    });
  expect(p.status).toBe(201);
  const mk = async (body: Record<string, unknown>) => {
    const r = await api()
      .post('/api/v1/tasks')
      .set(pm.auth)
      .send({ projectId: p.body.data.id, ...body });
    expect(r.status).toBe(201);
    return r.body.data as { id: string; key: string };
  };
  const t1 = await mk({
    title: 'Login retry fails',
    type: 'bug',
    bug: { severity: 'major' },
    priority: 'critical',
    assigneeId: dev.user._id.toString(),
    tags: ['Auth'],
    dueDate: '2026-01-10',
  });
  const t2 = await mk({ title: 'Order book export', priority: 'low', status: 'in_progress' });
  const t3 = await mk({
    title: 'Session banner',
    priority: 'high',
    status: 'in_review',
    assigneeId: pm.user._id.toString(),
    storyPoints: 5,
  });
  return { pm, dev, outsider, key, projectId: p.body.data.id as string, t1, t2, t3 };
}

const keys = (r: request.Response) => (r.body.data as { key: string }[]).map((t) => t.key).sort();
const search = (auth: Record<string, string>, aql: string, extra = '') =>
  api()
    .get(`/api/v1/search/tasks?aql=${encodeURIComponent(aql)}${extra}`)
    .set(auth);

describe('Query language search', () => {
  it('filters by fields, operators, functions and sorts, within read permissions', async () => {
    const { pm, dev, outsider, key, t1, t2, t3 } = await setup();

    expect(keys(await search(pm.auth, `project = ${key}`))).toEqual(
      [t1.key, t2.key, t3.key].sort(),
    );
    expect(keys(await search(pm.auth, `project = ${key} AND priority >= high`))).toEqual(
      [t1.key, t3.key].sort(),
    );
    expect(keys(await search(dev.auth, `project = ${key} AND assignee = currentUser()`))).toEqual([
      t1.key,
    ]);
    expect(keys(await search(pm.auth, `project = ${key} AND assignee IS EMPTY`))).toEqual([t2.key]);
    expect(
      keys(await search(pm.auth, `project = ${key} AND status IN ("In Review", "in progress")`)),
    ).toEqual([t2.key, t3.key].sort());
    expect(keys(await search(pm.auth, `project = ${key} AND NOT status = "To Do"`))).toEqual(
      [t2.key, t3.key].sort(),
    );
    expect(keys(await search(pm.auth, `project = ${key} AND text ~ "order"`))).toEqual([t2.key]);
    expect(keys(await search(pm.auth, `project = ${key} AND label = auth`))).toEqual([t1.key]);
    expect(
      keys(await search(pm.auth, `project = ${key} AND type = bug AND severity = major`)),
    ).toEqual([t1.key]);
    expect(keys(await search(pm.auth, `project = ${key} AND due < today()`))).toEqual([t1.key]);
    expect(keys(await search(pm.auth, `project = ${key} AND storyPoints >= 3`))).toEqual([t3.key]);
    expect(keys(await search(pm.auth, `project = ${key} AND created >= -1d`))).toHaveLength(3);
    expect(keys(await search(pm.auth, `key IN (${t1.key}, ${t3.key})`))).toEqual(
      [t1.key, t3.key].sort(),
    );

    const sorted = await search(pm.auth, `project = ${key} ORDER BY priority DESC`);
    expect((sorted.body.data as { key: string }[]).map((t) => t.key)).toEqual([
      t1.key,
      t3.key,
      t2.key,
    ]);

    // Someone outside the project cannot see the tasks or learn the project exists.
    const hidden = await search(outsider.auth, `project = ${key}`);
    expect(hidden.status).toBe(422);
    expect(hidden.body.error.message).toContain('that you can see');
    expect(keys(await search(outsider.auth, 'text ~ "Login retry"'))).toEqual([]);
  });

  it('explains mistakes and rejects unsafe input', async () => {
    const { pm } = await setup();
    const bad = await search(pm.auth, 'stats = done');
    expect(bad.status).toBe(422);
    expect(bad.body.error).toMatchObject({
      message: 'Unknown field "stats"',
      details: { position: 0 },
    });
    expect((await search(pm.auth, 'status = finished')).body.error.message).toContain(
      'is not a status',
    );
    expect((await search(pm.auth, 'assignee = nobody@example.invalid')).status).toBe(422);
    expect((await search(pm.auth, 'due < 31-12-2026')).body.error.message).toContain('not a date');
    // Regular-expression characters are matched literally.
    expect((await search(pm.auth, 'text ~ ".*"')).body.data).toEqual([]);
  });

  it('applies a query and quick filters on the board and list endpoints', async () => {
    const { pm, key, projectId, t1, t3 } = await setup();
    const list = await api()
      .get(`/api/v1/tasks?projectId=${projectId}&aql=${encodeURIComponent('priority >= high')}`)
      .set(pm.auth);
    expect(keys(list)).toEqual([t1.key, t3.key].sort());
    await Task.collection.updateOne(
      { key: t1.key },
      { $set: { updatedAt: new Date(Date.now() - 10 * 86_400_000) } },
    );
    const recent = await api()
      .get(`/api/v1/tasks?projectId=${projectId}&updatedWithin=7`)
      .set(pm.auth);
    expect(keys(recent)).not.toContain(t1.key);
    const board = await api()
      .get(
        `/api/v1/tasks/board?projectId=${projectId}&aql=${encodeURIComponent(`project = ${key} AND type = bug`)}`,
      )
      .set(pm.auth);
    expect(board.status).toBe(200);
    const onBoard = (board.body.data as { tasks: { key: string }[] }[]).flatMap((c) =>
      c.tasks.map((t) => t.key),
    );
    expect(onBoard).toEqual([t1.key]);
  });
});

describe('History, statistics and export', () => {
  it('records history on request, groups results and exports CSV and Excel with an audit entry', async () => {
    const { pm, key } = await setup();
    await search(pm.auth, `project = ${key}`, '&record=true');
    await search(pm.auth, `project = ${key} AND type = bug`, '&record=true');
    await search(pm.auth, `project = ${key}`, '&record=true'); // repeated: moves to the top
    await search(pm.auth, 'priority = low'); // not recorded
    const hist = await api().get('/api/v1/search/history').set(pm.auth);
    expect((hist.body.data as { aql: string }[]).map((x) => x.aql)).toEqual([
      `project = ${key}`,
      `project = ${key} AND type = bug`,
    ]);
    expect(hist.body.data[0].resultCount).toBe(3);

    const stats = await api()
      .get(`/api/v1/search/tasks/stats?by=priority&aql=${encodeURIComponent(`project = ${key}`)}`)
      .set(pm.auth);
    expect(stats.body.data).toEqual(
      expect.arrayContaining([
        { key: 'critical', label: 'Critical', count: 1 },
        { key: 'low', label: 'Low', count: 1 },
      ]),
    );

    const csv = await api()
      .get(
        `/api/v1/search/tasks/export?format=csv&columns=key,title,priority&aql=${encodeURIComponent(`project = ${key} ORDER BY key`)}`,
      )
      .set(pm.auth);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    const lines = csv.text.slice(csv.text.indexOf('Key')).split(/\r\n/);
    expect(lines[0]).toBe('Key,Title,Priority');
    expect(lines).toHaveLength(4);

    const xlsx = await api()
      .get(`/api/v1/search/tasks/export?format=xlsx&aql=${encodeURIComponent(`project = ${key}`)}`)
      .set(pm.auth)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(xlsx.status).toBe(200);
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    expect(
      await AuditLog.countDocuments({
        action: { $in: ['export.search_csv', 'export.search_xlsx'] },
      }),
    ).toBeGreaterThanOrEqual(2);

    await api().delete('/api/v1/search/history').set(pm.auth).expect(204);
    expect((await api().get('/api/v1/search/history').set(pm.auth)).body.data).toEqual([]);
  });
});

describe('Saved and shared filters', () => {
  it('saves, shares with a project, stars and protects filters; results follow the viewer’s rights', async () => {
    const { pm, dev, outsider, key, projectId } = await setup();
    const created = await api()
      .post('/api/v1/filters')
      .set(pm.auth)
      .send({
        name: 'Open bugs',
        aql: `project = ${key} AND type = bug`,
        sharing: 'project',
        projectId,
      });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ favourite: true, canEdit: true, sharing: 'project' });
    const id = created.body.data.id as string;

    expect(
      (
        await api()
          .post('/api/v1/filters')
          .set(pm.auth)
          .send({ name: 'Open bugs', aql: 'type = bug' })
      ).status,
    ).toBe(409);
    expect(
      (await api().post('/api/v1/filters').set(pm.auth).send({ name: 'Broken', aql: 'type = ' }))
        .status,
    ).toBe(422);

    // A project member sees the shared filter but cannot change it; an outsider cannot see it.
    const devList = await api().get('/api/v1/filters').set(dev.auth);
    expect(devList.body.data).toEqual([
      expect.objectContaining({ id, canEdit: false, favourite: false }),
    ]);
    expect(
      (await api().patch(`/api/v1/filters/${id}`).set(dev.auth).send({ name: 'Mine' })).status,
    ).toBe(403);
    expect((await api().get(`/api/v1/filters/${id}`).set(outsider.auth)).status).toBe(404);
    expect((await api().get('/api/v1/filters').set(outsider.auth)).body.data).toEqual([]);

    const star = await api()
      .put(`/api/v1/filters/${id}/favourite`)
      .set(dev.auth)
      .send({ favourite: true });
    expect(star.body.data.favourite).toBe(true);

    // Developers cannot share with the whole organisation.
    const orgShare = await api()
      .post('/api/v1/filters')
      .set(dev.auth)
      .send({ name: 'Everything', aql: 'priority = high', sharing: 'org' });
    expect(orgShare.status).toBe(403);

    const renamed = await api()
      .patch(`/api/v1/filters/${id}`)
      .set(pm.auth)
      .send({ name: 'Bugs', sharing: 'private' });
    expect(renamed.body.data).toMatchObject({ name: 'Bugs', sharing: 'private', project: null });
    expect((await api().get('/api/v1/filters').set(dev.auth)).body.data).toEqual([]);
  });

  it('builds dashboard gadgets from filters and hides them when the filter goes away', async () => {
    const { pm, key } = await setup();
    const f = await api()
      .post('/api/v1/filters')
      .set(pm.auth)
      .send({ name: 'All', aql: `project = ${key}` });
    const g = await api()
      .post('/api/v1/filters/gadgets')
      .set(pm.auth)
      .send({ filterId: f.body.data.id, chart: 'bar', by: 'priority' });
    expect(g.status).toBe(201);
    expect(g.body.data).toEqual([
      expect.objectContaining({
        chart: 'bar',
        by: 'priority',
        filter: expect.objectContaining({ name: 'All' }),
      }),
    ]);
    await api().delete(`/api/v1/filters/${f.body.data.id}`).set(pm.auth).expect(204);
    expect((await api().get('/api/v1/filters/gadgets').set(pm.auth)).body.data).toEqual([]);
  });
});

describe('Global search', () => {
  it('finds tasks, projects and people the caller may see', async () => {
    const { pm, outsider, key, t2 } = await setup();
    const r = await api()
      .get(`/api/v1/search?q=${encodeURIComponent('order book')}`)
      .set(pm.auth);
    expect(r.status).toBe(200);
    expect(r.body.data.tasks).toEqual([expect.objectContaining({ key: t2.key, projectKey: key })]);
    const p = await api().get(`/api/v1/search?q=${key}`).set(pm.auth);
    expect(p.body.data.projects).toEqual([expect.objectContaining({ key })]);
    const hidden = await api().get(`/api/v1/search?q=${key}`).set(outsider.auth);
    expect(hidden.body.data.projects).toEqual([]);
    expect(hidden.body.data.tasks).toEqual([]);
    expect((await api().get('/api/v1/search?q=').set(pm.auth)).status).toBe(400);
  });
});
