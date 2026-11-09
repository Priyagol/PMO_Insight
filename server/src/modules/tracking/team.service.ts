import mongoose, { Schema, Types } from 'mongoose';
import { teamSchema, updateTeamSchema, type TeamDto, type TeamInput } from '@arihant/shared';
import { ForbiddenError, NotFoundError, UnprocessableError } from '../../core/errors';
import { requireAuth, type AuthContext, type RequestContext } from '../../core/rbac/context';
import { recordAudit } from '../audit/audit.service';
import { Department } from '../departments/department.model';
import { toUserRef } from '../users/user.mapper';
import { User } from '../users/user.model';

/**
 * A named group of people (for example "Mobile squad" or "QA – Payments"). Teams sit inside a
 * department and can cut across reporting lines; one person may belong to several teams.
 */
export interface ITeam {
  _id: Types.ObjectId;
  name: string;
  description?: string | null;
  departmentId: Types.ObjectId | null;
  leadId: Types.ObjectId | null;
  memberIds: Types.ObjectId[];
  archived: boolean;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const teamModelSchema = new Schema<ITeam>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 500, default: null },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', default: null },
    leadId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    memberIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    archived: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'teams' },
);
teamModelSchema.index({ archived: 1, name: 1 });
teamModelSchema.index({ memberIds: 1 });

export const Team =
  (mongoose.models.Team as mongoose.Model<ITeam> | undefined) ??
  mongoose.model<ITeam>('Team', teamModelSchema);

const oid = (id: string) => new Types.ObjectId(id);

/**
 * Who may create or change a team: people who manage departments (organisation-wide),
 * department heads for teams in their own department, and the team's own lead.
 */
function canEdit(
  auth: AuthContext,
  team: Pick<ITeam, 'departmentId' | 'leadId'> | null,
  departmentId: Types.ObjectId | null,
): boolean {
  if (auth.permissions['department:manage']) return true;
  if (
    auth.permissions['team:read'] === 'department' &&
    auth.departmentId &&
    departmentId?.toString() === auth.departmentId
  )
    return true;
  return Boolean(team?.leadId?.equals(auth.userObjectId));
}

async function present(auth: AuthContext, teams: ITeam[]): Promise<TeamDto[]> {
  const userIds = [
    ...new Set(
      teams
        .flatMap((t) => [...t.memberIds, t.leadId])
        .filter(Boolean)
        .map(String),
    ),
  ];
  const deptIds = [
    ...new Set(
      teams
        .map((t) => t.departmentId)
        .filter(Boolean)
        .map(String),
    ),
  ];
  const [users, depts] = await Promise.all([
    User.find({ _id: { $in: userIds } })
      .select('name email employeeId designation')
      .lean(),
    Department.find({ _id: { $in: deptIds } })
      .select('name')
      .lean(),
  ]);
  const user = new Map(users.map((u) => [u._id.toString(), toUserRef(u)]));
  const dept = new Map(depts.map((d) => [d._id.toString(), d.name]));
  return teams.map((t) => ({
    id: t._id.toString(),
    name: t.name,
    description: t.description ?? null,
    department: t.departmentId
      ? { id: t.departmentId.toString(), name: dept.get(t.departmentId.toString()) ?? '—' }
      : null,
    lead: t.leadId ? (user.get(t.leadId.toString()) ?? null) : null,
    members: t.memberIds
      .map((m) => user.get(m.toString()))
      .filter((u): u is NonNullable<typeof u> => Boolean(u))
      .sort((a, b) => a.name.localeCompare(b.name)),
    canEdit: canEdit(auth, t, t.departmentId),
  }));
}

/** Checks the department and people exist and are active; returns ObjectIds. */
async function resolveRefs(input: {
  departmentId?: string | null;
  leadId?: string | null;
  memberIds?: string[];
}) {
  const departmentId = input.departmentId ? oid(input.departmentId) : null;
  if (departmentId && !(await Department.exists({ _id: departmentId, archived: false })))
    throw new UnprocessableError('Choose an active department');
  const people = [
    ...new Set([...(input.memberIds ?? []), ...(input.leadId ? [input.leadId] : [])]),
  ];
  const active = await User.countDocuments({ _id: { $in: people.map(oid) }, status: 'active' });
  if (active !== people.length)
    throw new UnprocessableError('Every member must be an active employee');
  return {
    departmentId,
    leadId: input.leadId ? oid(input.leadId) : null,
    // The lead is always a member.
    memberIds: people.map(oid),
  };
}

export async function listTeams(rc: RequestContext): Promise<TeamDto[]> {
  const auth = requireAuth(rc);
  if (!auth.permissions['team:read']) throw new ForbiddenError();
  const teams = await Team.find({ archived: false }).sort({ name: 1 }).limit(500).lean();
  return present(auth, teams);
}

export async function createTeam(rc: RequestContext, raw: TeamInput): Promise<TeamDto> {
  const auth = requireAuth(rc);
  const input = teamSchema.parse(raw);
  const refs = await resolveRefs(input);
  if (!canEdit(auth, null, refs.departmentId))
    throw new ForbiddenError('You can create teams only in your own department');
  if (await Team.exists({ archived: false, name: input.name }))
    throw new UnprocessableError('A team with this name already exists');
  const doc = await Team.create({
    name: input.name,
    description: input.description ?? null,
    ...refs,
    createdBy: auth.userObjectId,
  });
  await recordAudit(rc, {
    action: 'team.created',
    entityType: 'team',
    entityId: doc._id,
    summary: `Created team “${input.name}” with ${refs.memberIds.length} member(s)`,
  });
  return (await present(auth, [doc.toObject()]))[0]!;
}

async function loadEditable(auth: AuthContext, id: string) {
  const team = Types.ObjectId.isValid(id)
    ? await Team.findOne({ _id: id, archived: false }).lean()
    : null;
  if (!team) throw new NotFoundError('Team');
  if (!canEdit(auth, team, team.departmentId)) throw new ForbiddenError();
  return team;
}

export async function updateTeam(
  rc: RequestContext,
  id: string,
  raw: Partial<TeamInput>,
): Promise<TeamDto> {
  const auth = requireAuth(rc);
  const team = await loadEditable(auth, id);
  const input = updateTeamSchema.parse(raw);
  const refs = await resolveRefs({
    departmentId:
      input.departmentId !== undefined ? input.departmentId : team.departmentId?.toString(),
    leadId: input.leadId !== undefined ? input.leadId : team.leadId?.toString(),
    memberIds: input.memberIds ?? team.memberIds.map(String),
  });
  // Moving a team to another department needs rights there too.
  if (
    String(refs.departmentId) !== String(team.departmentId) &&
    !canEdit(auth, null, refs.departmentId)
  )
    throw new ForbiddenError('You can move teams only within your own department');
  if (
    input.name &&
    input.name !== team.name &&
    (await Team.exists({ archived: false, name: input.name, _id: { $ne: team._id } }))
  )
    throw new UnprocessableError('A team with this name already exists');
  const next = await Team.findByIdAndUpdate(
    team._id,
    {
      $set: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...refs,
      },
    },
    { returnDocument: 'after' },
  ).lean();
  await recordAudit(rc, {
    action: 'team.updated',
    entityType: 'team',
    entityId: team._id,
    summary: `Updated team “${next!.name}” (${next!.memberIds.length} member(s))`,
  });
  return (await present(auth, [next!]))[0]!;
}

export async function archiveTeam(rc: RequestContext, id: string): Promise<void> {
  const auth = requireAuth(rc);
  const team = await loadEditable(auth, id);
  await Team.updateOne({ _id: team._id }, { $set: { archived: true } });
  await recordAudit(rc, {
    action: 'team.archived',
    entityType: 'team',
    entityId: team._id,
    summary: `Archived team “${team.name}”`,
  });
}
