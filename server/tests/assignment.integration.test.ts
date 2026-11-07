import { Types } from 'mongoose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { Priority, TaskStatus } from '@arihant/shared';
import { autoAssign, registerAutoAssignment } from '../src/modules/assignment/assignment.service';
import { AssignmentHistory } from '../src/modules/collab/collab.models';
import { Project } from '../src/modules/projects/project.model';
import { Task } from '../src/modules/tasks/task.model';
import { Availability } from '../src/modules/tracking/tracking.models';
import { User } from '../src/modules/users/user.model';
import { orgToday, addDaysIso } from '../src/core/time';
import { createUser, loginAs, useHarness } from './helpers/harness';

const h = useHarness();
const api = () => request(h.app);

/** QA project with a PM and N testers; tasks are inserted directly for speed. */
async function qaSetup(testers = 4) {
  const pm = await loginAs(h.app, 'project_manager');
  const people: Awaited<ReturnType<typeof createUser>>[] = [];
  for (let i = 0; i < testers; i += 1) {
    people.push(
      await createUser({ role: 'qa_tester', name: `Tester ${String.fromCharCode(65 + i)}` }),
    );
  }
  await User.updateMany(
    { _id: { $in: people.map((p) => p._id) } },
    { $set: { skills: [{ name: 'Testing', level: 3 }], weeklyCapacityHours: 40 } },
  );
  const project = await Project.create({
    key: 'QA',
    name: 'Regression Cycle',
    managerId: pm.user._id,
    members: [
      { userId: pm.user._id, role: 'manager' as const },
      ...people.map((p) => ({ userId: p._id, role: 'member' as const })),
    ],
  });
  return { pm, testers: people, project };
}

let seq = 0;
async function insertTasks(
  projectId: Types.ObjectId,
  n: number,
  over: Partial<{
    priority: Priority;
    status: TaskStatus;
    estimatedHours: number;
    assigneeId: Types.ObjectId;
    requiredSkills: { name: string; minLevel: number }[];
  }> = {},
) {
  const reporter = new Types.ObjectId();
  const docs = Array.from({ length: n }, () => {
    seq += 1;
    return {
      key: `QA-${seq}`,
      projectId,
      title: `Test case ${seq}`,
      reporterId: reporter,
      status: over.status ?? 'todo',
      priority: over.priority ?? 'medium',
      estimatedHours: over.estimatedHours ?? 2,
      assigneeId: over.assigneeId ?? null,
      requiredSkills: over.requiredSkills ?? [],
      rank: `V${seq}`,
    };
  });
  return Task.insertMany(
    docs as unknown as Parameters<typeof Task.insertMany>[0],
  ) as unknown as Promise<{ _id: Types.ObjectId }[]>;
}

const countByAssignee = async (projectId: Types.ObjectId) => {
  const rows = await Task.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { projectId, assigneeId: { $ne: null } } },
    { $group: { _id: '$assigneeId', n: { $sum: 1 } } },
  ]);
  return rows.map((r) => r.n).sort((a, b) => a - b);
};

describe('batch assignment end to end', () => {
  it('100 tickets, 4 testers: preview shows 25 each; approval assigns exactly that and records history', async () => {
    const { pm, project } = await qaSetup(4);
    await insertTasks(project._id, 100);
    const preview = await api()
      .post('/api/v1/assignment/plans/batch')
      .set(pm.auth)
      .send({ projectId: project._id.toString() });
    expect(preview.status).toBe(201);
    expect(preview.body.data.proposals).toHaveLength(100);
    expect(preview.body.data.skipped).toEqual([]);
    const after = preview.body.data.workload
      .map((w: { tasksAdded: number }) => w.tasksAdded)
      .filter(Boolean)
      .sort();
    expect(after).toEqual([25, 25, 25, 25]);
    expect(
      preview.body.data.workload.every((w: { overCapacity: boolean }) => !w.overCapacity),
    ).toBe(true);

    const approved = await api()
      .post(`/api/v1/assignment/plans/${preview.body.data.id}/approve`)
      .set(pm.auth);
    expect(approved.status).toBe(202);
    expect(approved.body.data).toMatchObject({
      status: 'executed',
      result: { assigned: 100, conflicts: [] },
    });
    expect(await countByAssignee(project._id)).toEqual([25, 25, 25, 25]);
    expect(
      await AssignmentHistory.countDocuments({ method: 'batch', batchId: preview.body.data.id }),
    ).toBe(100);
  });

  it('approved leave excludes a tester; required skills restrict candidates', async () => {
    const { pm, testers, project } = await qaSetup(3);
    await Availability.create({
      userId: testers[0]!._id,
      from: orgToday(),
      to: addDaysIso(orgToday(), 30),
      status: 'approved',
      type: 'leave',
    });
    await User.updateOne(
      { _id: testers[1]!._id },
      {
        $set: {
          skills: [
            { name: 'Automation', level: 4 },
            { name: 'Testing', level: 3 },
          ],
        },
      },
    );
    await insertTasks(project._id, 4, { requiredSkills: [{ name: 'Automation', minLevel: 3 }] });
    await insertTasks(project._id, 6);
    const preview = await api()
      .post('/api/v1/assignment/plans/batch')
      .set(pm.auth)
      .send({ projectId: project._id.toString() });
    const to = (p: { toUser: { id: string } | null }) => p.toUser?.id;
    const proposals = preview.body.data.proposals as {
      key: string;
      title: string;
      toUser: { id: string } | null;
    }[];
    expect(proposals.some((p) => to(p) === testers[0]!._id.toString())).toBe(false);
    const automationTasks = proposals.slice(0, 4);
    for (const p of proposals.filter((x) => automationTasks.includes(x)))
      expect(to(p)).toBe(testers[1]!._id.toString());
  });

  it('no eligible employees: every ticket is skipped with a reason and nothing is assigned', async () => {
    const { pm, project } = await qaSetup(2);
    await insertTasks(project._id, 3, { requiredSkills: [{ name: 'Mainframe', minLevel: 5 }] });
    const preview = await api()
      .post('/api/v1/assignment/plans/batch')
      .set(pm.auth)
      .send({ projectId: project._id.toString() });
    expect(preview.body.data.proposals).toEqual([]);
    expect(preview.body.data.skipped).toHaveLength(3);
    expect(preview.body.data.skipped[0].reason).toMatch(/mainframe/i);
  });

  it('a manager override changes one assignment before approval', async () => {
    const { pm, testers, project } = await qaSetup(2);
    const [task] = await insertTasks(project._id, 1);
    const preview = await api()
      .post('/api/v1/assignment/plans/batch')
      .set(pm.auth)
      .send({ projectId: project._id.toString() });
    const proposed = preview.body.data.proposals[0].toUser.id;
    const other = testers.find((t) => t._id.toString() !== proposed)!;
    const modified = await api()
      .patch(`/api/v1/assignment/plans/${preview.body.data.id}`)
      .set(pm.auth)
      .send({ proposals: [{ taskId: task!._id.toString(), toUserId: other._id.toString() }] });
    expect(modified.body.data.proposals[0]).toMatchObject({
      toUser: { id: other._id.toString() },
      reason: 'Manager override',
    });
    await api().post(`/api/v1/assignment/plans/${preview.body.data.id}/approve`).set(pm.auth);
    expect((await Task.findById(task!._id).lean())!.assigneeId?.toString()).toBe(
      other._id.toString(),
    );
  });

  it('developers cannot distribute work', async () => {
    const { project } = await qaSetup(1);
    const dev = await loginAs(h.app, 'developer');
    const res = await api()
      .post('/api/v1/assignment/plans/batch')
      .set(dev.auth)
      .send({ projectId: project._id.toString() });
    expect(res.status).toBe(403);
  });
});

describe('concurrency and idempotency', () => {
  it('approving the same plan 10 times in parallel executes it once', async () => {
    const { pm, project } = await qaSetup(4);
    await insertTasks(project._id, 40);
    const preview = await api()
      .post('/api/v1/assignment/plans/batch')
      .set(pm.auth)
      .send({ projectId: project._id.toString() });
    await Promise.all(
      Array.from({ length: 10 }, () =>
        api().post(`/api/v1/assignment/plans/${preview.body.data.id}/approve`).set(pm.auth),
      ),
    );
    expect(await AssignmentHistory.countDocuments({ batchId: preview.body.data.id })).toBe(40);
    expect(await countByAssignee(project._id)).toEqual([10, 10, 10, 10]);
  });

  it('two overlapping plans approved at the same time never double-assign a task', async () => {
    const { pm, project } = await qaSetup(3);
    await insertTasks(project._id, 30);
    const a = await api()
      .post('/api/v1/assignment/plans/batch')
      .set(pm.auth)
      .send({ projectId: project._id.toString() });
    const b = await api()
      .post('/api/v1/assignment/plans/batch')
      .set(pm.auth)
      .send({ projectId: project._id.toString() });
    const [ra, rb] = await Promise.all([
      api().post(`/api/v1/assignment/plans/${a.body.data.id}/approve`).set(pm.auth),
      api().post(`/api/v1/assignment/plans/${b.body.data.id}/approve`).set(pm.auth),
    ]);
    const results = [ra.body.data.result, rb.body.data.result];
    expect(results[0].assigned + results[1].assigned).toBe(30);
    expect(results[0].conflicts.length + results[1].conflicts.length).toBe(30);
    expect(await AssignmentHistory.countDocuments({ method: 'batch' })).toBe(30);
    // Every task changed hands exactly once.
    const versions = await Task.find({ projectId: project._id }).select('assignmentVersion').lean();
    expect(versions.every((t) => t.assignmentVersion === 1)).toBe(true);
  });

  it('capacity is re-validated at execution: a plan made stale by new work reports conflicts instead of over-allocating', async () => {
    const { pm, testers, project } = await qaSetup(1);
    await User.updateOne({ _id: testers[0]!._id }, { $set: { weeklyCapacityHours: 5 } }); // 10 h over the horizon
    await insertTasks(project._id, 4, { estimatedHours: 2 });
    const plan = await api()
      .post('/api/v1/assignment/plans/batch')
      .set(pm.auth)
      .send({ projectId: project._id.toString() });
    expect(plan.body.data.proposals).toHaveLength(4);
    // Meanwhile someone gives the tester 6 h of other work.
    await insertTasks(project._id, 1, { estimatedHours: 6, assigneeId: testers[0]!._id });
    const res = await api()
      .post(`/api/v1/assignment/plans/${plan.body.data.id}/approve`)
      .set(pm.auth);
    expect(res.body.data.result.assigned).toBe(2);
    expect(res.body.data.result.conflicts).toHaveLength(2);
    expect(res.body.data.result.conflicts[0].reason).toMatch(/no longer has capacity/);
  });
});

describe('suggestions, auto-assignment, reassignment and rebalancing', () => {
  it('suggests ranked candidates with explanations and assigns the chosen one', async () => {
    const { pm, testers, project } = await qaSetup(2);
    await insertTasks(project._id, 5, { assigneeId: testers[0]!._id });
    const [task] = await insertTasks(project._id, 1);
    const s = await api().get(`/api/v1/assignment/tasks/${task!._id}/suggestions`).set(pm.auth);
    expect(s.body.data.candidates[0]).toMatchObject({
      user: { id: testers[1]!._id.toString() },
      eligible: true,
    });
    expect(s.body.data.candidates[0].score).toBeGreaterThan(s.body.data.candidates[1].score);
    const assigned = await api()
      .post(`/api/v1/assignment/tasks/${task!._id}/assign`)
      .set(pm.auth)
      .send({ userId: testers[1]!._id.toString() });
    expect(assigned.body.data.assigned).toBe(true);
    expect(await AssignmentHistory.countDocuments({ method: 'suggested' })).toBe(1);
  });

  it('auto-assigns new tasks in projects that opt in', async () => {
    const { pm, project } = await qaSetup(2);
    await Project.updateOne({ _id: project._id }, { $set: { autoAssign: true } });
    const off = registerAutoAssignment();
    try {
      const created = await api()
        .post('/api/v1/tasks')
        .set(pm.auth)
        .send({ projectId: project._id.toString(), title: 'Smoke test login' });
      let task = null;
      for (let i = 0; i < 40 && !task?.assigneeId; i += 1) {
        await new Promise((r) => setTimeout(r, 50));
        task = await Task.findById(created.body.data.id).lean();
      }
      expect(task?.assigneeId).toBeTruthy();
      expect(
        await AssignmentHistory.countDocuments({ method: 'auto', triggeredBy: 'automation' }),
      ).toBe(1);
    } finally {
      off();
    }
    // Projects that did not opt in are left alone.
    await Project.updateOne({ _id: project._id }, { $set: { autoAssign: false } });
    const [manual] = await insertTasks(project._id, 1);
    expect((await autoAssign(manual!._id.toString())).assigned).toBe(false);
  });

  it('reassignment moves only unstarted, non-critical work; the rest goes to manual review', async () => {
    const { pm, testers, project } = await qaSetup(3);
    const away = testers[0]!._id;
    await insertTasks(project._id, 3, { assigneeId: away, status: 'todo' });
    await insertTasks(project._id, 1, { assigneeId: away, status: 'in_progress' });
    await insertTasks(project._id, 1, { assigneeId: away, status: 'todo', priority: 'critical' });
    const plan = await api()
      .post('/api/v1/assignment/plans/reassign')
      .set(pm.auth)
      .send({ userId: away.toString() });
    expect(plan.status).toBe(201);
    expect(plan.body.data.proposals).toHaveLength(3);
    expect(
      plan.body.data.proposals.every(
        (p: { toUser: { id: string } }) => p.toUser.id !== away.toString(),
      ),
    ).toBe(true);
    expect(plan.body.data.manualReview.map((m: { reason: string }) => m.reason).sort()).toEqual([
      'Critical task: decide manually',
      'Work already started: decide manually',
    ]);
    const done = await api()
      .post(`/api/v1/assignment/plans/${plan.body.data.id}/approve`)
      .set(pm.auth);
    expect(done.body.data.result.assigned).toBe(3);
    expect(await Task.countDocuments({ assigneeId: away })).toBe(2);
    expect(await AssignmentHistory.countDocuments({ method: 'reassign', fromUserId: away })).toBe(
      3,
    );
  });

  it('rebalancing proposes moving unstarted work from an overloaded to an underused tester', async () => {
    const { pm, testers, project } = await qaSetup(2);
    await insertTasks(project._id, 12, { assigneeId: testers[0]!._id, estimatedHours: 8 }); // 96 h vs 80 h capacity
    const plan = await api()
      .post('/api/v1/assignment/plans/rebalance')
      .set(pm.auth)
      .send({ projectId: project._id.toString() });
    expect(plan.status).toBe(201);
    expect(plan.body.data.proposals.length).toBeGreaterThan(0);
    expect(
      plan.body.data.proposals.every(
        (p: { fromUser: { id: string }; toUser: { id: string } }) =>
          p.fromUser.id === testers[0]!._id.toString() &&
          p.toUser.id === testers[1]!._id.toString(),
      ),
    ).toBe(true);
    const balanced = await api()
      .post('/api/v1/assignment/plans/rebalance')
      .set(pm.auth)
      .send({ projectId: project._id.toString() });
    // The first plan has not been applied yet, so a second preview proposes the same moves.
    expect(balanced.status).toBe(201);
  });
});
