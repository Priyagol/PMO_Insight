import ExcelJS from 'exceljs';
import pdfmake from 'pdfmake';
import { Types } from 'mongoose';
import {
  OPEN_RISK_STATUSES,
  PRIORITY_LABELS,
  STATUS_LABELS,
  type AnalyticsQuery,
  type ManagementSnapshotDto,
} from '@arihant/shared';
import { requireAuth, type RequestContext } from '../../core/rbac/context';
import { taskReadFilter } from '../../core/rbac/work-access';
import { addDaysIso, orgToday, toOrgDate } from '../../core/time';
import { recordAudit } from '../audit/audit.service';
import { ProjectVersion } from '../projects/project.model';
import { Risk } from '../risks/risk.model';
import { getOrgSettings } from '../settings/settings.service';
import { Task } from '../tasks/task.model';
import { Journal, Worklog } from '../tracking/tracking.models';
import { User } from '../users/user.model';
import { overview, resolveScope } from './analytics.service';
import { computeHealth } from './health.service';

// PDFs use the built-in standard fonts and never fetch files or URLs.
pdfmake.setFonts({
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
});
pdfmake.setUrlAccessPolicy(() => false);
// Standard PDF fonts are resolved by name; allow exactly those and no real file paths.
const STANDARD_FONTS = new Set([
  'Helvetica',
  'Helvetica-Bold',
  'Helvetica-Oblique',
  'Helvetica-BoldOblique',
]);
pdfmake.setLocalAccessPolicy((path: string) => STANDARD_FONTS.has(path));

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Management snapshot for a period, cut to the caller's analytics scope. */
export async function buildSnapshot(
  rc: RequestContext,
  q: Partial<AnalyticsQuery>,
): Promise<ManagementSnapshotDto> {
  const auth = requireAuth(rc);
  const s = await resolveScope(auth, q);
  const { from, to } = s.period;
  const today = orgToday();
  const ov = await overview(rc, q);
  const taskScope = {
    projectId: { $in: s.projectIds },
    deletedAt: null,
    ...(s.personal ? { assigneeId: auth.userObjectId } : {}),
  };
  const projectName = new Map(s.projects.map((p) => [p._id.toString(), `${p.key} ${p.name}`]));
  const fromInstant = new Date(`${addDaysIso(from, -1)}T00:00:00Z`);
  const toInstant = new Date(`${addDaysIso(to, 2)}T00:00:00Z`);

  const [completed, overdue, blocked, issues, versions, health, logged, completedBy] =
    await Promise.all([
      Task.find({
        ...taskScope,
        status: 'done',
        completedAt: { $gte: fromInstant, $lt: toInstant },
      })
        .sort({ completedAt: -1 })
        .limit(500)
        .lean(),
      Task.find({
        ...taskScope,
        status: { $nin: ['done', 'cancelled'] },
        dueDate: { $ne: null, $lt: today },
      })
        .sort({ dueDate: 1 })
        .limit(300)
        .lean(),
      Task.find({ ...taskScope, status: 'blocked' })
        .limit(100)
        .lean(),
      Risk.find({
        projectId: { $in: s.projectIds },
        deletedAt: null,
        status: { $in: [...OPEN_RISK_STATUSES] },
        type: { $in: ['issue', 'blocker'] },
      })
        .limit(100)
        .lean(),
      ProjectVersion.find({
        projectId: { $in: s.projectIds },
        createdAt: { $gte: fromInstant, $lt: toInstant },
      })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
      computeHealth(s.projects.filter((p) => p.status !== 'completed' && p.status !== 'cancelled')),
      Worklog.aggregate<{ _id: Types.ObjectId; m: number }>([
        {
          $match: {
            projectId: { $in: s.projectIds },
            date: { $gte: from, $lte: to },
            ...(s.personal
              ? { userId: auth.userObjectId }
              : s.people && s.people !== 'all'
                ? { userId: { $in: s.people } }
                : {}),
          },
        },
        { $group: { _id: '$userId', m: { $sum: '$minutes' } } },
      ]),
      Task.aggregate<{ _id: Types.ObjectId; n: number }>([
        {
          $match: {
            ...taskScope,
            status: 'done',
            completedAt: { $gte: fromInstant, $lt: toInstant },
            assigneeId: { $ne: null },
          },
        },
        { $group: { _id: '$assigneeId', n: { $sum: 1 } } },
      ]),
    ]);
  const journalBlockers =
    s.personal || s.people === null
      ? []
      : await Journal.find({
          date: { $gte: from, $lte: to },
          blockers: { $ne: '' },
          ...(s.people === 'all' ? {} : { userId: { $in: s.people } }),
        })
          .sort({ date: -1 })
          .limit(50)
          .lean();

  const userIds = new Set<string>();
  [...completed, ...overdue].forEach((t) => t.assigneeId && userIds.add(t.assigneeId.toString()));
  versions.forEach((v) => v.changedBy && userIds.add(v.changedBy.toString()));
  logged.forEach((l) => userIds.add(l._id.toString()));
  completedBy.forEach((c) => userIds.add(c._id.toString()));
  journalBlockers.forEach((j) => userIds.add(j.userId.toString()));
  s.projects.forEach((p) => userIds.add(p.managerId.toString()));
  const names = new Map(
    (
      await User.find({ _id: { $in: [...userIds] } })
        .select('name')
        .lean()
    ).map((u) => [u._id.toString(), u.name]),
  );
  const name = (id?: Types.ObjectId | null) =>
    id ? (names.get(id.toString()) ?? 'Unknown') : 'Unassigned';

  const contributions = new Map<string, { hours: number; tasksCompleted: number }>();
  logged.forEach((l) =>
    contributions.set(l._id.toString(), { hours: r1(l.m / 60), tasksCompleted: 0 }),
  );
  completedBy.forEach((c) => {
    const cur = contributions.get(c._id.toString()) ?? { hours: 0, tasksCompleted: 0 };
    contributions.set(c._id.toString(), { ...cur, tasksCompleted: c.n });
  });

  return {
    generatedAt: new Date().toISOString(),
    generatedBy: auth.name,
    period: { from, to },
    scope: s.label,
    summary: {
      projectsActive: ov.projects.active,
      projectsDelayed: ov.projects.delayed,
      tasksCompleted: ov.tasks.completedInPeriod,
      tasksPending: ov.tasks.open,
      tasksOverdue: ov.tasks.overdue,
      hoursLogged: ov.hours.loggedInPeriod,
    },
    completed: completed.map((t) => ({
      key: t.key,
      title: t.title,
      project: projectName.get(t.projectId.toString()) ?? '',
      assignee: name(t.assigneeId),
      completedAt: toOrgDate(t.completedAt!),
    })),
    overdue: overdue.map((t) => ({
      key: t.key,
      title: t.title,
      project: projectName.get(t.projectId.toString()) ?? '',
      assignee: name(t.assigneeId),
      dueDate: t.dueDate!,
      priority: t.priority,
    })),
    delayedProjects: s.projects
      .filter(
        (p) =>
          p.status !== 'completed' && p.status !== 'cancelled' && p.endDate && p.endDate < today,
      )
      .map((p) => ({
        key: p.key,
        name: p.name,
        endDate: p.endDate!,
        progress: health.find((h) => h.project.id === p._id.toString())?.progress ?? 0,
        manager: name(p.managerId),
      })),
    health: health.map((h) => ({
      key: h.project.key,
      name: h.project.name,
      score: h.score,
      band: h.band,
      topIssue:
        h.warnings[0]?.message ?? [...h.factors].sort((a, b) => a.value - b.value)[0]!.detail,
    })),
    contributions: [...contributions]
      .map(([id, c]) => ({ name: names.get(id) ?? 'Unknown', ...c }))
      .sort((a, b) => b.hours - a.hours),
    departments: ov.departments,
    blockers: [
      ...blocked.map((t) => ({
        source: 'Blocked task',
        project: projectName.get(t.projectId.toString()) ?? '',
        title: `${t.key} ${t.title}`,
        detail: `Assigned to ${name(t.assigneeId)}`,
      })),
      ...issues.map((r) => ({
        source: r.type === 'issue' ? 'Open issue' : 'Blocker',
        project: projectName.get(r.projectId.toString()) ?? '',
        title: `${r.key} ${r.title}`,
        detail: `Severity ${r.severity}`,
      })),
      ...journalBlockers.map((j) => ({
        source: 'Daily journal',
        project: '',
        title: names.get(j.userId.toString()) ?? 'Unknown',
        detail: `${j.date}: ${j.blockers.slice(0, 200)}`,
      })),
    ],
    upcoming: [
      ...ov.upcoming.projects.map((p) => ({
        kind: 'project' as const,
        key: p.key,
        title: p.name,
        date: p.endDate,
      })),
      ...ov.upcoming.tasks.map((t) => ({
        kind: 'task' as const,
        key: t.key,
        title: t.title,
        date: t.dueDate,
      })),
    ].sort((a, b) => a.date.localeCompare(b.date)),
    changes: versions.map((v) => ({
      project: projectName.get(v.projectId.toString()) ?? '',
      at: v.createdAt.toISOString().slice(0, 10),
      by: name(v.changedBy),
      change: v.changes
        .map(
          (c) =>
            `${c.field}: ${c.field === 'status' ? (STATUS_LABELS[c.from as keyof typeof STATUS_LABELS] ?? String(c.from)) : String(c.from ?? '—')} → ${c.field === 'status' ? (STATUS_LABELS[c.to as keyof typeof STATUS_LABELS] ?? String(c.to)) : String(c.to ?? '—')}`,
        )
        .join('; '),
    })),
  };
}

/* ---------- Renderers ---------- */

type Table = { title: string; head: string[]; rows: (string | number)[][] };

function sections(s: ManagementSnapshotDto): Table[] {
  return [
    {
      title: 'Project health',
      head: ['Project', 'Name', 'Score', 'Band', 'Main concern'],
      rows: s.health.map((h) => [h.key, h.name, h.score, h.band.replace('_', ' '), h.topIssue]),
    },
    {
      title: 'Delayed projects',
      head: ['Project', 'Name', 'End date', 'Progress %', 'Manager'],
      rows: s.delayedProjects.map((p) => [p.key, p.name, p.endDate, p.progress, p.manager]),
    },
    {
      title: 'Overdue tasks',
      head: ['Task', 'Title', 'Project', 'Assignee', 'Due', 'Priority'],
      rows: s.overdue.map((t) => [
        t.key,
        t.title,
        t.project,
        t.assignee,
        t.dueDate,
        PRIORITY_LABELS[t.priority],
      ]),
    },
    {
      title: 'Completed work',
      head: ['Task', 'Title', 'Project', 'Assignee', 'Completed'],
      rows: s.completed.map((t) => [t.key, t.title, t.project, t.assignee, t.completedAt]),
    },
    {
      title: 'Blockers',
      head: ['Source', 'Project', 'Item', 'Detail'],
      rows: s.blockers.map((b) => [b.source, b.project, b.title, b.detail]),
    },
    {
      title: 'Employee contributions',
      head: ['Employee', 'Hours logged', 'Tasks completed'],
      rows: s.contributions.map((c) => [c.name, c.hours, c.tasksCompleted]),
    },
    {
      title: 'Department performance',
      head: ['Department', 'Projects', 'Open tasks', 'Overdue', 'Completed', 'Hours'],
      rows: s.departments.map((d) => [
        d.name,
        d.projects,
        d.openTasks,
        d.overdue,
        d.completed,
        d.loggedHours,
      ]),
    },
    {
      title: 'Upcoming deadlines',
      head: ['Type', 'Key', 'Title', 'Date'],
      rows: s.upcoming.map((u) => [u.kind, u.key, u.title, u.date]),
    },
    {
      title: 'Major project changes',
      head: ['Project', 'Date', 'By', 'Change'],
      rows: s.changes.map((c) => [c.project, c.at, c.by, c.change]),
    },
  ];
}

export async function renderSnapshotPdf(s: ManagementSnapshotDto): Promise<Buffer> {
  const org = await getOrgSettings();
  const kpis: [string, number][] = [
    ['Active projects', s.summary.projectsActive],
    ['Delayed projects', s.summary.projectsDelayed],
    ['Tasks completed', s.summary.tasksCompleted],
    ['Tasks pending', s.summary.tasksPending],
    ['Tasks overdue', s.summary.tasksOverdue],
    ['Hours logged', s.summary.hoursLogged],
  ];
  const content: Record<string, unknown>[] = [
    { text: `${org.organizationName} · Management Snapshot`, style: 'title' },
    {
      text: `Period ${s.period.from} to ${s.period.to} · scope: ${s.scope} · generated ${s.generatedAt.slice(0, 16).replace('T', ' ')} UTC by ${s.generatedBy}`,
      style: 'meta',
    },
    {
      table: {
        widths: Array(6).fill('*'),
        body: [
          kpis.map(([l]) => ({ text: l, style: 'kpiLabel' })),
          kpis.map(([, v]) => ({ text: String(v), style: 'kpiValue' })),
        ],
      },
      layout: 'noBorders',
      margin: [0, 8, 0, 12],
    },
  ];
  for (const t of sections(s)) {
    content.push({ text: `${t.title} (${t.rows.length})`, style: 'h2' });
    if (t.rows.length === 0) {
      content.push({ text: 'None in this period.', style: 'muted' });
      continue;
    }
    content.push({
      table: {
        headerRows: 1,
        widths: t.head.map((_, i) => (i === 0 ? 'auto' : '*')),
        body: [
          t.head.map((h) => ({ text: h, style: 'th' })),
          ...t.rows.slice(0, 200).map((r) => r.map((c) => ({ text: String(c), style: 'td' }))),
        ],
      },
      layout: 'lightHorizontalLines',
    });
    if (t.rows.length > 200)
      content.push({
        text: `…and ${t.rows.length - 200} more (see the Excel export).`,
        style: 'muted',
      });
  }
  const doc = {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [32, 32, 32, 40],
    defaultStyle: { font: 'Helvetica', fontSize: 8.5 },
    footer: (page: number, pages: number) => ({
      text: `Page ${page} of ${pages} · Confidential: internal use only`,
      alignment: 'center',
      fontSize: 7,
      color: '#64748b',
      margin: [0, 12, 0, 0],
    }),
    content,
    styles: {
      title: { fontSize: 16, bold: true, color: '#0f1b33' },
      meta: { fontSize: 8, color: '#64748b', margin: [0, 2, 0, 0] },
      kpiLabel: { fontSize: 7.5, color: '#64748b' },
      kpiValue: { fontSize: 15, bold: true, color: '#0f172a' },
      h2: { fontSize: 11, bold: true, margin: [0, 12, 0, 4], color: '#0f1b33' },
      th: { bold: true, fontSize: 8, color: '#334155' },
      td: { fontSize: 8 },
      muted: { fontSize: 8, color: '#64748b', italics: true },
    },
  };
  return pdfmake.createPdf(doc as never).getBuffer();
}

export async function renderSnapshotXlsx(s: ManagementSnapshotDto): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Arihant Workspace';
  wb.created = new Date();
  const summary = wb.addWorksheet('Summary');
  summary.addRows([
    ['Management Snapshot'],
    ['Period', `${s.period.from} to ${s.period.to}`],
    ['Scope', s.scope],
    ['Generated', `${s.generatedAt} by ${s.generatedBy}`],
    [],
    ['Active projects', s.summary.projectsActive],
    ['Delayed projects', s.summary.projectsDelayed],
    ['Tasks completed', s.summary.tasksCompleted],
    ['Tasks pending', s.summary.tasksPending],
    ['Tasks overdue', s.summary.tasksOverdue],
    ['Hours logged', s.summary.hoursLogged],
  ]);
  summary.getCell('A1').font = { bold: true, size: 14 };
  summary.getColumn(1).width = 22;
  summary.getColumn(2).width = 40;
  for (const t of sections(s)) {
    const ws = wb.addWorksheet(t.title.slice(0, 31));
    ws.addRow(t.head).font = { bold: true };
    t.rows.forEach((r) => ws.addRow(r));
    ws.columns.forEach((c, i) => (c.width = i === 0 ? 14 : 28));
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: t.head.length } };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Spreadsheet-safe CSV cell: quotes, and neutralises formula injection (=, +, -, @). */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Tasks visible to the caller as CSV (filtered by project and period of last update). */
export async function tasksCsv(rc: RequestContext, q: { projectId?: string }): Promise<string> {
  const auth = requireAuth(rc);
  const filter = {
    $and: [
      await taskReadFilter(auth),
      ...(q.projectId ? [{ projectId: new Types.ObjectId(q.projectId) }] : []),
    ],
  };
  const tasks = await Task.find(filter).sort({ projectId: 1, key: 1 }).limit(20000).lean();
  const users = new Map(
    (
      await User.find({
        _id: { $in: tasks.flatMap((t) => [t.assigneeId, t.reporterId]).filter(Boolean) },
      })
        .select('name')
        .lean()
    ).map((u) => [u._id.toString(), u.name]),
  );
  const head = [
    'Key',
    'Title',
    'Status',
    'Priority',
    'Assignee',
    'Reporter',
    'Start',
    'Due',
    'Estimate (h)',
    'Logged (h)',
    'Tags',
    'Created',
    'Completed',
  ];
  const rows = tasks.map((t) => [
    t.key,
    t.title,
    STATUS_LABELS[t.status],
    PRIORITY_LABELS[t.priority],
    t.assigneeId ? users.get(t.assigneeId.toString()) : '',
    users.get(t.reporterId.toString()) ?? '',
    t.startDate ?? '',
    t.dueDate ?? '',
    t.estimatedHours ?? '',
    t.actualHours,
    t.tags.join('; '),
    toOrgDate(t.createdAt),
    t.completedAt ? toOrgDate(t.completedAt) : '',
  ]);
  await recordAudit(rc, {
    action: 'export.tasks_csv',
    entityType: 'export',
    summary: `Exported ${tasks.length} task(s) to CSV`,
  });
  return '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}
