import { z } from 'zod';
import { objectIdSchema, paginationQuerySchema } from './api';
import { PRIORITIES, TASK_STATUSES } from './enums';
import { BUG_SEVERITIES, ISSUE_TYPES } from './agile';

/*
 * Arihant query language (AQL): a small, safe filter language for tasks.
 *
 *   project = TRD AND status IN ("To Do", in_progress) AND assignee = currentUser()
 *   priority >= high AND due < today() AND text ~ "login" ORDER BY due ASC, priority DESC
 *
 * The parser is shared so the browser can show errors while typing; the server parses
 * again, resolves names (project keys, people, sprints, releases) and compiles the tree
 * to a database filter that is always combined with the caller's read permissions.
 */

export const AQL_MAX_LENGTH = 2000;

export type AqlFieldKind =
  | 'project'
  | 'key'
  | 'status'
  | 'priority'
  | 'type'
  | 'severity'
  | 'user'
  | 'text'
  | 'tag'
  | 'component'
  | 'sprint'
  | 'epic'
  | 'release'
  | 'date'
  | 'datetime'
  | 'number';

export interface AqlFieldDef {
  kind: AqlFieldKind;
  label: string;
  /** Database path the field compiles to. */
  path: string;
  help: string;
  sortable?: boolean;
}

export const AQL_FIELDS: Record<string, AqlFieldDef> = {
  project: { kind: 'project', label: 'Project', path: 'projectId', help: 'Project key, e.g. TRD' },
  key: { kind: 'key', label: 'Key', path: 'key', help: 'Task key, e.g. TRD-42', sortable: true },
  status: {
    kind: 'status',
    label: 'Status',
    path: 'status',
    help: '"In Review" or in_review',
    sortable: true,
  },
  priority: {
    kind: 'priority',
    label: 'Priority',
    path: 'priority',
    help: 'low < medium < high < critical',
    sortable: true,
  },
  type: { kind: 'type', label: 'Type', path: 'type', help: 'task, story, bug or epic' },
  severity: {
    kind: 'severity',
    label: 'Bug severity',
    path: 'bug.severity',
    help: 'blocker, critical, major, minor, trivial',
  },
  assignee: {
    kind: 'user',
    label: 'Assignee',
    path: 'assigneeId',
    help: 'E-mail, currentUser() or EMPTY',
  },
  reporter: {
    kind: 'user',
    label: 'Reporter',
    path: 'reporterId',
    help: 'E-mail or currentUser()',
  },
  watcher: { kind: 'user', label: 'Watcher', path: 'watcherIds', help: 'E-mail or currentUser()' },
  text: {
    kind: 'text',
    label: 'Text',
    path: '*',
    help: 'text ~ "words" searches title, key and description',
  },
  title: { kind: 'text', label: 'Title', path: 'title', help: 'title ~ "words"', sortable: true },
  description: {
    kind: 'text',
    label: 'Description',
    path: 'description',
    help: 'description ~ "words"',
  },
  label: { kind: 'tag', label: 'Label', path: 'tags', help: 'A tag on the task' },
  component: {
    kind: 'component',
    label: 'Component',
    path: 'components',
    help: 'A project component',
  },
  sprint: {
    kind: 'sprint',
    label: 'Sprint',
    path: 'sprintId',
    help: 'Sprint name, openSprints() or EMPTY',
  },
  epic: { kind: 'epic', label: 'Epic', path: 'epicId', help: 'Epic key, e.g. TRD-7' },
  parent: { kind: 'epic', label: 'Parent', path: 'parentId', help: 'Parent task key' },
  fixversion: {
    kind: 'release',
    label: 'Fix release',
    path: 'fixReleaseId',
    help: 'Release version, e.g. 2.1.0',
  },
  due: {
    kind: 'date',
    label: 'Due',
    path: 'dueDate',
    help: 'YYYY-MM-DD, today(), -7d, +2w',
    sortable: true,
  },
  start: {
    kind: 'date',
    label: 'Start',
    path: 'startDate',
    help: 'YYYY-MM-DD, today(), -7d',
    sortable: true,
  },
  created: {
    kind: 'datetime',
    label: 'Created',
    path: 'createdAt',
    help: 'YYYY-MM-DD, -7d, startOfWeek()',
    sortable: true,
  },
  updated: {
    kind: 'datetime',
    label: 'Updated',
    path: 'updatedAt',
    help: 'YYYY-MM-DD, -7d',
    sortable: true,
  },
  resolved: {
    kind: 'datetime',
    label: 'Resolved',
    path: 'completedAt',
    help: 'When the task was done',
    sortable: true,
  },
  storypoints: {
    kind: 'number',
    label: 'Story points',
    path: 'storyPoints',
    help: 'A number',
    sortable: true,
  },
  estimate: {
    kind: 'number',
    label: 'Estimate (h)',
    path: 'estimatedHours',
    help: 'Hours',
    sortable: true,
  },
  logged: {
    kind: 'number',
    label: 'Logged (h)',
    path: 'actualHours',
    help: 'Hours',
    sortable: true,
  },
};

/** Alternative spellings accepted for field names (all compared in lower case). */
export const AQL_ALIASES: Record<string, string> = {
  issue: 'key',
  issuekey: 'key',
  id: 'key',
  summary: 'title',
  labels: 'label',
  tag: 'label',
  tags: 'label',
  issuetype: 'type',
  duedate: 'due',
  startdate: 'start',
  createddate: 'created',
  updateddate: 'updated',
  resolutiondate: 'resolved',
  points: 'storypoints',
  'story points': 'storypoints',
  release: 'fixversion',
  components: 'component',
};

export const AQL_FUNCTIONS = [
  'currentUser',
  'today',
  'now',
  'startOfWeek',
  'endOfWeek',
  'startOfMonth',
  'endOfMonth',
  'openSprints',
] as const;
export type AqlFunction = (typeof AQL_FUNCTIONS)[number];

export const AQL_OPERATORS = [
  '=',
  '!=',
  '>',
  '>=',
  '<',
  '<=',
  '~',
  '!~',
  'IN',
  'NOT IN',
  'IS',
  'IS NOT',
] as const;
export type AqlOperator = (typeof AQL_OPERATORS)[number];

/** Operators each kind of field accepts. */
const OPS_BY_KIND: Record<AqlFieldKind, readonly AqlOperator[]> = {
  project: ['=', '!=', 'IN', 'NOT IN'],
  key: ['=', '!=', 'IN', 'NOT IN'],
  status: ['=', '!=', 'IN', 'NOT IN'],
  priority: ['=', '!=', 'IN', 'NOT IN', '>', '>=', '<', '<='],
  type: ['=', '!=', 'IN', 'NOT IN'],
  severity: ['=', '!=', 'IN', 'NOT IN', 'IS', 'IS NOT'],
  user: ['=', '!=', 'IN', 'NOT IN', 'IS', 'IS NOT'],
  text: ['~', '!~'],
  tag: ['=', '!=', 'IN', 'NOT IN', 'IS', 'IS NOT'],
  component: ['=', '!=', 'IN', 'NOT IN', 'IS', 'IS NOT'],
  sprint: ['=', '!=', 'IN', 'NOT IN', 'IS', 'IS NOT'],
  epic: ['=', '!=', 'IN', 'NOT IN', 'IS', 'IS NOT'],
  release: ['=', '!=', 'IN', 'NOT IN', 'IS', 'IS NOT'],
  date: ['=', '!=', '>', '>=', '<', '<=', 'IS', 'IS NOT'],
  datetime: ['>', '>=', '<', '<=', 'IS', 'IS NOT'],
  number: ['=', '!=', '>', '>=', '<', '<=', 'IS', 'IS NOT'],
};
export const operatorsFor = (kind: AqlFieldKind) => OPS_BY_KIND[kind];

/* ---------- Tree ---------- */

export type AqlValue =
  | { kind: 'word'; value: string }
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'relative'; days: number }
  | { kind: 'function'; name: AqlFunction }
  | { kind: 'empty' };

export interface AqlClause {
  type: 'clause';
  field: string;
  op: AqlOperator;
  values: AqlValue[];
}
export type AqlNode =
  AqlClause | { type: 'and' | 'or'; children: AqlNode[] } | { type: 'not'; child: AqlNode };

export interface AqlOrder {
  field: string;
  dir: 'asc' | 'desc';
}
export interface AqlQuery {
  where: AqlNode | null;
  orderBy: AqlOrder[];
}

export class AqlError extends Error {
  constructor(
    message: string,
    /** Character offset where the problem was found. */
    readonly position: number,
  ) {
    super(message);
    this.name = 'AqlError';
  }
}

/* ---------- Tokenizer ---------- */

type Tok =
  | { t: 'word'; v: string; pos: number }
  | { t: 'string'; v: string; pos: number }
  | { t: 'op'; v: string; pos: number }
  | { t: '(' | ')' | ','; pos: number }
  | { t: 'end'; pos: number };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (c === '(' || c === ')' || c === ',') {
      out.push({ t: c, pos: i });
      i += 1;
      continue;
    }
    if (c === '"' || c === "'") {
      const start = i;
      let v = '';
      i += 1;
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\' && i + 1 < src.length) i += 1;
        v += src[i];
        i += 1;
      }
      if (i >= src.length) throw new AqlError('Closing quote missing', start);
      i += 1;
      out.push({ t: 'string', v, pos: start });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['!=', '>=', '<=', '!~'].includes(two)) {
      out.push({ t: 'op', v: two, pos: i });
      i += 2;
      continue;
    }
    if ('=<>~'.includes(c)) {
      out.push({ t: 'op', v: c, pos: i });
      i += 1;
      continue;
    }
    const m = /^[A-Za-z0-9_.@+\-:/]+/.exec(src.slice(i));
    if (!m) throw new AqlError(`Unexpected character "${c}"`, i);
    out.push({ t: 'word', v: m[0], pos: i });
    i += m[0].length;
  }
  out.push({ t: 'end', pos: src.length });
  return out;
}

/* ---------- Parser ---------- */

export function resolveField(name: string): string | null {
  const n = name.toLowerCase();
  const f = AQL_ALIASES[n] ?? n;
  return AQL_FIELDS[f] ? f : null;
}

const RELATIVE = /^([+-]?\d{1,4})([dwm])$/i;

class Parser {
  private i = 0;
  constructor(private readonly toks: Tok[]) {}

  private peek(): Tok {
    return this.toks[this.i]!;
  }
  private next(): Tok {
    return this.toks[this.i++]!;
  }
  private isWord(w: string, offset = 0): boolean {
    const t = this.toks[this.i + offset];
    return t?.t === 'word' && t.v.toUpperCase() === w;
  }

  parse(): AqlQuery {
    let where: AqlNode | null = null;
    if (this.peek().t !== 'end' && !(this.isWord('ORDER') && this.isWord('BY', 1))) {
      where = this.or();
    }
    const orderBy: AqlOrder[] = [];
    if (this.isWord('ORDER')) {
      this.next();
      if (!this.isWord('BY')) throw new AqlError('Expected BY after ORDER', this.peek().pos);
      this.next();
      do {
        const t = this.next();
        if (t.t !== 'word' && t.t !== 'string')
          throw new AqlError('Expected a field to sort by', t.pos);
        const field = resolveField(t.v);
        if (!field || !AQL_FIELDS[field]!.sortable)
          throw new AqlError(`Cannot sort by "${t.v}"`, t.pos);
        let dir: 'asc' | 'desc' = 'asc';
        if (this.isWord('ASC') || this.isWord('DESC')) {
          dir = (this.next() as { v: string }).v.toLowerCase() as 'asc' | 'desc';
        }
        orderBy.push({ field, dir });
      } while (this.peek().t === ',' && this.next());
      if (orderBy.length > 3) throw new AqlError('Sort by at most 3 fields', this.peek().pos);
    }
    const end = this.peek();
    if (end.t !== 'end') {
      throw new AqlError(
        `Unexpected "${'v' in end ? end.v : end.t}": join conditions with AND or OR`,
        end.pos,
      );
    }
    return { where, orderBy };
  }

  private or(): AqlNode {
    const children = [this.and()];
    while (this.isWord('OR')) {
      this.next();
      children.push(this.and());
    }
    return children.length === 1 ? children[0]! : { type: 'or', children };
  }

  private and(): AqlNode {
    const children = [this.not()];
    while (this.isWord('AND')) {
      this.next();
      children.push(this.not());
    }
    return children.length === 1 ? children[0]! : { type: 'and', children };
  }

  private not(): AqlNode {
    if (this.isWord('NOT')) {
      this.next();
      return { type: 'not', child: this.not() };
    }
    if (this.peek().t === '(') {
      this.next();
      const inner = this.or();
      const close = this.next();
      if (close.t !== ')') throw new AqlError('Closing bracket missing', close.pos);
      return inner;
    }
    return this.clause();
  }

  private clause(): AqlClause {
    const ft = this.next();
    if (ft.t !== 'word' && ft.t !== 'string')
      throw new AqlError('Expected a field name, e.g. status', ft.pos);
    const field = resolveField(ft.v);
    if (!field) throw new AqlError(`Unknown field "${ft.v}"`, ft.pos);
    const def = AQL_FIELDS[field]!;

    const opTok = this.peek();
    let op: AqlOperator;
    if (opTok.t === 'op') {
      this.next();
      op = opTok.v as AqlOperator;
    } else if (this.isWord('IN')) {
      this.next();
      op = 'IN';
    } else if (this.isWord('NOT') && this.isWord('IN', 1)) {
      this.i += 2;
      op = 'NOT IN';
    } else if (this.isWord('IS')) {
      this.next();
      op = 'IS';
      if (this.isWord('NOT')) {
        this.next();
        op = 'IS NOT';
      }
    } else {
      throw new AqlError(`Expected an operator after ${def.label}, e.g. =`, opTok.pos);
    }
    if (!OPS_BY_KIND[def.kind].includes(op)) {
      throw new AqlError(
        `${def.label} does not support "${op}" (use ${OPS_BY_KIND[def.kind].join(', ')})`,
        opTok.pos,
      );
    }

    let values: AqlValue[];
    if (op === 'IS' || op === 'IS NOT') {
      const t = this.next();
      if (!(t.t === 'word' && ['EMPTY', 'NULL'].includes(t.v.toUpperCase())))
        throw new AqlError('Expected EMPTY after IS', t.pos);
      values = [{ kind: 'empty' }];
    } else if (op === 'IN' || op === 'NOT IN') {
      const open = this.next();
      if (open.t !== '(') throw new AqlError('Expected a list in brackets, e.g. (a, b)', open.pos);
      values = [this.value()];
      while (this.peek().t === ',') {
        this.next();
        values.push(this.value());
      }
      const close = this.next();
      if (close.t !== ')') throw new AqlError('Closing bracket missing', close.pos);
      if (values.length > 100) throw new AqlError('Lists hold at most 100 values', open.pos);
    } else {
      values = [this.value()];
    }
    return { type: 'clause', field, op, values };
  }

  private value(): AqlValue {
    const t = this.next();
    if (t.t === 'string') return { kind: 'string', value: t.v };
    if (t.t !== 'word') throw new AqlError('Expected a value', t.pos);
    if (this.peek().t === '(') {
      const name = AQL_FUNCTIONS.find((f) => f.toLowerCase() === t.v.toLowerCase());
      if (!name) throw new AqlError(`Unknown function "${t.v}()"`, t.pos);
      this.next();
      const close = this.next();
      if (close.t !== ')') throw new AqlError(`${name}() takes no arguments`, close.pos);
      return { kind: 'function', name };
    }
    if (['EMPTY', 'NULL'].includes(t.v.toUpperCase())) return { kind: 'empty' };
    const rel = RELATIVE.exec(t.v);
    if (rel && /^[+-]/.test(t.v)) {
      const n = Number(rel[1]);
      const unit = rel[2]!.toLowerCase();
      return { kind: 'relative', days: unit === 'd' ? n : unit === 'w' ? n * 7 : n * 30 };
    }
    if (/^-?\d+(\.\d+)?$/.test(t.v)) return { kind: 'number', value: Number(t.v) };
    return { kind: 'word', value: t.v };
  }
}

/** Parses a query; throws AqlError with the character position of the first problem. */
export function parseAql(src: string): AqlQuery {
  if (src.length > AQL_MAX_LENGTH)
    throw new AqlError(`Queries are limited to ${AQL_MAX_LENGTH} characters`, AQL_MAX_LENGTH);
  let clauses = 0;
  const q = new Parser(tokenize(src)).parse();
  const count = (n: AqlNode | null): void => {
    if (!n) return;
    if (n.type === 'clause') clauses += 1;
    else if (n.type === 'not') count(n.child);
    else n.children.forEach(count);
  };
  count(q.where);
  if (clauses > 50) throw new AqlError('Queries are limited to 50 conditions', 0);
  return q;
}

/** Parse without throwing (for live validation in the editor). */
export function checkAql(
  src: string,
): { ok: true } | { ok: false; message: string; position: number } {
  try {
    parseAql(src);
    return { ok: true };
  } catch (e) {
    if (e instanceof AqlError) return { ok: false, message: e.message, position: e.position };
    throw e;
  }
}

/* ---------- Value helpers shared by server and client ---------- */

const norm = (s: string) => s.toLowerCase().replace(/[\s-]+/g, '_');

/** Accepts the internal value or the display label ("In Review" / in_review). */
export function matchEnum<T extends string>(raw: string, values: readonly T[]): T | null {
  const n = norm(raw);
  const labelled: Record<string, string> = { to_do: 'todo' };
  const v = (labelled[n] ?? n) as T;
  return values.includes(v) ? v : null;
}
export const AQL_ENUMS = {
  status: TASK_STATUSES,
  priority: PRIORITIES,
  type: ISSUE_TYPES,
  severity: BUG_SEVERITIES,
} as const;
/** Lowest to highest. */
export const AQL_PRIORITY_RANK = ['low', 'medium', 'high', 'critical'] as const;

/* ---------- API schemas ---------- */

const aqlString = z.string().trim().max(AQL_MAX_LENGTH);

export const searchTasksQuerySchema = paginationQuerySchema
  .pick({ page: true, limit: true })
  .extend({
    aql: aqlString.default(''),
    /** Record the query in the caller's search history. */
    record: z.enum(['true', 'false']).optional(),
  });
export type SearchTasksQuery = z.input<typeof searchTasksQuerySchema>;

export const EXPORT_COLUMNS = [
  'key',
  'title',
  'project',
  'type',
  'status',
  'priority',
  'assignee',
  'reporter',
  'sprint',
  'storyPoints',
  'due',
  'estimate',
  'logged',
  'labels',
  'created',
  'updated',
  'resolved',
] as const;
export type ExportColumn = (typeof EXPORT_COLUMNS)[number];

export const exportSearchQuerySchema = z.strictObject({
  aql: aqlString.default(''),
  format: z.enum(['csv', 'xlsx']).default('csv'),
  columns: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (typeof v === 'string' ? v.split(',') : (v ?? [])).filter(Boolean))
    .pipe(z.array(z.enum(EXPORT_COLUMNS)).max(EXPORT_COLUMNS.length)),
});

export const STAT_GROUPS = ['status', 'priority', 'type', 'assignee', 'project'] as const;
export type StatGroup = (typeof STAT_GROUPS)[number];
export const searchStatsQuerySchema = z.strictObject({
  aql: aqlString.default(''),
  by: z.enum(STAT_GROUPS).default('status'),
});

export const FILTER_SHARING = ['private', 'project', 'org'] as const;
export type FilterSharing = (typeof FILTER_SHARING)[number];

export const savedFilterSchema = z
  .strictObject({
    name: z.string().trim().min(1, 'Name the filter').max(80),
    description: z.string().trim().max(500).nullable().optional(),
    aql: aqlString.min(1, 'Write a query'),
    sharing: z.enum(FILTER_SHARING).default('private'),
    projectId: objectIdSchema.nullable().optional(),
  })
  .refine((v) => v.sharing !== 'project' || Boolean(v.projectId), {
    message: 'Choose the project to share with',
    path: ['projectId'],
  });
export type SavedFilterInput = z.input<typeof savedFilterSchema>;
export const updateSavedFilterSchema = z.strictObject({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  aql: aqlString.min(1).optional(),
  sharing: z.enum(FILTER_SHARING).optional(),
  projectId: objectIdSchema.nullable().optional(),
});

export const GADGET_CHARTS = ['count', 'bar', 'list'] as const;
export const gadgetSchema = z.strictObject({
  filterId: objectIdSchema,
  chart: z.enum(GADGET_CHARTS).default('bar'),
  by: z.enum(STAT_GROUPS).default('status'),
});
export type GadgetInput = z.input<typeof gadgetSchema>;

export const globalSearchQuerySchema = z.strictObject({
  q: z.string().trim().min(1).max(100),
});

/* ---------- DTOs ---------- */

export interface SavedFilterDto {
  id: string;
  name: string;
  description: string | null;
  aql: string;
  sharing: FilterSharing;
  project: { id: string; key: string; name: string } | null;
  owner: { id: string; name: string };
  favourite: boolean;
  canEdit: boolean;
  updatedAt: string;
}

export interface SearchHistoryDto {
  id: string;
  aql: string;
  resultCount: number;
  at: string;
}

export interface SearchStatDto {
  key: string;
  label: string;
  count: number;
}

export interface GadgetDto {
  id: string;
  chart: (typeof GADGET_CHARTS)[number];
  by: StatGroup;
  filter: { id: string; name: string; aql: string } | null;
}

export interface GlobalSearchDto {
  tasks: { id: string; key: string; title: string; status: string; projectKey: string }[];
  projects: { id: string; key: string; name: string }[];
  people: { id: string; name: string; designation: string | null }[];
  documents: { id: string; title: string; projectId: string }[];
}
