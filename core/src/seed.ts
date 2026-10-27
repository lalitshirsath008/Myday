/**
 * Seed data for the emulator and the browser demo. Every person and number here is FICTIONAL
 * test data (names carry a "(Test)" suffix). Data is created through the real operations, so
 * seeding also exercises validation, permissions, versioning and audit logging.
 */
import type { AuthAdmin } from './authAdmin';
import { workingDatesInRange } from './calendar';
import { addDays, todayIn, weekStartFor, zonedDateTimeToInstant, type DateStr } from './dates';
import type { TaskInput } from './schemas';
import { RGK_DEPARTMENTS } from './departments';
import { defaultSettings } from './settings';
import type { Store } from './store';
import { COL, type Role, type UserDoc } from './types';
import { dispatch, type OpInput, type OpName, type OpOutput } from './ops';
import type { Ctx } from './ops/context';
import { normalizeName, searchTokens, SETTINGS_ID } from './ops/helpers';
import { codeKey, phoneKey, syntheticEmail } from './ops/auth';

export const DEMO_PASSWORD = 'Test@1234';
/**
 * First password of the ADMIN01 account in a new database. This code is public, so the password is
 * too: the account is created with `mustChangePassword`, and the first sign-in must replace it.
 */
export const INITIAL_ADMIN_PASSWORD = 'RGK@1090';

interface SeedPerson {
  key: string;
  code: string;
  name: string;
  phone: string;
  dept: string;
  designation: string;
  role: Role;
  manager?: string;
  secondary?: string;
}

const PEOPLE: SeedPerson[] = [
  { key: 'mgmt', code: 'MG001', name: 'Meera Kulkarni (Test)', phone: '9000000002', dept: 'MGMT', designation: 'Director — Operations', role: 'MANAGEMENT' },
  { key: 'rm1', code: 'RM101', name: 'Arjun Mehta (Test)', phone: '9000000101', dept: 'RND', designation: 'R&D Manager', role: 'REPORTING_MANAGER' },
  { key: 'rm2', code: 'RM102', name: 'Kavita Rao (Test)', phone: '9000000102', dept: 'PROD', designation: 'Production Manager', role: 'REPORTING_MANAGER' },
  { key: 'e1', code: 'EMP201', name: 'Rohan Patil (Test)', phone: '9000000201', dept: 'RND', designation: 'Software Engineer', role: 'EMPLOYEE', manager: 'rm1' },
  { key: 'e2', code: 'EMP202', name: 'Sneha Joshi (Test)', phone: '9000000202', dept: 'RND', designation: 'Data Analyst', role: 'EMPLOYEE', manager: 'rm1', secondary: 'rm2' },
  { key: 'e3', code: 'EMP203', name: 'Vikram Singh (Test)', phone: '9000000203', dept: 'IT', designation: 'SAP Consultant', role: 'EMPLOYEE', manager: 'rm1' },
  { key: 'e4', code: 'EMP204', name: 'Pooja Deshmukh (Test)', phone: '9000000204', dept: 'PROD', designation: 'Production Engineer', role: 'EMPLOYEE', manager: 'rm2' },
  { key: 'e5', code: 'EMP205', name: 'Amit Sharma (Test)', phone: '9000000205', dept: 'QA', designation: 'Quality Engineer', role: 'EMPLOYEE', manager: 'rm2' },
  { key: 'e6', code: 'EMP206', name: 'Neha Gupta (Test)', phone: '9000000206', dept: 'MACH', designation: 'Maintenance Supervisor', role: 'EMPLOYEE', manager: 'rm2' },
];

const PROJECTS = [
  { key: 'erp', code: 'ERP', name: 'ERP System Development', dept: 'IT', owner: 'rm1', priority: 'HIGH' as const },
  { key: 'sap', code: 'SAP', name: 'SAP Integration', dept: 'IT', owner: 'rm1', priority: 'HIGH' as const },
  { key: 'ai', code: 'AIDB', name: 'AI Analytics Dashboard', dept: 'RND', owner: 'rm1', priority: 'MEDIUM' as const },
  { key: 'pra', code: 'PRA', name: 'Production Reporting Automation', dept: 'PROD', owner: 'rm2', priority: 'MEDIUM' as const },
  { key: 'qms', code: 'QMS', name: 'Quality Audit Readiness', dept: 'QMS', owner: 'rm2', priority: 'LOW' as const },
];

/** Work items per employee: [project key | null, title, description, category]. */
const WORK: Record<string, [string | null, string, string, string][]> = {
  e1: [
    ['erp', 'ERP purchase module — API development', 'Build REST endpoints for purchase requisitions and approvals.', 'Development'],
    ['erp', 'ERP inventory screens', 'Implement stock ledger and bin transfer screens.', 'Development'],
    ['ai', 'Dashboard data pipeline', 'Nightly extraction of production KPIs into the analytics store.', 'Development'],
    [null, 'Code review and team sync', 'Review pull requests and attend daily stand-up.', 'Meeting'],
  ],
  e2: [
    ['ai', 'AI dashboard — demand forecast model', 'Train and validate the weekly demand forecast.', 'Analysis'],
    ['ai', 'KPI definitions workshop', 'Agree KPI formulas with production and quality heads.', 'Meeting'],
    ['erp', 'ERP data migration validation', 'Reconcile migrated item master against the legacy system.', 'Testing'],
  ],
  e3: [
    ['sap', 'SAP FI interface mapping', 'Map ERP journal entries to SAP FI posting keys.', 'Analysis'],
    ['sap', 'SAP IDoc error handling', 'Configure retries and alerts for failed IDocs.', 'Development'],
    ['erp', 'ERP user access matrix', 'Prepare role-based access matrix for ERP go-live.', 'Documentation'],
  ],
  e4: [
    ['pra', 'Shift production report automation', 'Automate the shift-wise output and downtime report.', 'Production'],
    [null, 'Line 2 changeover supervision', 'Supervise die changeover and first-piece approval.', 'Production'],
    ['pra', 'OEE calculation validation', 'Cross-check automated OEE with manual logs.', 'Analysis'],
  ],
  e5: [
    ['qms', 'Internal audit checklist update', 'Update the ISO 9001 internal audit checklist.', 'Documentation'],
    [null, 'Incoming inspection — supplier lots', 'Inspect and release incoming raw material lots.', 'Testing'],
    ['pra', 'Rejection data capture design', 'Define the rejection reason codes for automated reports.', 'Analysis'],
  ],
  e6: [
    [null, 'Preventive maintenance — compressors', 'Monthly PM of air compressors 1 and 2.', 'Maintenance'],
    [null, 'Breakdown analysis — press 4', 'Root-cause analysis of the hydraulic leak on press 4.', 'Maintenance'],
    ['pra', 'Downtime code standardisation', 'Standardise downtime codes used in production reports.', 'Documentation'],
  ],
};

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SeedResult {
  users: Record<string, { id: string; code: string; role: Role }>;
  today: DateStr;
  superAdminCode: string;
}

/**
 * Populate an EMPTY store. `withHistory` generates three weeks of reports for realistic dashboards.
 */
export async function seedDemoData(
  store: Store,
  auth: AuthAdmin,
  opts: { now?: Date; appUrl?: string; withHistory?: boolean } = {},
): Promise<SeedResult> {
  const realNow = opts.now ?? new Date();
  const appUrl = opts.appUrl ?? 'http://localhost:5173';
  const settings = defaultSettings(realNow.toISOString());
  const tz = settings.timezone;
  const today = todayIn(tz, realNow);
  const at = (date: DateStr, time: string) => zonedDateTimeToInstant(date, time, tz);

  // 1. Settings, departments and the bootstrap Super Admin (written directly — there is no admin yet).
  const adminId = 'seed_superadmin';
  const nowIso = realNow.toISOString();
  const admin: UserDoc = {
    id: adminId,
    employeeCode: 'SA001',
    fullName: 'System Administrator (Test)',
    normalizedName: '',
    searchTokens: [],
    phoneNumber: '9000000001',
    officialEmail: null,
    authEmail: syntheticEmail('SA001'),
    departmentId: 'dept_it',
    designation: 'IT Administrator',
    role: 'SUPER_ADMIN',
    primaryReportingManagerId: null,
    secondaryReviewerId: null,
    accountStatus: 'ACTIVE',
    joinedAt: addDays(today, -60),
    activatedAt: nowIso,
    deactivatedAt: null,
    alternatePhone: '',
    location: 'Head Office',
    createdAt: nowIso,
    updatedAt: nowIso,
    createdBy: null,
  };
  admin.normalizedName = normalizeName(admin.fullName);
  admin.searchTokens = searchTokens(admin);
  await store.transaction(async (tx) => {
    tx.set(COL.systemSettings, SETTINGS_ID, { ...settings, id: SETTINGS_ID } as never);
    for (const d of RGK_DEPARTMENTS) {
      tx.set(COL.departments, d.id, { id: d.id, name: d.name, code: d.code, description: '', active: true, createdAt: nowIso, updatedAt: nowIso });
    }
    tx.set(COL.users, adminId, admin as never);
    for (const k of [codeKey(admin.employeeCode), phoneKey(admin.phoneNumber), `email_${admin.authEmail}`]) tx.set(COL.uniqueKeys, k, { id: k, ownerId: adminId, createdAt: nowIso });

    const admin01Id = 'seed_admin01';
    const admin01: UserDoc = {
      id: admin01Id,
      employeeCode: 'ADMIN01',
      fullName: 'RGK Admin',
      normalizedName: normalizeName('RGK Admin'),
      searchTokens: [],
      phoneNumber: '9000000000',
      officialEmail: 'admin@rgk.com',
      authEmail: 'admin@rgk.com',
      departmentId: 'dept_it',
      designation: 'Administrator',
      role: 'SUPER_ADMIN',
      primaryReportingManagerId: null,
      secondaryReviewerId: null,
      accountStatus: 'ACTIVE',
      joinedAt: addDays(today, -60),
      activatedAt: nowIso,
      deactivatedAt: null,
      alternatePhone: '',
      location: 'Head Office',
      createdAt: nowIso,
      updatedAt: nowIso,
      createdBy: null,
    };
    admin01.searchTokens = searchTokens(admin01);
    tx.set(COL.users, admin01Id, admin01 as never);
    for (const k of [codeKey('ADMIN01'), phoneKey('9000000000'), 'email_admin@rgk.com']) tx.set(COL.uniqueKeys, k, { id: k, ownerId: admin01Id, createdAt: nowIso });
  });
  await auth.createUser({ uid: adminId, email: admin.authEmail, disabled: false });
  await auth.setPassword(adminId, DEMO_PASSWORD);
  await auth.createUser({ uid: 'seed_admin01', email: 'admin@rgk.com', disabled: false });
  await auth.setPassword('seed_admin01', DEMO_PASSWORD);

  let clock = realNow;
  const ctxFor = async (actorId: string | null): Promise<Ctx> => ({
    store,
    auth,
    now: () => clock,
    actor: actorId ? ((await store.get<UserDoc & { id: string }>(COL.users, actorId)) as UserDoc) : null,
    correlationId: `seed-${Math.random().toString(36).slice(2, 10)}`,
    appUrl,
  });
  const call = async <K extends OpName>(actorId: string, name: K, input: OpInput<K>): Promise<OpOutput<K>> =>
    (await dispatch(await ctxFor(actorId), name, input)) as OpOutput<K>;

  // 2. People, created and activated through the real admin + activation operations.
  const users: SeedResult['users'] = { admin: { id: adminId, code: 'SA001', role: 'SUPER_ADMIN' } };
  for (const p of PEOPLE) {
    const res = await call(adminId, 'admin.users.create', {
      fullName: p.name,
      employeeCode: p.code,
      phoneNumber: p.phone,
      officialEmail: null,
      departmentId: `dept_${p.dept.toLowerCase()}`,
      designation: p.designation,
      role: p.role,
      primaryReportingManagerId: p.manager ? users[p.manager]!.id : null,
      secondaryReviewerId: p.secondary ? users[p.secondary]!.id : null,
      joinedAt: addDays(today, -45),
      initialPassword: DEMO_PASSWORD,
      requirePasswordChange: false,
    });
    users[p.key] = { id: res.userId, code: p.code, role: p.role };
  }

  // 3. Projects.
  const projectIds: Record<string, string> = {};
  for (const pr of PROJECTS) {
    const res = await call(adminId, 'admin.projects.upsert', {
      id: null,
      name: pr.name,
      code: pr.code,
      description: `${pr.name} (test project).`,
      departmentId: `dept_${pr.dept.toLowerCase()}`,
      ownerId: users[pr.owner]!.id,
      participantIds: Object.entries(WORK).filter(([, w]) => w.some(([k]) => k === pr.key)).map(([e]) => users[e]!.id),
      startDate: addDays(today, -40),
      targetEndDate: addDays(today, 60),
      status: 'ACTIVE',
      priority: pr.priority,
      milestones: [
        { title: 'Design sign-off', dueDate: addDays(today, -20), done: true },
        { title: 'Pilot', dueDate: addDays(today, 20), done: false },
      ],
    });
    projectIds[pr.key] = res.project.id;
  }

  // 4. Calendar: past exceptions are written before "today" moves, future ones through the API.
  const nextWednesday = (() => {
    let d = addDays(today, 1);
    while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 3) d = addDays(d, 1);
    return d;
  })();
  const pastWednesday = (() => {
    let d = addDays(today, -8);
    while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 3) d = addDays(d, -1);
    return d;
  })();
  clock = at(addDays(pastWednesday, -1), '09:00');
  await call(adminId, 'admin.calendar.upsertException', { date: pastWednesday, type: 'WORKING_DAY', name: 'Month-end working Wednesday', description: 'Declared working day (test data)', departmentId: null });
  clock = realNow;
  await call(adminId, 'admin.calendar.upsertException', { date: nextWednesday, type: 'WORKING_DAY', name: 'Quarter-end working Wednesday', description: 'Regular reports expected (test data)', departmentId: null });
  await call(adminId, 'admin.calendar.upsertException', { date: addDays(nextWednesday, 2), type: 'HOLIDAY', name: 'Company Foundation Day', description: 'Company holiday (test data)', departmentId: null });

  if (opts.withHistory !== false) {
    await generateHistory({ users, projectIds, today, at, call, setClock: (d) => (clock = d), store, settings });
  }
  clock = realNow;
  return { users, today, superAdminCode: 'SA001' };
}

async function generateHistory(args: {
  users: SeedResult['users'];
  projectIds: Record<string, string>;
  today: DateStr;
  at: (d: DateStr, t: string) => Date;
  call: <K extends OpName>(actorId: string, name: K, input: OpInput<K>) => Promise<OpOutput<K>>;
  setClock: (d: Date) => void;
  store: Store;
  settings: ReturnType<typeof defaultSettings>;
}) {
  const { users, projectIds, today, at, call, setClock, store, settings } = args;
  const rand = rng(20251025);
  const start = addDays(weekStartFor(today, settings.weekStartDay), -14);
  const exceptions = await store.query(COL.workCalendar, {});
  const progress = new Map<string, number>();
  const employeeKeys = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'];
  const managerOf: Record<string, string> = { e1: 'rm1', e2: 'rm1', e3: 'rm1', e4: 'rm2', e5: 'rm2', e6: 'rm2' };

  for (const ek of employeeKeys) {
    const emp = users[ek]!;
    const dates = workingDatesInRange(start, today, settings.calendarPolicies, exceptions as never, null);
    for (const date of dates) {
      const isToday = date === today;
      if (!isToday && rand() < 0.1) continue; // occasional missed report
      const items = WORK[ek]!;
      const count = 3; // a report can only be submitted with all 3 priority tasks
      const offset = Math.floor(rand() * items.length);
      const tasks: TaskInput[] = [];
      for (let i = 0; i < count; i++) {
        const [pk, title, description, category] = items[(offset + i) % items.length]!;
        const itemKey = `${ek}|${title}`;
        const prev = progress.get(itemKey) ?? 0;
        const next = Math.min(100, prev + 10 + Math.floor(rand() * 30));
        const blocked = rand() < 0.06;
        const status = next >= 100 ? 'COMPLETED' : blocked ? 'BLOCKED' : next === 0 ? 'PLANNED' : 'IN_PROGRESS';
        progress.set(itemKey, next >= 100 ? 0 : next);
        const startH = 9 + i * 2 + Math.floor(rand() * 2);
        const hasActual = rand() < 0.7;
        const collaborator = rand() < 0.3 ? employeeKeys.filter((k) => k !== ek)[Math.floor(rand() * 5)]! : null;
        tasks.push({
          title,
          description,
          priority: i === 0 ? 'HIGH' : rand() < 0.5 ? 'MEDIUM' : 'LOW',
          plannedStartTime: `${String(startH).padStart(2, '0')}:00`,
          plannedEndTime: `${String(startH + 2).padStart(2, '0')}:00`,
          actualStartTime: hasActual ? `${String(startH).padStart(2, '0')}:15` : null,
          actualEndTime: hasActual ? `${String(startH + 2).padStart(2, '0')}:30` : null,
          overnight: false,
          dueDate: rand() < 0.35 ? addDays(date, Math.floor(rand() * 6)) : null,
          projectId: pk ? projectIds[pk]! : null,
          category,
          collaboratorIds: collaborator ? [users[collaborator]!.id] : [],
          progressPercentage: status === 'COMPLETED' ? 100 : status === 'PLANNED' ? 0 : next,
          status,
          notes: '',
        });
      }
      if (isToday) {
        // Today: drafts only, so every demo user can still fill in and submit today's report.
        setClock(at(date, '12:00'));
        await call(emp.id, 'daily.save', { workDate: date, tasks, employeeNotes: '', submit: false, expectedRevision: null });
        continue;
      }
      const late = rand() < 0.08;
      setClock(late ? at(addDays(date, 1), '10:30') : at(date, '18:30'));
      const saved = await call(emp.id, 'daily.save', { workDate: date, tasks, employeeNotes: rand() < 0.2 ? 'Waiting on inputs from the supplier.' : '', submit: true, expectedRevision: null });
      // Manager reviews the next morning.
      const roll = rand();
      if (roll < 0.15 && addDays(date, 2) < today) continue; // left pending
      if (addDays(date, 1) >= today) continue; // yesterday's reports still pending review
      const mgr = users[managerOf[ek]!]!;
      setClock(at(addDays(date, 1), '11:00'));
      await call(mgr.id, 'review.markViewed', { reportType: 'DAILY', reportId: saved.report.id });
      if (roll > 0.9) {
        await call(mgr.id, 'review.act', { reportType: 'DAILY', reportId: saved.report.id, action: 'RETURNED', comment: 'Please add the actual times and a clearer description for task 1.', reportVersion: saved.report.version });
        setClock(at(addDays(date, 1), '15:00'));
        const fixed = tasks.map((t, i) => (i === 0 ? { ...t, description: `${t.description} Completed review of open points with the team.`, actualStartTime: t.actualStartTime ?? t.plannedStartTime, actualEndTime: t.actualEndTime ?? t.plannedEndTime } : t));
        const resub = await call(emp.id, 'daily.save', { workDate: date, tasks: fixed, employeeNotes: 'Corrected as requested.', submit: true, expectedRevision: saved.report.revision });
        setClock(at(addDays(date, 1), '17:00'));
        await call(mgr.id, 'review.act', { reportType: 'DAILY', reportId: resub.report.id, action: 'APPROVED', comment: 'Thanks, looks good now.', reportVersion: resub.report.version });
      } else {
        await call(mgr.id, 'review.act', { reportType: 'DAILY', reportId: saved.report.id, action: 'APPROVED', comment: rand() < 0.3 ? 'Good progress.' : '', reportVersion: saved.report.version });
      }
    }

    // Weekly reports for the two completed weeks.
    for (const periodStart of [start, addDays(start, 7)]) {
      const periodEnd = addDays(periodStart, 6);
      if (periodEnd >= today) continue;
      setClock(at(periodEnd, '17:00'));
      const preview = await call(emp.id, 'weekly.preview', { periodStart });
      setClock(at(preview.submitOpensOn, '18:45'));
      const w = await call(emp.id, 'weekly.save', {
        periodStart,
        narrative: {
          majorAccomplishments: 'Delivered planned milestones for the week; see project breakdown.',
          projectProgress: preview.summary.projects.map((p) => `${p.projectName}: ${p.completed}/${p.tasks} tasks completed`).join('\n'),
          keyDeliverables: 'Weekly status update shared with stakeholders.',
          blockers: rand() < 0.4 ? 'Awaiting vendor confirmation on interface specs.' : '',
          decisionsRequired: '',
          collaborationSummary: 'Worked with cross-functional team members on shared tasks.',
          nextWeekPlan: 'Continue current work items and close open review points.',
          employeeComments: '',
        },
        submit: true,
        expectedRevision: null,
      });
      if (periodStart === start) {
        const mgr = users[managerOf[ek]!]!;
        setClock(at(addDays(periodEnd, 1), '12:00'));
        await call(mgr.id, 'review.markViewed', { reportType: 'WEEKLY', reportId: w.report.id });
        await call(mgr.id, 'review.act', { reportType: 'WEEKLY', reportId: w.report.id, action: 'APPROVED', comment: 'Approved.', reportVersion: w.report.version });
      }
    }
  }
}

/**
 * Seed production baseline data: 23 full RGK departments and Super Admin ADMIN01.
 * Clean slate with NO test users, NO dummy tasks.
 */
export async function seedProductionData(
  store: Store,
  auth: AuthAdmin,
  opts: { now?: Date; appUrl?: string } = {},
): Promise<void> {
  const realNow = opts.now ?? new Date();
  const settings = defaultSettings(realNow.toISOString());
  const tz = settings.timezone;
  const today = todayIn(tz, realNow);
  const nowIso = realNow.toISOString();

  const admin01Id = 'seed_admin01';
  const admin01: UserDoc = {
    id: admin01Id,
    employeeCode: 'ADMIN01',
    fullName: 'RGK Admin',
    normalizedName: normalizeName('RGK Admin'),
    searchTokens: [],
    phoneNumber: '9000000000',
    officialEmail: 'Admin@rgk.com',
    authEmail: 'admin@rgk.com',
    departmentId: 'dept_mgmt',
    designation: 'Super Administrator',
    role: 'SUPER_ADMIN',
    primaryReportingManagerId: null,
    secondaryReviewerId: null,
    accountStatus: 'ACTIVE',
    mustChangePassword: true,
    joinedAt: addDays(today, -60),
    activatedAt: nowIso,
    deactivatedAt: null,
    alternatePhone: '',
    location: 'Head Office',
    createdAt: nowIso,
    updatedAt: nowIso,
    createdBy: null,
  };
  admin01.searchTokens = searchTokens(admin01);

  await store.transaction(async (tx) => {
    tx.set(COL.systemSettings, SETTINGS_ID, { ...settings, id: SETTINGS_ID } as never);
    for (const d of RGK_DEPARTMENTS) {
      tx.set(COL.departments, d.id, {
        id: d.id,
        name: d.name,
        code: d.code,
        description: `${d.name} Department`,
        active: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }
    tx.set(COL.users, admin01Id, admin01 as never);
    for (const k of [
      codeKey('ADMIN01'),
      codeKey('admin01'),
      phoneKey('9000000000'),
      'email_admin@rgk.com',
      'email_Admin@rgk.com',
    ]) {
      tx.set(COL.uniqueKeys, k, { id: k, ownerId: admin01Id, createdAt: nowIso });
    }
  });

  try {
    await auth.createUser({ uid: admin01Id, email: 'admin@rgk.com', disabled: false });
  } catch {
    // Already created
  }
  await auth.setPassword(admin01Id, INITIAL_ADMIN_PASSWORD);
}
