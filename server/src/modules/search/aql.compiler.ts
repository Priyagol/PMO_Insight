import type { QueryFilter, Types } from 'mongoose';
import {
  AQL_ENUMS,
  AQL_FIELDS,
  AQL_PRIORITY_RANK,
  AqlError,
  matchEnum,
  parseAql,
  type AqlClause,
  type AqlNode,
  type AqlQuery,
  type AqlValue,
} from '@arihant/shared';
import { UnprocessableError } from '../../core/errors';
import { escapeRegex } from '../../core/pagination';
import type { AuthContext } from '../../core/rbac/context';
import { readableProjectIds } from '../../core/rbac/work-access';
import { addDaysIso, orgToday, startOfOrgDay, weekStartIso } from '../../core/time';
import { Sprint } from '../agile/sprint.model';
import { Release } from '../delivery/delivery.models';
import { Project } from '../projects/project.model';
import { Task, type ITask } from '../tasks/task.model';
import { User } from '../users/user.model';

type F = QueryFilter<ITask>;
const MS_DAY = 86_400_000;

export interface CompiledAql {
  filter: F;
  sort: Record<string, 1 | -1> | null;
  /** True when the query names a project (archived projects are then included). */
  namesProject: boolean;
}

const fail = (message: string): never => {
  throw new UnprocessableError(message);
};

const text = (v: AqlValue): string => {
  if (v.kind === 'word' || v.kind === 'string') return v.value;
  if (v.kind === 'number') return String(v.value);
  return fail('Expected a text value');
};

/** Parses and compiles; syntax errors become 422 responses with the position. */
export function parseOrFail(src: string): AqlQuery {
  try {
    return parseAql(src);
  } catch (e) {
    if (e instanceof AqlError) throw new UnprocessableError(e.message, { position: e.position });
    throw e;
  }
}

class Compiler {
  namesProject = false;
  private readable: Types.ObjectId[] | 'all' | null = null;

  constructor(private readonly auth: AuthContext) {}

  private async readableIds() {
    this.readable ??= await readableProjectIds(this.auth);
    return this.readable;
  }

  async node(n: AqlNode): Promise<F> {
    if (n.type === 'and') return { $and: await Promise.all(n.children.map((c) => this.node(c))) };
    if (n.type === 'or') return { $or: await Promise.all(n.children.map((c) => this.node(c))) };
    if (n.type === 'not') return { $nor: [await this.node(n.child)] };
    return this.clause(n as AqlClause);
  }

  /** Builds the condition for one field from resolved database values. */
  private apply(path: string, op: AqlClause['op'], vals: unknown[], arrayField = false): F {
    const empty = arrayField ? { $in: [null, []] } : null;
    switch (op) {
      case 'IS':
        return { [path]: empty } as F;
      case 'IS NOT':
        return (arrayField ? { [path]: { $nin: [null, []] } } : { [path]: { $ne: null } }) as F;
      case '=':
        return { [path]: vals[0] ?? null } as F;
      case '!=':
        return { [path]: { $ne: vals[0] ?? null } } as F;
      case 'IN':
        return { [path]: { $in: vals } } as F;
      case 'NOT IN':
        return { [path]: { $nin: vals } } as F;
      case '>':
        return { [path]: { $gt: vals[0], $ne: null } } as F;
      case '>=':
        return { [path]: { $gte: vals[0], $ne: null } } as F;
      case '<':
        return { [path]: { $lt: vals[0], $ne: null } } as F;
      case '<=':
        return { [path]: { $lte: vals[0], $ne: null } } as F;
      default:
        return fail(`Operator ${op} is not supported here`);
    }
  }

  private async clause(c: AqlClause): Promise<F> {
    const def = AQL_FIELDS[c.field]!;
    const isEmptyOp = c.op === 'IS' || c.op === 'IS NOT';
    // "= EMPTY" behaves like "IS EMPTY".
    if (!isEmptyOp && c.values.length === 1 && c.values[0]!.kind === 'empty') {
      if (c.op === '=' || c.op === '!=')
        return this.clause({ ...c, op: c.op === '=' ? 'IS' : 'IS NOT' });
    }
    switch (def.kind) {
      case 'project': {
        this.namesProject = true;
        const keys = c.values.map((v) => text(v).toUpperCase());
        const ids = await this.readableIds();
        const found = await Project.find({
          key: { $in: keys },
          ...(ids === 'all' ? {} : { _id: { $in: ids } }),
        })
          .select('key')
          .lean();
        const missing = keys.filter((k) => !found.some((p) => p.key === k));
        if (missing.length) fail(`No project with key ${missing.join(', ')} that you can see`);
        return this.apply(
          def.path,
          c.op,
          keys.map((k) => found.find((p) => p.key === k)!._id),
        );
      }
      case 'key': {
        const keys = c.values.map((v) => text(v).toUpperCase());
        const cond = this.apply('key', c.op, keys);
        const prev = this.apply('previousKeys', c.op === '=' ? 'IN' : c.op, keys);
        // A key also matches a task's earlier keys (after a move between projects).
        return c.op === '=' || c.op === 'IN' ? { $or: [cond, prev] } : { $and: [cond, prev] };
      }
      case 'status':
      case 'type':
      case 'severity':
      case 'priority': {
        if (isEmptyOp) return this.apply(def.path, c.op, []);
        const allowed = AQL_ENUMS[def.kind] as readonly string[];
        const vals = c.values.map((v) => {
          const m = matchEnum(text(v), allowed);
          return (
            m ??
            fail(`"${text(v)}" is not a ${def.label.toLowerCase()} (use ${allowed.join(', ')})`)
          );
        });
        if (def.kind === 'priority' && ['>', '>=', '<', '<='].includes(c.op)) {
          const rank = AQL_PRIORITY_RANK.indexOf(vals[0] as (typeof AQL_PRIORITY_RANK)[number]);
          const ok = AQL_PRIORITY_RANK.filter((_, i) =>
            c.op === '>'
              ? i > rank
              : c.op === '>='
                ? i >= rank
                : c.op === '<'
                  ? i < rank
                  : i <= rank,
          );
          return { priority: { $in: [...ok] } };
        }
        return this.apply(def.path, c.op, vals);
      }
      case 'user': {
        const arrayField = def.path === 'watcherIds';
        if (isEmptyOp) return this.apply(def.path, c.op, [], arrayField);
        const vals = await Promise.all(c.values.map((v) => this.user(v)));
        return this.apply(def.path, c.op, vals, arrayField);
      }
      case 'text': {
        const rx = new RegExp(escapeRegex(text(c.values[0]!)), 'i');
        const paths = def.path === '*' ? ['title', 'key', 'description'] : [def.path];
        const any: F = { $or: paths.map((p) => ({ [p]: rx }) as F) };
        return c.op === '~' ? any : { $nor: [any] };
      }
      case 'tag':
      case 'component': {
        if (isEmptyOp) return this.apply(def.path, c.op, [], true);
        const vals = c.values.map((v) => text(v));
        if (def.kind === 'tag') {
          // Tags are matched without regard to case.
          const rxs = vals.map((v) => new RegExp(`^${escapeRegex(v)}$`, 'i'));
          if (c.op === '!=') return { [def.path]: { $not: rxs[0] } } as F;
          return this.apply(def.path, c.op, rxs, true);
        }
        return this.apply(def.path, c.op, vals, true);
      }
      case 'sprint': {
        if (isEmptyOp) return this.apply(def.path, c.op, []);
        const ids: Types.ObjectId[] = [];
        for (const v of c.values) {
          if (v.kind === 'function' && v.name === 'openSprints') {
            const active = await Sprint.find({ status: 'active', deletedAt: null })
              .select('_id')
              .lean();
            ids.push(...active.map((s) => s._id));
            continue;
          }
          const name = text(v);
          const found = await Sprint.find({
            name: new RegExp(`^${escapeRegex(name)}$`, 'i'),
            deletedAt: null,
          })
            .select('_id')
            .lean();
          if (!found.length) fail(`No sprint named "${name}"`);
          ids.push(...found.map((s) => s._id));
        }
        // Several sprints may share a name across projects: "=" means any of them.
        const op = c.op === '=' ? 'IN' : c.op === '!=' ? 'NOT IN' : c.op;
        return this.apply(def.path, op, ids);
      }
      case 'epic': {
        if (isEmptyOp) return this.apply(def.path, c.op, []);
        const keys = c.values.map((v) => text(v).toUpperCase());
        const ids = await this.readableIds();
        const found = await Task.find({
          key: { $in: keys },
          deletedAt: null,
          ...(ids === 'all' ? {} : { projectId: { $in: ids } }),
        })
          .select('key')
          .lean();
        const missing = keys.filter((k) => !found.some((t) => t.key === k));
        if (missing.length) fail(`No task with key ${missing.join(', ')}`);
        return this.apply(
          def.path,
          c.op,
          keys.map((k) => found.find((t) => t.key === k)!._id),
        );
      }
      case 'release': {
        if (isEmptyOp) return this.apply(def.path, c.op, []);
        const ids: Types.ObjectId[] = [];
        for (const v of c.values) {
          const found = await Release.find({ version: text(v) })
            .select('_id')
            .lean();
          if (!found.length) fail(`No release with version "${text(v)}"`);
          ids.push(...found.map((r) => r._id));
        }
        const op = c.op === '=' ? 'IN' : c.op === '!=' ? 'NOT IN' : c.op;
        return this.apply(def.path, op, ids);
      }
      case 'number': {
        if (isEmptyOp) return this.apply(def.path, c.op, []);
        const vals = c.values.map((v) =>
          v.kind === 'number' ? v.value : fail(`${def.label} needs a number`),
        );
        return this.apply(def.path, c.op, vals);
      }
      case 'date': {
        if (isEmptyOp) return this.apply(def.path, c.op, []);
        return this.apply(def.path, c.op, [this.day(c.values[0]!)]);
      }
      case 'datetime': {
        if (isEmptyOp) return this.apply(def.path, c.op, []);
        const v = c.values[0]!;
        if (v.kind === 'function' && v.name === 'now')
          return this.apply(def.path, c.op, [new Date()]);
        if (v.kind === 'relative')
          return this.apply(def.path, c.op, [new Date(Date.now() + v.days * MS_DAY)]);
        // A calendar day covers the whole day in the organisation's time zone.
        const day = this.day(v);
        const start = startOfOrgDay(day);
        const next = startOfOrgDay(addDaysIso(day, 1));
        if (c.op === '>') return this.apply(def.path, '>=', [next]);
        if (c.op === '<=') return this.apply(def.path, '<', [next]);
        return this.apply(def.path, c.op, [start]);
      }
      default:
        return fail(`${def.label} cannot be searched yet`);
    }
  }

  private async user(v: AqlValue): Promise<Types.ObjectId> {
    if (v.kind === 'function' && v.name === 'currentUser') return this.auth.userObjectId;
    const s = text(v).trim();
    if (s.toLowerCase() === 'me') return this.auth.userObjectId;
    const users = await User.find(
      s.includes('@')
        ? { email: s.toLowerCase() }
        : { name: new RegExp(`^${escapeRegex(s)}$`, 'i') },
    )
      .select('_id')
      .limit(2)
      .lean();
    if (!users.length) return fail(`No person "${s}" (use an e-mail address or currentUser())`);
    if (users.length > 1)
      return fail(`More than one person is called "${s}": use the e-mail address`);
    return users[0]!._id;
  }

  private day(v: AqlValue): string {
    if (v.kind === 'relative') return orgToday(v.days);
    if (v.kind === 'function') {
      const today = orgToday();
      const week = weekStartIso(today);
      const month = `${today.slice(0, 7)}-01`;
      switch (v.name) {
        case 'today':
        case 'now':
          return today;
        case 'startOfWeek':
          return week;
        case 'endOfWeek':
          return addDaysIso(week, 6);
        case 'startOfMonth':
          return month;
        case 'endOfMonth': {
          const [y, m] = month.split('-').map(Number);
          return addDaysIso(
            `${m === 12 ? y! + 1 : y}-${String((m! % 12) + 1).padStart(2, '0')}-01`,
            -1,
          );
        }
        default:
          return fail(`${v.name}() is not a date`);
      }
    }
    const s = text(v);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s)))
      return fail(`"${s}" is not a date (use YYYY-MM-DD, today() or -7d)`);
    return s;
  }
}

const SORT_PATH: Record<string, string> = { priority: 'priorityOrder' };

/** Compiles a query for the caller. The result must still be AND-ed with the read filter. */
export async function compileAql(auth: AuthContext, src: string): Promise<CompiledAql> {
  const q = parseOrFail(src);
  const c = new Compiler(auth);
  const filter = q.where ? await c.node(q.where) : {};
  let sort: Record<string, 1 | -1> | null = null;
  if (q.orderBy.length) {
    sort = {};
    for (const o of q.orderBy) {
      const path = SORT_PATH[o.field] ?? AQL_FIELDS[o.field]!.path;
      // priorityOrder runs critical = 0 … low = 3, so "priority DESC" (highest first) is ascending.
      const dir = o.field === 'priority' ? (o.dir === 'desc' ? 1 : -1) : o.dir === 'desc' ? -1 : 1;
      sort[path] = dir;
    }
    sort._id = 1;
  }
  return { filter, sort, namesProject: c.namesProject };
}
