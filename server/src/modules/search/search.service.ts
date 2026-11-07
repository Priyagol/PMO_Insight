import ExcelJS from 'exceljs';
import { Types, type QueryFilter } from 'mongoose';
import {
  ISSUE_TYPE_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  exportSearchQuerySchema,
  gadgetSchema,
  savedFilterSchema,
  searchStatsQuerySchema,
  searchTasksQuerySchema,
  updateSavedFilterSchema,
  type ExportColumn,
  type GadgetDto,
  type GadgetInput,
  type GlobalSearchDto,
  type IssueType,
  type PageMeta,
  type Priority,
  type SavedFilterDto,
  type SavedFilterInput,
  type SearchHistoryDto,
  type SearchStatDto,
  type SearchTasksQuery,
  type StatGroup,
  type TaskDto,
  type TaskStatus,
} from '@arihant/shared';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
} from '../../core/errors';
import { escapeRegex, toPageMeta } from '../../core/pagination';
import { can } from '../../core/rbac/policy';
import { requireAuth, type AuthContext, type RequestContext } from '../../core/rbac/context';
import { peopleFilter, readableProjectIds, taskReadFilter } from '../../core/rbac/work-access';
import { toOrgDate } from '../../core/time';
import { Sprint } from '../agile/sprint.model';
import { recordAudit } from '../audit/audit.service';
import { DocumentModel } from '../delivery/delivery.models';
import { isExternal } from '../delivery/document.service';
import { csvCell } from '../insights/report.service';
import { Project } from '../projects/project.model';
import { Task, type ITask } from '../tasks/task.model';
import { presentTasks } from '../tasks/task.presenter';
import { User } from '../users/user.model';
import { compileAql } from './aql.compiler';
import { FilterGadget, SavedFilter, SearchHistory, type ISavedFilter } from './search.models';

const oid = (id: string) => new Types.ObjectId(id);
const HISTORY_KEEP = 30;
const EXPORT_LIMIT = 10_000;
const MAX_FILTERS = 100;
const MAX_GADGETS = 12;

/** Database filter and sort for a query, always limited to tasks the caller may read. */
export async function aqlTaskFilter(
  auth: AuthContext,
  aql: string,
): Promise<{ filter: QueryFilter<ITask>; sort: Record<string, 1 | -1> | null }> {
  const compiled = await compileAql(auth, aql);
  const and: QueryFilter<ITask>[] = [await taskReadFilter(auth), compiled.filter];
  if (!compiled.namesProject) {
    // Archived projects are left out unless the query names a project.
    const archived = await Project.find({ archived: true }).select('_id').lean();
    if (archived.length) and.push({ projectId: { $nin: archived.map((p) => p._id) } });
  }
  return { filter: { $and: and }, sort: compiled.sort };
}

/* ---------- Search ---------- */

export async function searchTasks(
  rc: RequestContext,
  raw: SearchTasksQuery,
): Promise<{ items: TaskDto[]; meta: PageMeta }> {
  const auth = requireAuth(rc);
  const q = searchTasksQuerySchema.parse(raw);
  const { filter, sort } = await aqlTaskFilter(auth, q.aql);
  const [docs, total] = await Promise.all([
    Task.find(filter)
      .sort(sort ?? { updatedAt: -1, _id: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    Task.countDocuments(filter),
  ]);
  if (q.record === 'true' && q.aql) await remember(auth, q.aql, total);
  return { items: await presentTasks(auth, docs), meta: toPageMeta(q, total) };
}

async function remember(auth: AuthContext, aql: string, resultCount: number): Promise<void> {
  await SearchHistory.updateOne(
    { userId: auth.userObjectId, aql },
    { $set: { resultCount, at: new Date() } },
    { upsert: true },
  );
  const old = await SearchHistory.find({ userId: auth.userObjectId })
    .sort({ at: -1 })
    .skip(HISTORY_KEEP)
    .select('_id')
    .lean();
  if (old.length) await SearchHistory.deleteMany({ _id: { $in: old.map((o) => o._id) } });
}

export async function listHistory(rc: RequestContext): Promise<SearchHistoryDto[]> {
  const auth = requireAuth(rc);
  const rows = await SearchHistory.find({ userId: auth.userObjectId })
    .sort({ at: -1 })
    .limit(HISTORY_KEEP)
    .lean();
  return rows.map((r) => ({
    id: r._id.toString(),
    aql: r.aql,
    resultCount: r.resultCount,
    at: r.at.toISOString(),
  }));
}

export async function clearHistory(rc: RequestContext): Promise<void> {
  const auth = requireAuth(rc);
  await SearchHistory.deleteMany({ userId: auth.userObjectId });
}

/* ---------- Statistics (charts and dashboard gadgets) ---------- */

const GROUP_PATH: Record<StatGroup, string> = {
  status: '$status',
  priority: '$priority',
  type: '$type',
  assignee: '$assigneeId',
  project: '$projectId',
};

export async function searchStats(rc: RequestContext, raw: unknown): Promise<SearchStatDto[]> {
  const auth = requireAuth(rc);
  const q = searchStatsQuerySchema.parse(raw);
  return statsFor(auth, q.aql, q.by);
}

async function statsFor(auth: AuthContext, aql: string, by: StatGroup): Promise<SearchStatDto[]> {
  const { filter } = await aqlTaskFilter(auth, aql);
  const rows = await Task.aggregate<{ _id: unknown; count: number }>([
    { $match: filter },
    { $group: { _id: GROUP_PATH[by], count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 50 },
  ]);
  const ids = rows
    .map((r) => r._id)
    .filter((x): x is Types.ObjectId => x instanceof Types.ObjectId);
  const names = new Map<string, string>();
  if (by === 'assignee' && ids.length)
    (
      await User.find({ _id: { $in: ids } })
        .select('name')
        .lean()
    ).forEach((u) => names.set(u._id.toString(), u.name));
  if (by === 'project' && ids.length)
    (
      await Project.find({ _id: { $in: ids } })
        .select('key name')
        .lean()
    ).forEach((p) => names.set(p._id.toString(), `${p.key} · ${p.name}`));
  return rows.map((r) => {
    const key = r._id === null || r._id === undefined ? 'none' : String(r._id);
    let label: string;
    if (by === 'status') label = STATUS_LABELS[key as TaskStatus] ?? key;
    else if (by === 'priority') label = PRIORITY_LABELS[key as Priority] ?? key;
    else if (by === 'type') label = ISSUE_TYPE_LABELS[key as IssueType] ?? key;
    else if (key === 'none') label = by === 'assignee' ? 'Unassigned' : 'None';
    else label = names.get(key) ?? 'Unknown';
    return { key, label, count: r.count };
  });
}

/* ---------- Export ---------- */

const COLUMN_LABELS: Record<ExportColumn, string> = {
  key: 'Key',
  title: 'Title',
  project: 'Project',
  type: 'Type',
  status: 'Status',
  priority: 'Priority',
  assignee: 'Assignee',
  reporter: 'Reporter',
  sprint: 'Sprint',
  storyPoints: 'Story points',
  due: 'Due',
  estimate: 'Estimate (h)',
  logged: 'Logged (h)',
  labels: 'Labels',
  created: 'Created',
  updated: 'Updated',
  resolved: 'Resolved',
};
const DEFAULT_COLUMNS: ExportColumn[] = [
  'key',
  'title',
  'type',
  'status',
  'priority',
  'assignee',
  'due',
  'updated',
];

export async function exportSearch(
  rc: RequestContext,
  raw: unknown,
): Promise<{ body: Buffer | string; contentType: string; fileName: string; count: number }> {
  const auth = requireAuth(rc);
  const q = exportSearchQuerySchema.parse(raw);
  const columns = q.columns.length ? q.columns : DEFAULT_COLUMNS;
  const { filter, sort } = await aqlTaskFilter(auth, q.aql);
  const total = await Task.countDocuments(filter);
  if (total > EXPORT_LIMIT)
    throw new UnprocessableError(
      `This search finds ${total} tasks; exports are limited to ${EXPORT_LIMIT}. Narrow the query.`,
    );
  const tasks = await Task.find(filter)
    .sort(sort ?? { projectId: 1, key: 1 })
    .lean();

  const userIds = tasks.flatMap((t) => [t.assigneeId, t.reporterId]).filter(Boolean);
  const [users, projects, sprints] = await Promise.all([
    User.find({ _id: { $in: userIds } })
      .select('name')
      .lean(),
    Project.find({ _id: { $in: [...new Set(tasks.map((t) => t.projectId.toString()))] } })
      .select('key')
      .lean(),
    Sprint.find({
      _id: { $in: tasks.map((t) => t.sprintId).filter((x): x is Types.ObjectId => Boolean(x)) },
    })
      .select('name')
      .lean(),
  ]);
  const name = (m: { _id: Types.ObjectId }[], f: string, id?: Types.ObjectId | null) =>
    id ? ((m.find((x) => x._id.equals(id)) as Record<string, unknown> | undefined)?.[f] ?? '') : '';
  const cell = (t: ITask, c: ExportColumn): string | number => {
    switch (c) {
      case 'key':
        return t.key;
      case 'title':
        return t.title;
      case 'project':
        return name(projects, 'key', t.projectId) as string;
      case 'type':
        return ISSUE_TYPE_LABELS[t.type];
      case 'status':
        return STATUS_LABELS[t.status];
      case 'priority':
        return PRIORITY_LABELS[t.priority];
      case 'assignee':
        return name(users, 'name', t.assigneeId) as string;
      case 'reporter':
        return name(users, 'name', t.reporterId) as string;
      case 'sprint':
        return name(sprints, 'name', t.sprintId) as string;
      case 'storyPoints':
        return t.storyPoints ?? '';
      case 'due':
        return t.dueDate ?? '';
      case 'estimate':
        return t.estimatedHours ?? '';
      case 'logged':
        return t.actualHours;
      case 'labels':
        return t.tags.join('; ');
      case 'created':
        return toOrgDate(t.createdAt);
      case 'updated':
        return toOrgDate(t.updatedAt);
      case 'resolved':
        return t.completedAt ? toOrgDate(t.completedAt) : '';
    }
  };
  const head = columns.map((c) => COLUMN_LABELS[c]);
  const rows = tasks.map((t) => columns.map((c) => cell(t, c)));
  const stamp = new Date().toISOString().slice(0, 10);

  await recordAudit(rc, {
    action: `export.search_${q.format}`,
    entityType: 'export',
    summary: `Exported ${tasks.length} task(s) from a search as ${q.format.toUpperCase()}: ${q.aql || '(all visible tasks)'}`,
  });

  if (q.format === 'csv') {
    return {
      body: '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n'),
      contentType: 'text/csv; charset=utf-8',
      fileName: `search_${stamp}.csv`,
      count: tasks.length,
    };
  }
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Arihant Workspace';
  const ws = wb.addWorksheet('Search results');
  ws.addRow(head).font = { bold: true };
  // Cells are written as values, never formulas.
  rows.forEach((r) => ws.addRow(r.map((v) => (typeof v === 'string' ? csvSafe(v) : v))));
  ws.columns.forEach((col) => (col.width = 18));
  ws.getColumn(columns.indexOf('title') + 1).width = columns.includes('title') ? 50 : 18;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.addRow([]);
  ws.addRow([`Query: ${q.aql || '(all visible tasks)'}`]);
  return {
    body: Buffer.from(await wb.xlsx.writeBuffer()),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileName: `search_${stamp}.xlsx`,
    count: tasks.length,
  };
}

/** Text that a spreadsheet could read as a formula gets a leading apostrophe. */
const csvSafe = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);

/* ---------- Saved filters ---------- */

async function filterVisibility(auth: AuthContext): Promise<QueryFilter<ISavedFilter>> {
  const ids = await readableProjectIds(auth);
  return {
    $or: [
      { ownerId: auth.userObjectId },
      { sharing: 'org' },
      { sharing: 'project', ...(ids === 'all' ? {} : { projectId: { $in: ids } }) },
    ],
  };
}

const canEditFilter = (auth: AuthContext, f: ISavedFilter) =>
  f.ownerId.equals(auth.userObjectId) || can(auth, 'settings:manage', 'org');

async function presentFilters(auth: AuthContext, rows: ISavedFilter[]): Promise<SavedFilterDto[]> {
  const [owners, projects] = await Promise.all([
    User.find({ _id: { $in: rows.map((r) => r.ownerId) } })
      .select('name')
      .lean(),
    Project.find({ _id: { $in: rows.map((r) => r.projectId).filter(Boolean) } })
      .select('key name')
      .lean(),
  ]);
  return rows.map((r) => {
    const owner = owners.find((o) => o._id.equals(r.ownerId));
    const project = r.projectId ? projects.find((p) => p._id.equals(r.projectId!)) : null;
    return {
      id: r._id.toString(),
      name: r.name,
      description: r.description,
      aql: r.aql,
      sharing: r.sharing,
      project: project
        ? { id: project._id.toString(), key: project.key, name: project.name }
        : null,
      owner: { id: r.ownerId.toString(), name: owner?.name ?? 'Former user' },
      favourite: r.favouriteOf.some((u) => u.equals(auth.userObjectId)),
      canEdit: canEditFilter(auth, r),
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}

export async function listFilters(rc: RequestContext): Promise<SavedFilterDto[]> {
  const auth = requireAuth(rc);
  const rows = await SavedFilter.find(await filterVisibility(auth))
    .sort({ name: 1 })
    .limit(500)
    .lean();
  return presentFilters(auth, rows);
}

async function loadFilter(auth: AuthContext, id: string): Promise<ISavedFilter> {
  const f = await SavedFilter.findOne({
    $and: [{ _id: oid(id) }, await filterVisibility(auth)],
  }).lean();
  if (!f) throw new NotFoundError('Filter');
  return f;
}

export async function getFilter(rc: RequestContext, id: string): Promise<SavedFilterDto> {
  const auth = requireAuth(rc);
  return (await presentFilters(auth, [await loadFilter(auth, id)]))[0]!;
}

async function checkSharing(
  auth: AuthContext,
  sharing: ISavedFilter['sharing'],
  projectId: string | null | undefined,
): Promise<Types.ObjectId | null> {
  if (sharing === 'org' && !can(auth, 'project:read', 'department'))
    throw new ForbiddenError('Only managers can share filters with the whole organisation');
  if (sharing !== 'project') return null;
  if (!projectId) throw new UnprocessableError('Choose the project to share with');
  const ids = await readableProjectIds(auth);
  if (ids !== 'all' && !ids.some((p) => p.equals(projectId))) throw new NotFoundError('Project');
  return oid(projectId);
}

export async function createFilter(
  rc: RequestContext,
  raw: SavedFilterInput,
): Promise<SavedFilterDto> {
  const auth = requireAuth(rc);
  const input = savedFilterSchema.parse(raw);
  await compileAql(auth, input.aql); // validates names (projects, people, sprints)
  if ((await SavedFilter.countDocuments({ ownerId: auth.userObjectId })) >= MAX_FILTERS)
    throw new UnprocessableError(`You can keep up to ${MAX_FILTERS} filters`);
  const projectId = await checkSharing(auth, input.sharing, input.projectId);
  try {
    const f = await SavedFilter.create({
      ownerId: auth.userObjectId,
      name: input.name,
      description: input.description ?? null,
      aql: input.aql,
      sharing: input.sharing,
      projectId,
      favouriteOf: [auth.userObjectId],
    });
    return (await presentFilters(auth, [f.toObject()]))[0]!;
  } catch (e) {
    if ((e as { code?: number }).code === 11000)
      throw new ConflictError('You already have a filter with this name');
    throw e;
  }
}

export async function updateFilter(
  rc: RequestContext,
  id: string,
  raw: unknown,
): Promise<SavedFilterDto> {
  const auth = requireAuth(rc);
  const input = updateSavedFilterSchema.parse(raw);
  const f = await loadFilter(auth, id);
  if (!canEditFilter(auth, f)) throw new ForbiddenError('Only the owner can change this filter');
  if (input.aql) await compileAql(auth, input.aql);
  const sharing = input.sharing ?? f.sharing;
  const projectId = await checkSharing(
    auth,
    sharing,
    input.projectId !== undefined ? input.projectId : f.projectId?.toString(),
  );
  try {
    const next = await SavedFilter.findByIdAndUpdate(
      f._id,
      {
        $set: {
          ...(input.name ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.aql ? { aql: input.aql } : {}),
          sharing,
          projectId,
        },
      },
      { returnDocument: 'after' },
    ).lean();
    return (await presentFilters(auth, [next!]))[0]!;
  } catch (e) {
    if ((e as { code?: number }).code === 11000)
      throw new ConflictError('You already have a filter with this name');
    throw e;
  }
}

export async function deleteFilter(rc: RequestContext, id: string): Promise<void> {
  const auth = requireAuth(rc);
  const f = await loadFilter(auth, id);
  if (!canEditFilter(auth, f)) throw new ForbiddenError('Only the owner can delete this filter');
  await SavedFilter.deleteOne({ _id: f._id });
  await FilterGadget.deleteMany({ filterId: f._id });
}

export async function setFavourite(
  rc: RequestContext,
  id: string,
  favourite: boolean,
): Promise<SavedFilterDto> {
  const auth = requireAuth(rc);
  const f = await loadFilter(auth, id);
  const next = await SavedFilter.findByIdAndUpdate(
    f._id,
    favourite
      ? { $addToSet: { favouriteOf: auth.userObjectId } }
      : { $pull: { favouriteOf: auth.userObjectId } },
    { returnDocument: 'after', timestamps: false },
  ).lean();
  return (await presentFilters(auth, [next!]))[0]!;
}

/* ---------- Gadgets ---------- */

export async function listGadgets(rc: RequestContext): Promise<GadgetDto[]> {
  const auth = requireAuth(rc);
  const rows = await FilterGadget.find({ userId: auth.userObjectId }).sort({ position: 1 }).lean();
  const visible = await SavedFilter.find({
    $and: [{ _id: { $in: rows.map((r) => r.filterId) } }, await filterVisibility(auth)],
  })
    .select('name aql')
    .lean();
  return rows.map((r) => {
    const f = visible.find((v) => v._id.equals(r.filterId));
    return {
      id: r._id.toString(),
      chart: r.chart,
      by: r.by,
      // A filter that was deleted or is no longer shared shows as unavailable.
      filter: f ? { id: f._id.toString(), name: f.name, aql: f.aql } : null,
    };
  });
}

export async function addGadget(rc: RequestContext, raw: GadgetInput): Promise<GadgetDto[]> {
  const auth = requireAuth(rc);
  const input = gadgetSchema.parse(raw);
  await loadFilter(auth, input.filterId);
  const count = await FilterGadget.countDocuments({ userId: auth.userObjectId });
  if (count >= MAX_GADGETS)
    throw new UnprocessableError(`A dashboard holds up to ${MAX_GADGETS} gadgets`);
  await FilterGadget.create({
    userId: auth.userObjectId,
    filterId: oid(input.filterId),
    chart: input.chart,
    by: input.by,
    position: count,
  });
  return listGadgets(rc);
}

export async function removeGadget(rc: RequestContext, id: string): Promise<void> {
  const auth = requireAuth(rc);
  const res = await FilterGadget.deleteOne({ _id: oid(id), userId: auth.userObjectId });
  if (!res.deletedCount) throw new NotFoundError('Gadget');
}

/* ---------- Global search (command palette) ---------- */

export async function globalSearch(rc: RequestContext, term: string): Promise<GlobalSearchDto> {
  const auth = requireAuth(rc);
  const rx = new RegExp(escapeRegex(term.trim()), 'i');
  const projectIds = await readableProjectIds(auth);
  const inProjects = projectIds === 'all' ? {} : { _id: { $in: projectIds } };

  const tasksP = can(auth, 'task:read')
    ? (async () => {
        const archived = await Project.find({ archived: true }).select('_id').lean();
        return Task.find({
          $and: [
            await taskReadFilter(auth),
            { $or: [{ key: rx }, { title: rx }, { previousKeys: rx }] },
            archived.length ? { projectId: { $nin: archived.map((p) => p._id) } } : {},
          ],
        })
          .sort({ updatedAt: -1 })
          .limit(8)
          .select('key title status projectId')
          .lean();
      })()
    : Promise.resolve([]);
  const projectsP = can(auth, 'project:read')
    ? Project.find({ ...inProjects, $or: [{ key: rx }, { name: rx }] })
        .sort({ archived: 1, updatedAt: -1 })
        .limit(5)
        .select('key name')
        .lean()
    : Promise.resolve([]);
  const peopleP =
    can(auth, 'user:read') && !isExternal(auth)
      ? (async () =>
          User.find({
            $and: [
              await peopleFilter(auth, auth.permissions['user:read']),
              { status: 'active' },
              { $or: [{ name: rx }, { email: rx }, { employeeId: rx }] },
            ],
          })
            .limit(5)
            .select('name designation')
            .lean())()
      : Promise.resolve([]);
  const docsP = can(auth, 'document:read')
    ? DocumentModel.find({
        deletedAt: null,
        ...(projectIds === 'all' ? {} : { projectId: { $in: projectIds } }),
        ...(isExternal(auth)
          ? { sharedWithStakeholders: true, publishedVersion: { $ne: null } }
          : {}),
        $or: [{ title: rx }, { tags: rx }],
      })
        .sort({ updatedAt: -1 })
        .limit(5)
        .select('title projectId')
        .lean()
    : Promise.resolve([]);

  const [tasks, projects, people, documents] = await Promise.all([
    tasksP,
    projectsP,
    peopleP,
    docsP,
  ]);
  const keys = new Map(
    (
      await Project.find({ _id: { $in: tasks.map((t) => t.projectId) } })
        .select('key')
        .lean()
    ).map((p) => [p._id.toString(), p.key]),
  );
  return {
    tasks: tasks.map((t) => ({
      id: t._id.toString(),
      key: t.key,
      title: t.title,
      status: t.status,
      projectKey: keys.get(t.projectId.toString()) ?? '',
    })),
    projects: projects.map((p) => ({ id: p._id.toString(), key: p.key, name: p.name })),
    people: people.map((u) => ({
      id: u._id.toString(),
      name: u.name,
      designation: u.designation ?? null,
    })),
    documents: documents.map((d) => ({
      id: d._id.toString(),
      title: d.title,
      projectId: d.projectId.toString(),
    })),
  };
}
