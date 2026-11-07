/**
 * DEVELOPMENT ONLY - creates clearly-labelled synthetic departments and employees so the
 * directory, roles and (later) smart assignment can be exercised. Refuses to run unless
 * NODE_ENV=development. Every record is marked "DEV" and uses @dev.arihant.local e-mails.
 *
 *   npm run seed:dev -w server
 *
 * All seeded accounts share the password in DEV_SEED_PASSWORD (default: DevPass2026!).
 */
import { type Types } from 'mongoose';
import { env, isDevelopment } from '../config/env';
import { connectMongo, disconnectMongo } from '../config/db';
import { logger } from '../config/logger';
import { hashPassword } from '../core/auth/password';
import { Department } from '../modules/departments/department.model';
import { ensureSystemRoles, getRoleIdByKey } from '../modules/roles/role.service';
import { registerSkills } from '../modules/skills/skill.model';
import { User } from '../modules/users/user.model';

const DEPARTMENTS = [
  { code: 'DEV-TECH', name: 'DEV Technology' },
  { code: 'DEV-QA', name: 'DEV Quality Assurance' },
  { code: 'DEV-OPS', name: 'DEV Operations' },
];

type Seed = {
  id: string;
  name: string;
  dept: string;
  role: string;
  designation: string;
  skills: [string, number][];
  manager?: string;
};

const PEOPLE: Seed[] = [
  {
    id: 'DEV-001',
    name: 'Dev Director',
    dept: 'DEV-OPS',
    role: 'director',
    designation: 'DEV Director',
    skills: [],
  },
  {
    id: 'DEV-002',
    name: 'Dev Tech Head',
    dept: 'DEV-TECH',
    role: 'department_head',
    designation: 'DEV Head of Technology',
    skills: [['Architecture', 5]],
    manager: 'DEV-001',
  },
  {
    id: 'DEV-003',
    name: 'Dev Project Manager',
    dept: 'DEV-TECH',
    role: 'project_manager',
    designation: 'DEV Project Manager',
    skills: [['Planning', 4]],
    manager: 'DEV-002',
  },
  {
    id: 'DEV-004',
    name: 'Dev Team Lead',
    dept: 'DEV-TECH',
    role: 'team_lead',
    designation: 'DEV Team Lead',
    skills: [
      ['React', 5],
      ['Node.js', 4],
    ],
    manager: 'DEV-003',
  },
  {
    id: 'DEV-005',
    name: 'Dev Developer One',
    dept: 'DEV-TECH',
    role: 'developer',
    designation: 'DEV Software Engineer',
    skills: [
      ['React', 4],
      ['TypeScript', 4],
    ],
    manager: 'DEV-004',
  },
  {
    id: 'DEV-006',
    name: 'Dev Developer Two',
    dept: 'DEV-TECH',
    role: 'developer',
    designation: 'DEV Software Engineer',
    skills: [
      ['Node.js', 4],
      ['MongoDB', 3],
    ],
    manager: 'DEV-004',
  },
  {
    id: 'DEV-007',
    name: 'Dev QA Head',
    dept: 'DEV-QA',
    role: 'department_head',
    designation: 'DEV Head of QA',
    skills: [['Test Strategy', 5]],
    manager: 'DEV-001',
  },
  {
    id: 'DEV-008',
    name: 'Dev Tester One',
    dept: 'DEV-QA',
    role: 'qa_tester',
    designation: 'DEV QA Engineer',
    skills: [
      ['Manual Testing', 4],
      ['API Testing', 3],
    ],
    manager: 'DEV-007',
  },
  {
    id: 'DEV-009',
    name: 'Dev Tester Two',
    dept: 'DEV-QA',
    role: 'qa_tester',
    designation: 'DEV QA Engineer',
    skills: [
      ['Manual Testing', 3],
      ['Automation', 4],
    ],
    manager: 'DEV-007',
  },
  {
    id: 'DEV-010',
    name: 'Dev Tester Three',
    dept: 'DEV-QA',
    role: 'qa_tester',
    designation: 'DEV QA Engineer',
    skills: [
      ['Automation', 3],
      ['Performance Testing', 3],
    ],
    manager: 'DEV-007',
  },
  {
    id: 'DEV-011',
    name: 'Dev Tester Four',
    dept: 'DEV-QA',
    role: 'qa_tester',
    designation: 'DEV QA Engineer',
    skills: [['Manual Testing', 5]],
    manager: 'DEV-007',
  },
  {
    id: 'DEV-012',
    name: 'Dev Ops Analyst',
    dept: 'DEV-OPS',
    role: 'employee',
    designation: 'DEV Operations Analyst',
    skills: [['Excel', 4]],
    manager: 'DEV-001',
  },
];

async function main(): Promise<void> {
  if (!isDevelopment) throw new Error('seed:dev only runs with NODE_ENV=development');
  await connectMongo(env.MONGO_URI);
  await ensureSystemRoles();

  const deptIds = new Map<string, Types.ObjectId>();
  for (const d of DEPARTMENTS) {
    const doc = await Department.findOneAndUpdate(
      { code: d.code, archived: false },
      { $setOnInsert: { ...d, description: 'Synthetic development data', archived: false } },
      { upsert: true, returnDocument: 'after' },
    ).lean();
    deptIds.set(d.code, doc!._id);
  }

  const passwordHash = await hashPassword(process.env.DEV_SEED_PASSWORD ?? 'DevPass2026!');
  const userIds = new Map<string, Types.ObjectId>();
  for (const p of PEOPLE) {
    const email = `${p.id.toLowerCase()}@dev.arihant.local`;
    const doc = await User.findOneAndUpdate(
      { email },
      {
        $setOnInsert: {
          employeeId: p.id,
          name: p.name,
          email,
          passwordHash,
          departmentId: deptIds.get(p.dept),
          designation: p.designation,
          roleIds: [await getRoleIdByKey(p.role)],
          skills: p.skills.map(([name, level]) => ({ name, level })),
          weeklyCapacityHours: 40,
          status: 'active',
        },
      },
      { upsert: true, returnDocument: 'after' },
    ).lean();
    userIds.set(p.id, doc!._id);
  }
  for (const p of PEOPLE) {
    if (p.manager)
      await User.updateOne(
        { _id: userIds.get(p.id) },
        { $set: { managerId: userIds.get(p.manager) } },
      );
  }
  await Department.updateOne(
    { code: 'DEV-TECH', archived: false },
    { $set: { headId: userIds.get('DEV-002') } },
  );
  await Department.updateOne(
    { code: 'DEV-QA', archived: false },
    { $set: { headId: userIds.get('DEV-007') } },
  );
  await Department.updateOne(
    { code: 'DEV-OPS', archived: false },
    { $set: { headId: userIds.get('DEV-001') } },
  );
  await registerSkills(PEOPLE.flatMap((p) => p.skills.map(([n]) => n)));

  logger.info(
    { departments: DEPARTMENTS.length, employees: PEOPLE.length },
    'DEV seed complete (password: DEV_SEED_PASSWORD or DevPass2026!)',
  );
}

main()
  .catch((err: unknown) => {
    logger.fatal({ err }, 'DEV seed failed');
    process.exitCode = 1;
  })
  .finally(() => void disconnectMongo());
