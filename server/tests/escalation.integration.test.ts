import type { TaskStatus } from '@arihant/shared';
import { describe, expect, it } from 'vitest';
import { addDaysIso, orgToday } from '../src/core/time';
import { Department } from '../src/modules/departments/department.model';
import { Notification } from '../src/modules/notifications/notification.model';
import {
  escalateOverdue,
  OVERDUE_ESCALATION,
} from '../src/modules/notifications/notification.subscribers';
import { Project } from '../src/modules/projects/project.model';
import { Task } from '../src/modules/tasks/task.model';
import { createDepartment, createUser, useHarness } from './helpers/harness';

useHarness();
const today = orgToday();

describe('overdue escalation', () => {
  it('tells the manager and PM after 3 days and the department head after 7, once each', async () => {
    const dept = await createDepartment('ESC');
    const head = await createUser({ role: 'department_head', departmentId: dept._id });
    await Department.updateOne({ _id: dept._id }, { headId: head._id });
    const lead = await createUser({ role: 'team_lead', departmentId: dept._id });
    const pm = await createUser({ role: 'project_manager', departmentId: dept._id });
    const dev = await createUser({
      role: 'developer',
      departmentId: dept._id,
      managerId: lead._id,
    });
    const project = await Project.create({
      key: 'ESC',
      name: 'Escalation',
      managerId: pm._id,
      ownerId: pm._id,
      departmentId: dept._id,
    });
    const mk = (key: string, daysLate: number, status: TaskStatus = 'in_progress') =>
      Task.create({
        key,
        projectId: project._id,
        title: `Late by ${daysLate}`,
        reporterId: pm._id,
        assigneeId: dev._id,
        rank: key,
        status,
        dueDate: addDaysIso(today, -daysLate),
      });
    await mk('ESC-1', OVERDUE_ESCALATION.managers);
    await mk('ESC-2', OVERDUE_ESCALATION.departmentHead);
    await mk('ESC-3', 5); // between steps: nobody is told today
    await mk('ESC-4', OVERDUE_ESCALATION.managers, 'done'); // finished: never escalated

    expect(await escalateOverdue(today)).toBe(3);
    const notes = await Notification.find({ type: 'task_escalated' }).lean();
    const to = (id: unknown) =>
      notes.filter((n) => String(n.userId) === String(id)).map((n) => n.title);
    expect(to(lead._id)).toEqual(['ESC-1 is 3 days overdue']);
    expect(to(pm._id)).toEqual(['ESC-1 is 3 days overdue']);
    expect(to(head._id)).toEqual(['ESC-2 is 7 days overdue']);
    expect(to(dev._id)).toEqual([]);
  });
});
