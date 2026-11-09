import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Task } from '../src/modules/tasks/task.model';
import { nextRun, runDueSubscriptions } from '../src/modules/reporting/reporting.service';
import { createDepartment, loginAs, useHarness } from './helpers/harness';

const h = useHarness();
const api = () => request(h.app);

let seq = 0;
async function setup() {
  seq += 1;
  const dept = await createDepartment(`RP${seq}`);
  const pm = await loginAs(h.app, 'project_manager', { departmentId: dept._id });
  const dev = await loginAs(h.app, 'developer', { departmentId: dept._id });
  const outsider = await loginAs(h.app, 'developer');
  const key = `RP${seq}`;
  const p = (
    await api()
      .post('/api/v1/projects')
      .set(pm.auth)
      .send({
        key,
        name: 'Reporting',
        managerId: pm.user._id.toString(),
        memberIds: [dev.user._id.toString()],
      })
  ).body.data as { id: string };
  const mk = async (title: string) =>
    (await api().post('/api/v1/tasks').set(pm.auth).send({ projectId: p.id, title })).body.data as {
      id: string;
      key: string;
    };
  return { pm, dev, outsider, key, projectId: p.id, mk };
}

describe('Created vs resolved', () => {
  it('counts tasks created and resolved per day for a query', async () => {
    const { pm, key, mk } = await setup();
    const a = await mk('Alpha');
    const b = await mk('Bravo');
    await mk('Charlie');
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000);
    await Task.collection.updateOne(
      { _id: new (await import('mongoose')).Types.ObjectId(a.id) },
      { $set: { createdAt: day(-3) } },
    );
    await api()
      .patch(`/api/v1/tasks/${b.id}`)
      .set(pm.auth)
      .send({ status: 'in_progress' })
      .expect(200);
    await api().patch(`/api/v1/tasks/${b.id}`).set(pm.auth).send({ status: 'done' }).expect(200);
    const r = await api()
      .get(`/api/v1/reporting/created-vs-resolved?aql=${encodeURIComponent(`project = ${key}`)}`)
      .set(pm.auth);
    expect(r.status).toBe(200);
    expect(r.body.data.totals).toEqual({ created: 3, resolved: 1 });
    expect(r.body.data.points).toHaveLength(30);
    const last = r.body.data.points.at(-1);
    expect(last).toMatchObject({ created: 2, resolved: 1 });
    expect(last.openChange).toBe(2); // 3 created − 1 resolved over the period
    const weekly = await api()
      .get(
        `/api/v1/reporting/created-vs-resolved?interval=week&aql=${encodeURIComponent(`project = ${key}`)}`,
      )
      .set(pm.auth);
    expect(
      weekly.body.data.points.reduce((s: number, p: { created: number }) => s + p.created, 0),
    ).toBe(3);
    expect(
      (
        await api()
          .get('/api/v1/reporting/created-vs-resolved?from=2026-01-10&to=2026-01-01')
          .set(pm.auth)
      ).status,
    ).toBe(422);
  });
});

describe('Scheduled report e-mails', () => {
  it('works out the next run in the organisation time zone', () => {
    // Friday 2026-11-06 10:00 IST = 04:30 UTC.
    const now = new Date('2026-11-06T04:30:00Z');
    expect(
      nextRun({ frequency: 'weekly', dayOfWeek: 1, dayOfMonth: 1, hour: 9 }, now).toISOString(),
    ).toBe('2026-11-09T03:30:00.000Z');
    expect(
      nextRun({ frequency: 'daily', dayOfWeek: 1, dayOfMonth: 1, hour: 11 }, now).toISOString(),
    ).toBe('2026-11-06T05:30:00.000Z');
    expect(
      nextRun({ frequency: 'monthly', dayOfWeek: 1, dayOfMonth: 1, hour: 9 }, now).toISOString(),
    ).toBe('2026-12-01T03:30:00.000Z');
    // Quarterly: day 1 of the next financial quarter (January), or July if the year starts in January.
    const q = { frequency: 'quarterly' as const, dayOfWeek: 1, dayOfMonth: 1, hour: 9 };
    expect(nextRun(q, now).toISOString()).toBe('2027-01-01T03:30:00.000Z');
    expect(nextRun({ ...q, dayOfMonth: 5 }, new Date('2026-10-02T04:30:00Z')).toISOString()).toBe(
      '2026-10-05T03:30:00.000Z',
    );
    expect(nextRun(q, now, 2).toISOString()).toBe('2027-02-01T03:30:00.000Z');
  });

  it('e-mails a filter export to each recipient with their own access, and skips people without it', async () => {
    const { pm, dev, outsider, key, projectId, mk } = await setup();
    await mk('Visible task');
    const f = await api()
      .post('/api/v1/filters')
      .set(pm.auth)
      .send({ name: 'Weekly open work', aql: `project = ${key}`, sharing: 'project', projectId });
    const sub = await api()
      .post('/api/v1/reporting/subscriptions')
      .set(pm.auth)
      .send({
        name: 'Weekly open work',
        report: 'filter',
        filterId: f.body.data.id,
        format: 'csv',
        frequency: 'weekly',
        dayOfWeek: 1,
        hour: 9,
        recipientIds: [
          pm.user._id.toString(),
          dev.user._id.toString(),
          outsider.user._id.toString(),
        ],
      });
    expect(sub.status).toBe(201);
    expect(new Date(sub.body.data.nextRunAt).getTime()).toBeGreaterThan(Date.now());
    expect(
      (
        await api()
          .post('/api/v1/reporting/subscriptions')
          .set(pm.auth)
          .send({
            name: 'Bad',
            report: 'filter',
            filterId: f.body.data.id,
            format: 'pdf',
            frequency: 'daily',
            recipientIds: [pm.user._id.toString()],
          })
      ).status,
    ).toBe(400);

    h.emails.length = 0;
    expect(await runDueSubscriptions(new Date(Date.now() + 8 * 86_400_000))).toBe(1);
    const mails = h.emails.filter((m) => m.subject.startsWith('Weekly open work'));
    expect(mails.map((m) => m.to).sort()).toEqual([dev.user.email, pm.user.email].sort());
    const csv = Buffer.from(mails[0]!.attachments![0]!.contentBase64, 'base64').toString('utf8');
    expect(csv).toContain('Visible task');
    const list = await api().get('/api/v1/reporting/subscriptions').set(pm.auth);
    expect(list.body.data[0].lastResult).toContain('sent to 2');
    expect(list.body.data[0].lastResult).toContain('skipped');

    // Not due again until the next week.
    h.emails.length = 0;
    expect(await runDueSubscriptions(new Date(Date.now() + 8 * 86_400_000))).toBe(0);
  });

  it('sends the management snapshot as a PDF on demand and lets only the owner manage it', async () => {
    const { pm, dev } = await setup();
    const sub = await api()
      .post('/api/v1/reporting/subscriptions')
      .set(pm.auth)
      .send({
        name: 'Monthly snapshot',
        report: 'snapshot',
        format: 'pdf',
        frequency: 'monthly',
        dayOfMonth: 1,
        recipientIds: [pm.user._id.toString()],
      });
    expect(sub.status).toBe(201);
    h.emails.length = 0;
    const sent = await api()
      .post(`/api/v1/reporting/subscriptions/${sub.body.data.id}/send`)
      .set(pm.auth);
    expect(sent.body.data.lastResult).toBe('sent to 1');
    const att = h.emails.at(-1)!.attachments![0]!;
    expect(att.contentType).toBe('application/pdf');
    expect(Buffer.from(att.contentBase64, 'base64').subarray(0, 4).toString()).toBe('%PDF');
    expect(
      (await api().delete(`/api/v1/reporting/subscriptions/${sub.body.data.id}`).set(dev.auth))
        .status,
    ).toBe(404);
    await api()
      .delete(`/api/v1/reporting/subscriptions/${sub.body.data.id}`)
      .set(pm.auth)
      .expect(204);
  });
});
