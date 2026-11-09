import { Types } from 'mongoose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { addDaysIso, dayOfWeekIso, orgToday, weekStartIso } from '../src/core/time';
import { Task } from '../src/modules/tasks/task.model';
import { Availability } from '../src/modules/tracking/tracking.models';
import { User } from '../src/modules/users/user.model';
import { createDepartment, createUser, loginAs, useHarness } from './helpers/harness';

const h = useHarness();
const api = () => request(h.app);
const today = orgToday();
const nextMonday = addDaysIso(weekStartIso(today), 7);

describe('capacity planning', () => {
  it('plans hours against work week by week, with leave, overdue and unscheduled work', async () => {
    const dept = await createDepartment('CAP');
    const lead = await loginAs(h.app, 'team_lead', { departmentId: dept._id });
    const dev = await createUser({
      role: 'developer',
      departmentId: dept._id,
      managerId: lead.user._id,
    });
    await User.updateOne(
      { _id: dev._id },
      { weeklyCapacityHours: 40, skills: [{ name: 'Java', level: 4 }] },
    );
    // Leave for the whole of next week.
    await Availability.create({
      userId: dev._id,
      type: 'leave',
      from: nextMonday,
      to: addDaysIso(nextMonday, 4),
      status: 'approved',
    });
    const projectId = new Types.ObjectId();
    let n = 0;
    const mk = (over: Record<string, unknown>) =>
      Task.create({
        key: `CAP-${++n}`,
        projectId,
        title: `Task ${n}`,
        reporterId: lead.user._id,
        assigneeId: dev._id,
        rank: String(n),
        status: 'todo',
        ...over,
      });
    // 50 h from Monday to Friday of the week after next: 10 h a day, all in that week.
    const monday3 = addDaysIso(nextMonday, 7);
    await mk({
      estimatedHours: 50,
      startDate: monday3,
      dueDate: addDaysIso(monday3, 4),
      requiredSkills: [{ name: 'Java', minLevel: 2 }],
    });
    await mk({ estimatedHours: 6, dueDate: addDaysIso(today, -2) }); // overdue
    await mk({ estimatedHours: 3 }); // no due date

    const res = await api().get('/api/v1/teams/capacity?weeks=4').set(lead.auth);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.weeks).toEqual([weekStartIso(today), nextMonday, monday3, addDaysIso(monday3, 7)]);
    const row = d.rows.find((r: { id: string }) => r.id === dev._id.toString());
    // Next week: on leave → no capacity. Week 3: 40 h capacity, 50 h planned.
    expect(row.weeks[1]).toEqual({ capacity: 0, demand: 0 });
    expect(row.weeks[2]).toEqual({ capacity: 40, demand: 50 });
    expect(row.weeks[3].capacity).toBe(40);
    expect(row.overdue).toBe(6);
    expect(row.weeks[0].demand).toBe(6);
    expect(row.unscheduled).toBe(3);
    expect(d.shortfalls).toContainEqual({ row: row.label, week: monday3, gap: 10 });

    // By skill: Java capacity from the developer, demand from the task requiring Java.
    const skill = await api().get('/api/v1/teams/capacity?weeks=4&groupBy=skill').set(lead.auth);
    const java = skill.body.data.rows.find((r: { id: string }) => r.id === 'java');
    expect(java.weeks[2]).toEqual({ capacity: 40, demand: 50 });
    expect(java.people).toBe(1);

    // Current-week capacity counts working days from today only.
    const left = Array.from({ length: 7 }, (_, i) => addDaysIso(today, i)).filter(
      (day) => weekStartIso(day) === weekStartIso(today) && ![0, 6].includes(dayOfWeekIso(day)),
    ).length;
    expect(row.weeks[0].capacity).toBe(left * 8);
  });

  it('needs team access', async () => {
    const emp = await loginAs(h.app, 'employee');
    expect((await api().get('/api/v1/teams/capacity').set(emp.auth)).status).toBe(403);
    const lead = await loginAs(h.app, 'team_lead');
    expect((await api().get('/api/v1/teams/capacity?weeks=99').set(lead.auth)).status).toBe(400);
  });
});
