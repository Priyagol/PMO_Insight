import { Types } from 'mongoose';
import type { DepartmentDto, DepartmentInput } from '@arihant/shared';
import { departmentSchema } from '@arihant/shared';
import { ConflictError, NotFoundError, UnprocessableError } from '../../core/errors';
import { requireAuth, type RequestContext } from '../../core/rbac/context';
import { recordAudit } from '../audit/audit.service';
import { toUserRef } from '../users/user.mapper';
import { User } from '../users/user.model';
import { Department, type IDepartment } from './department.model';

const oid = (id: string) => new Types.ObjectId(id);

type PopulatedDepartment = Omit<IDepartment, 'headId' | 'parentId'> & {
  headId: {
    _id: Types.ObjectId;
    name: string;
    email: string;
    employeeId: string;
    designation?: string;
  } | null;
  parentId: { _id: Types.ObjectId; name: string; code: string } | null;
};

function toDto(d: PopulatedDepartment, memberCount: number): DepartmentDto {
  return {
    id: d._id.toString(),
    name: d.name,
    code: d.code,
    description: d.description,
    head: d.headId ? toUserRef(d.headId) : null,
    parent: d.parentId
      ? { id: d.parentId._id.toString(), name: d.parentId.name, code: d.parentId.code }
      : null,
    memberCount,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

const POPULATE = [
  { path: 'headId', select: 'name email employeeId designation' },
  { path: 'parentId', select: 'name code' },
];

async function memberCounts(ids: Types.ObjectId[]): Promise<Map<string, number>> {
  const rows = await User.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { departmentId: { $in: ids }, status: 'active' } },
    { $group: { _id: '$departmentId', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id.toString(), r.count]));
}

/** Department names are not sensitive; every signed-in user can list them for filters and forms. */
export async function listDepartments(q?: string): Promise<DepartmentDto[]> {
  const filter: Record<string, unknown> = { archived: false };
  if (q) filter.name = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const docs = await Department.find(filter)
    .sort({ name: 1 })
    .populate(POPULATE)
    .lean<PopulatedDepartment[]>();
  const counts = await memberCounts(docs.map((d) => d._id));
  return docs.map((d) => toDto(d, counts.get(d._id.toString()) ?? 0));
}

export async function getDepartment(id: string): Promise<DepartmentDto> {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError('Department');
  const doc = await Department.findOne({ _id: oid(id), archived: false })
    .populate(POPULATE)
    .lean<PopulatedDepartment>();
  if (!doc) throw new NotFoundError('Department');
  const counts = await memberCounts([doc._id]);
  return toDto(doc, counts.get(doc._id.toString()) ?? 0);
}

async function validateRefs(id: string | null, input: Partial<DepartmentInput>): Promise<void> {
  if (input.headId) {
    const head = await User.findById(input.headId).select('status').lean();
    if (!head || head.status !== 'active')
      throw new UnprocessableError('Department head must be an active employee');
  }
  if (input.parentId) {
    if (id && input.parentId === id)
      throw new UnprocessableError('A department cannot be its own parent');
    let cursor: Types.ObjectId | null = oid(input.parentId);
    for (let depth = 0; cursor && depth < 50; depth += 1) {
      const parent: { _id: Types.ObjectId; parentId: Types.ObjectId | null } | null =
        await Department.findOne({
          _id: cursor,
          archived: false,
        })
          .select('parentId')
          .lean();
      if (!parent) throw new UnprocessableError('Parent department does not exist');
      if (id && parent.parentId?.toString() === id)
        throw new UnprocessableError('This would create a department cycle');
      cursor = parent.parentId;
    }
  }
}

async function assertCodeFree(code: string, exceptId?: string): Promise<void> {
  const existing = await Department.findOne({ code, archived: false }).select('_id').lean();
  if (existing && existing._id.toString() !== exceptId)
    throw new ConflictError(`Department code ${code} is already in use`);
}

export async function createDepartment(
  rc: RequestContext,
  raw: DepartmentInput,
): Promise<DepartmentDto> {
  const auth = requireAuth(rc);
  const input = departmentSchema.parse(raw);
  await assertCodeFree(input.code);
  await validateRefs(null, input);
  const dept = await Department.create({
    name: input.name,
    code: input.code,
    description: input.description,
    headId: input.headId ? oid(input.headId) : null,
    parentId: input.parentId ? oid(input.parentId) : null,
    createdBy: auth.userObjectId,
  });
  const dto = await getDepartment(dept._id.toString());
  await recordAudit(rc, {
    action: 'department.created',
    entityType: 'department',
    entityId: dept._id,
    summary: `Created department ${dto.name} (${dto.code})`,
    after: dto,
  });
  return dto;
}

export async function updateDepartment(
  rc: RequestContext,
  id: string,
  input: Partial<DepartmentInput>,
): Promise<DepartmentDto> {
  const before = await getDepartment(id);
  if (input.code) await assertCodeFree(input.code, id);
  await validateRefs(id, input);
  const update: Record<string, unknown> = {};
  for (const key of ['name', 'code', 'description'] as const)
    if (input[key] !== undefined) update[key] = input[key];
  if (input.headId !== undefined) update.headId = input.headId ? oid(input.headId) : null;
  if (input.parentId !== undefined) update.parentId = input.parentId ? oid(input.parentId) : null;
  await Department.updateOne({ _id: oid(id) }, { $set: update }, { runValidators: true });
  const after = await getDepartment(id);
  await recordAudit(rc, {
    action: 'department.updated',
    entityType: 'department',
    entityId: id,
    summary: `Updated department ${after.name} (${after.code})`,
    before,
    after,
  });
  return after;
}

/** Soft-deletes a department. Refused while active employees or sub-departments remain. */
export async function archiveDepartment(rc: RequestContext, id: string): Promise<void> {
  const dept = await getDepartment(id);
  if (dept.memberCount > 0) {
    throw new ConflictError(
      `${dept.memberCount} active employee(s) still belong to ${dept.name}. Move them first.`,
    );
  }
  if (await Department.exists({ parentId: oid(id), archived: false })) {
    throw new ConflictError(`${dept.name} still has sub-departments. Move or archive them first.`);
  }
  await Department.updateOne(
    { _id: oid(id) },
    { $set: { archived: true, archivedAt: new Date() } },
  );
  await recordAudit(rc, {
    action: 'department.archived',
    entityType: 'department',
    entityId: id,
    summary: `Archived department ${dept.name} (${dept.code})`,
    before: dept,
  });
}
