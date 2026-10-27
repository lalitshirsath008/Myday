import { beforeEach, describe, expect, it } from 'vitest';
import { dispatch } from '../src/ops';
import { COL, type AuditLogDoc, type NotificationDoc, type ReportVersionDoc, type UserDoc } from '../src/types';
import { DEMO_PASSWORD } from '../src/seed';
import { expectCode, makeWorld, task, threeTasks, type World } from './helpers';

const TODAY = '2025-10-25'; // Saturday, a working day under the default policy

async function submitToday(w: World, key: string, tasks = [task(), task({ title: 'Line 2 changeover', status: 'COMPLETED', progressPercentage: 100 }), task({ title: 'Quality check on batch 7' })]) {
  return w.call(key, 'daily.save', { workDate: TODAY, tasks, employeeNotes: '', submit: true, expectedRevision: null });
}

describe('authentication and accounts', () => {
  let w: World;
  beforeEach(async () => (w = await makeWorld()));

  it('resolves employee code and phone to the same sign-in identity, and hides unknown ones', async () => {
    const byCode = await w.call(null, 'auth.resolveIdentifier', { identifier: 'emp201' });
    const byPhone = await w.call(null, 'auth.resolveIdentifier', { identifier: '+91 90000 00201' });
    const unknown = await w.call(null, 'auth.resolveIdentifier', { identifier: 'NOPE99' });
    expect(byCode.email).toBe(byPhone.email);
    expect(unknown.email).toMatch(/@users\.rgk-worktrack\.invalid$/);
    expect(await w.auth.verify(byCode.email, DEMO_PASSWORD)).toEqual({ uid: w.id('e1') });
    expect(await w.auth.verify(unknown.email, DEMO_PASSWORD)).toEqual({ error: 'auth/invalid-credential' });
  });

  it('creates accounts that are active immediately with the admin-chosen password (no activation link)', async () => {
    const res = await w.call('admin', 'admin.users.create', {
      fullName: 'New Joiner (Test)', employeeCode: 'EMP300', phoneNumber: '9000000300', officialEmail: null,
      departmentId: 'dept_hr', designation: 'HR Executive', role: 'EMPLOYEE',
      primaryReportingManagerId: w.id('rm2'), secondaryReviewerId: null, joinedAt: null,
      initialPassword: 'Welcome123', requirePasswordChange: true,
    });
    const user = await w.store.get<UserDoc & { id: string }>(COL.users, res.userId);
    expect(user).toMatchObject({ accountStatus: 'ACTIVE', mustChangePassword: true });
    expect(await w.store.query(COL.activationTokens, { where: [['userId', '==', res.userId]] })).toHaveLength(0);
    // Signs in straight away; the password is not stored anywhere in the database or audit log.
    const { email } = await w.call(null, 'auth.resolveIdentifier', { identifier: 'EMP300' });
    expect(await w.auth.verify(email, 'Welcome123')).toEqual({ uid: res.userId });
    expect(JSON.stringify(w.store.snapshot())).not.toContain('Welcome123');
    // After choosing their own password the prompt is cleared.
    w.seed.users.joiner = { id: res.userId, code: 'EMP300', role: 'EMPLOYEE' };
    expect((await w.call('joiner', 'me.get', {})).user.mustChangePassword).toBe(true);
    await w.call('joiner', 'me.passwordChanged', {});
    expect((await w.call('joiner', 'me.get', {})).user.mustChangePassword).toBe(false);
    // Weak initial passwords are rejected.
    await expectCode(w.call('admin', 'admin.users.create', { fullName: 'Weak (Test)', employeeCode: 'EMP301', phoneNumber: '9000000301', officialEmail: null, departmentId: 'dept_hr', designation: 'X', role: 'EMPLOYEE', primaryReportingManagerId: null, secondaryReviewerId: null, joinedAt: null, initialPassword: 'short' }), 'invalid-argument');
  });

  it('lets an admin set a new password but never their own, and audits without the password', async () => {
    await w.call('admin', 'admin.users.setPassword', { userId: w.id('e3'), password: 'NewPass2026', requirePasswordChange: true, reason: 'Forgot password' });
    const { email } = await w.call(null, 'auth.resolveIdentifier', { identifier: 'EMP203' });
    expect(await w.auth.verify(email, 'NewPass2026')).toEqual({ uid: w.id('e3') });
    expect((await w.store.get<UserDoc & { id: string }>(COL.users, w.id('e3')))?.mustChangePassword).toBe(true);
    const audits = await w.store.query<AuditLogDoc & { id: string }>(COL.auditLogs, { where: [['action', '==', 'PASSWORD_SET_BY_ADMIN']] });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toContain('NewPass2026');
    await expectCode(w.call('admin', 'admin.users.setPassword', { userId: w.id('admin'), password: 'NewPass2026' }), 'failed-precondition');
    await expectCode(w.call('rm1', 'admin.users.setPassword', { userId: w.id('e1'), password: 'NewPass2026' }), 'permission-denied');
  });

  it('enforces unique employee codes and mobile numbers', async () => {
    const base = { fullName: 'Dup (Test)', officialEmail: null, departmentId: 'dept_hr', designation: 'X', role: 'EMPLOYEE' as const, primaryReportingManagerId: null, secondaryReviewerId: null, joinedAt: null, initialPassword: 'Welcome123' };
    await expectCode(w.call('admin', 'admin.users.create', { ...base, employeeCode: 'EMP201', phoneNumber: '9000000399' }), 'already-exists');
    await expectCode(w.call('admin', 'admin.users.create', { ...base, employeeCode: 'EMP399', phoneNumber: '9000000201' }), 'already-exists');
  });

  it('self-registration stays pending and cannot choose a role', async () => {
    await w.call(null, 'auth.submitRegistration', { fullName: 'Walk In (Test)', employeeCode: 'EMP400', phoneNumber: '9000000400', officialEmail: null, departmentId: 'dept_qa', designation: '' });
    const reqs = await w.call('admin', 'admin.registrations.list', { status: 'PENDING' });
    expect(reqs.items).toHaveLength(1);
    expect(reqs.items[0]).not.toHaveProperty('role');
    await expectCode(w.call('e1', 'admin.registrations.list', { status: 'PENDING' }), 'permission-denied');
    const approved = await w.call('admin', 'admin.registrations.approve', {
      requestId: reqs.items[0]!.id, fullName: 'Walk In (Test)', employeeCode: 'EMP400', phoneNumber: '9000000400', officialEmail: null,
      departmentId: 'dept_qa', designation: 'Inspector', role: 'EMPLOYEE', primaryReportingManagerId: w.id('rm2'), secondaryReviewerId: null, joinedAt: null,
      initialPassword: 'Welcome123',
    });
    expect(approved.employeeCode).toBe('EMP400');
    await expectCode(w.call(null, 'auth.submitRegistration', { fullName: 'Walk In (Test)', employeeCode: 'EMP400', phoneNumber: '9000000400', officialEmail: null, departmentId: null, designation: '' }), 'already-exists');
  });

  it('blocks deactivated users at the API and in sign-in', async () => {
    await w.call('admin', 'admin.users.setStatus', { userId: w.id('e6'), status: 'DEACTIVATED', reason: 'Left the company' });
    await expectCode(w.call('e6', 'me.get', {}), 'permission-denied');
    const { email } = await w.call(null, 'auth.resolveIdentifier', { identifier: 'EMP206' });
    expect(await w.auth.verify(email, DEMO_PASSWORD)).toEqual({ error: 'auth/user-disabled' });
    const audits = await w.store.query<AuditLogDoc & { id: string }>(COL.auditLogs, { where: [['action', '==', 'USER_DEACTIVATED']] });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.reason).toBe('Left the company');
  });

  it('protects the last Super Admin and managers who still have reportees', async () => {
    await expectCode(w.call('admin', 'admin.users.changeRole', { userId: w.id('admin'), role: 'EMPLOYEE', reason: 'test' }), 'failed-precondition');
    await expectCode(w.call('admin', 'admin.users.changeRole', { userId: w.id('rm1'), role: 'EMPLOYEE', reason: 'test' }), 'failed-precondition');
    await expectCode(w.call('admin', 'admin.users.setManagers', { userId: w.id('rm1'), primaryReportingManagerId: w.id('e1'), secondaryReviewerId: null, reason: 'test' }), 'invalid-argument');
  });
});

describe('Scenario A + B: daily reporting and manager review', () => {
  let w: World;
  beforeEach(async () => (w = await makeWorld()));

  it('runs draft → submit → view → return → correct → resubmit → approve', async () => {
    const draft = await w.call('e1', 'daily.save', { workDate: TODAY, tasks: [task()], employeeNotes: '', submit: false, expectedRevision: null });
    expect(draft.report.submissionStatus).toBe('DRAFT');
    // Drafts are invisible to the manager.
    await expectCode(w.call('rm1', 'daily.get', { reportId: draft.report.id }), 'not-found');

    const three = [task(), task({ title: 'Task two', collaboratorIds: [w.id('e2')] }), task({ title: 'Task three', status: 'COMPLETED', progressPercentage: 100 })];
    const sub = await w.call('e1', 'daily.save', { workDate: TODAY, tasks: three, employeeNotes: 'ok', submit: true, expectedRevision: draft.report.revision });
    expect(sub.report).toMatchObject({ submissionStatus: 'SUBMITTED', reviewStatus: 'PENDING_REVIEW', version: 1, awaitingReview: true });
    expect(sub.report.tasks.map((t) => t.slot)).toEqual([1, 2, 3]);

    const pending = await w.call('rm1', 'review.pending', {});
    expect(pending.daily.map((r) => r.id)).toContain(sub.report.id);
    const notes = await w.store.query<NotificationDoc & { id: string }>(COL.notifications, { where: [['userId', '==', w.id('rm1')], ['type', '==', 'REVIEW_REQUESTED']] });
    expect(notes).toHaveLength(1);

    // Opening does not approve.
    await w.call('rm1', 'review.markViewed', { reportType: 'DAILY', reportId: sub.report.id });
    let detail = await w.call('e1', 'daily.get', { reportId: sub.report.id });
    expect(detail.report.reviewStatus).toBe('VIEWED');

    await expectCode(w.call('rm1', 'review.act', { reportType: 'DAILY', reportId: sub.report.id, action: 'RETURNED', comment: '', reportVersion: 1 }), 'invalid-argument');
    w.clock.now = w.at(TODAY, '11:00');
    await w.call('rm1', 'review.act', { reportType: 'DAILY', reportId: sub.report.id, action: 'RETURNED', comment: 'Add actual times please', reportVersion: 1 });
    detail = await w.call('e1', 'daily.get', { reportId: sub.report.id });
    expect(detail.report.reviewStatus).toBe('RETURNED');
    expect(detail.reviews.map((r) => r.action)).toEqual(['VIEWED', 'RETURNED']);

    const fixed = three.map((t) => ({ ...t, actualStartTime: '09:10', actualEndTime: '10:50' }));
    const resub = await w.call('e1', 'daily.save', { workDate: TODAY, tasks: fixed, employeeNotes: 'fixed', submit: true, expectedRevision: detail.report.revision });
    expect(resub.report.version).toBe(2);

    // A stale approval of version 1 must not approve version 2.
    await expectCode(w.call('rm1', 'review.act', { reportType: 'DAILY', reportId: sub.report.id, action: 'APPROVED', comment: '', reportVersion: 1 }), 'aborted');
    await w.call('rm1', 'review.act', { reportType: 'DAILY', reportId: sub.report.id, action: 'APPROVED', comment: 'Good', reportVersion: 2 });
    await expectCode(w.call('rm1', 'review.act', { reportType: 'DAILY', reportId: sub.report.id, action: 'APPROVED', comment: '', reportVersion: 2 }), 'failed-precondition');

    detail = await w.call('e1', 'daily.get', { reportId: sub.report.id });
    expect(detail.report.reviewStatus).toBe('APPROVED');
    expect(detail.versions.map((v) => v.version)).toEqual([1, 2]);
    // Approved reports are locked for the employee.
    await expectCode(w.call('e1', 'daily.save', { workDate: TODAY, tasks: fixed, employeeNotes: '', submit: false, expectedRevision: detail.report.revision }), 'failed-precondition');
    // The task index mirrors the submitted content.
    expect(await w.store.query(COL.tasks, { where: [['reportId', '==', sub.report.id]] })).toHaveLength(3);
  });

  it('prevents duplicate submissions and stale overwrites', async () => {
    const first = await submitToday(w, 'e1');
    // A second "new" submission and a stale edit are both rejected.
    await expectCode(submitToday(w, 'e1'), 'failed-precondition');
    await expectCode(w.call('e1', 'daily.save', { workDate: TODAY, tasks: threeTasks(), employeeNotes: '', submit: true, expectedRevision: first.report.revision - 1 }), 'failed-precondition');
    const again = await w.call('e1', 'daily.getForDate', { workDate: TODAY });
    expect(again.editable).toBe(false);
  });

  it('rejects invalid tasks, future dates and inactive collaborators', async () => {
    await expectCode(w.call('e1', 'daily.save', { workDate: TODAY, tasks: threeTasks(task({ plannedStartTime: '12:00', plannedEndTime: '10:00' })), employeeNotes: '', submit: true, expectedRevision: null }), 'invalid-argument');
    await expectCode(w.call('e1', 'daily.save', { workDate: '2025-10-26', tasks: [task()], employeeNotes: '', submit: true, expectedRevision: null }), 'invalid-argument');
    await expectCode(w.call('e1', 'daily.save', { workDate: TODAY, tasks: [task(), task(), task(), task()], employeeNotes: '', submit: true, expectedRevision: null }), 'invalid-argument');
    // All 3 priority tasks are required to submit (a draft can be saved with fewer).
    await expectCode(w.call('e1', 'daily.save', { workDate: TODAY, tasks: [task(), task()], employeeNotes: '', submit: true, expectedRevision: null }), 'invalid-argument');
    await expectCode(w.call('e1', 'daily.save', { workDate: TODAY, tasks: [task(), task({ title: '  ' }), task()], employeeNotes: '', submit: true, expectedRevision: null }), 'invalid-argument');
    await w.call('admin', 'admin.users.setStatus', { userId: w.id('e6'), status: 'DEACTIVATED', reason: 'test' });
    await expectCode(w.call('e1', 'daily.save', { workDate: TODAY, tasks: threeTasks(task({ collaboratorIds: [w.id('e6')] })), employeeNotes: '', submit: true, expectedRevision: null }), 'invalid-argument');
    await expectCode(w.call('mgmt', 'daily.save', { workDate: TODAY, tasks: [task()], employeeNotes: '', submit: true, expectedRevision: null }), 'permission-denied');
  });

  it('marks reports submitted after the deadline as late', async () => {
    w.clock.now = w.at('2025-10-26', '09:00');
    const r = await w.call('e1', 'daily.save', { workDate: TODAY, tasks: threeTasks(), employeeNotes: '', submit: true, expectedRevision: null });
    expect(r.report.submittedLate).toBe(true);
  });
});

describe('Scenario H: role security and data isolation', () => {
  let w: World;
  let reportE4: string;
  beforeEach(async () => {
    w = await makeWorld();
    reportE4 = (await submitToday(w, 'e4')).report.id;
  });

  it('stops employees reading or reviewing other employees’ reports', async () => {
    await expectCode(w.call('e1', 'daily.get', { reportId: reportE4 }), 'permission-denied');
    await expectCode(w.call('e1', 'daily.list', { from: TODAY, to: TODAY, employeeId: w.id('e4') }), 'permission-denied');
    await expectCode(w.call('e1', 'review.act', { reportType: 'DAILY', reportId: reportE4, action: 'APPROVED', comment: '', reportVersion: 1 }), 'permission-denied');
    const own = await w.call('e1', 'daily.list', { from: TODAY, to: TODAY });
    expect(own.items.every((r) => r.employeeId === w.id('e1'))).toBe(true);
  });

  it('limits managers to their assigned employees', async () => {
    await expectCode(w.call('rm1', 'daily.get', { reportId: reportE4 }), 'permission-denied');
    await expectCode(w.call('rm1', 'review.act', { reportType: 'DAILY', reportId: reportE4, action: 'APPROVED', comment: '', reportVersion: 1 }), 'permission-denied');
    await expectCode(w.call('rm1', 'employees.profile', { employeeId: w.id('e4'), from: TODAY, to: TODAY }), 'permission-denied');
    const list = await w.call('rm1', 'daily.list', { from: TODAY, to: TODAY });
    expect(list.items.find((r) => r.id === reportE4)).toBeUndefined();
    // Secondary reviewer relationship grants access.
    const e2 = await submitToday(w, 'e2');
    expect((await w.call('rm2', 'daily.get', { reportId: e2.report.id })).canReview).toBe(true);
  });

  it('keeps Management read-only', async () => {
    expect((await w.call('mgmt', 'daily.get', { reportId: reportE4 })).canReview).toBe(false);
    await expectCode(w.call('mgmt', 'review.act', { reportType: 'DAILY', reportId: reportE4, action: 'APPROVED', comment: '', reportVersion: 1 }), 'permission-denied');
    await expectCode(w.call('mgmt', 'admin.users.changeRole', { userId: w.id('e1'), role: 'SUPER_ADMIN', reason: 'promote' }), 'permission-denied');
    await expectCode(w.call('mgmt', 'admin.daily.correct', { reportId: reportE4, reason: 'xyz', expectedVersion: 1 }), 'permission-denied');
    await expectCode(w.call('mgmt', 'admin.calendar.upsertException', { date: '2025-10-29', type: 'HOLIDAY', name: 'X day', description: '', departmentId: null }), 'permission-denied');
  });

  it('denies every admin operation to employees and requires sign-in', async () => {
    for (const name of ['admin.dashboard', 'admin.settings.get', 'admin.departments.list', 'admin.audit.list'] as const) {
      await expectCode(dispatch(await w.ctx('e1'), name, name === 'admin.audit.list' ? { from: TODAY, to: TODAY } : {}), 'permission-denied');
    }
    await expectCode(w.call(null, 'daily.list', { from: TODAY, to: TODAY }), 'unauthenticated');
    await expectCode(w.call(null, 'admin.users.create', {} as never), 'unauthenticated');
  });

  it('applies the same scope to exports', async () => {
    await submitToday(w, 'e1');
    const mine = await w.call('e1', 'export.run', { kind: 'dailyTasks', filters: { from: TODAY, to: TODAY, employeeId: w.id('e4') } });
    expect(mine.rows.every((r) => r['Employee Code'] === 'EMP201')).toBe(true);
    const team = await w.call('rm1', 'export.run', { kind: 'dailyTasks', filters: { from: TODAY, to: TODAY } });
    expect(team.rows.some((r) => r['Employee Code'] === 'EMP204')).toBe(false);
    const all = await w.call('mgmt', 'export.run', { kind: 'dailyTasks', filters: { from: TODAY, to: TODAY } });
    expect(new Set(all.rows.map((r) => r['Employee Code']))).toEqual(new Set(['EMP201', 'EMP204']));
    await expectCode(w.call('e1', 'export.run', { kind: 'employees', filters: {} }), 'permission-denied');
    expect(await w.store.query(COL.auditLogs, { where: [['action', '==', 'REPORT_EXPORTED']] })).toHaveLength(3);
  });
});

describe('Scenario C: weekly report', () => {
  it('compiles daily reports using the calendar and goes through review', async () => {
    const w = await makeWorld();
    // Week of Mon 20 Oct: Wednesday 22 is the weekly holiday → 6 working days.
    for (const [date, at] of [['2025-10-20', '18:00'], ['2025-10-21', '18:00'], ['2025-10-23', '18:00']] as const) {
      w.clock.now = w.at(date, at);
      await w.call('e1', 'daily.save', { workDate: date, tasks: [task(), task({ title: 'Done', status: 'COMPLETED', progressPercentage: 100 }), task({ title: 'Quality check on batch 7' })], employeeNotes: '', submit: true, expectedRevision: null });
    }
    w.clock.now = w.at('2025-10-25', '10:00');
    const preview = await w.call('e1', 'weekly.preview', { periodStart: '2025-10-20' });
    expect(preview.summary.workingDays).toBe(6);
    expect(preview.summary.workingDates).not.toContain('2025-10-22');
    expect(preview.summary.dailyReportsSubmitted).toBe(3);
    expect(preview.summary.tasksPlanned).toBe(9);
    expect(preview.summary.tasksCompleted).toBe(3);
    expect(preview.summary.missingReportDates).toEqual(['2025-10-24']);
    // Last working day of the week is Sunday 26 → cannot submit yet on Saturday.
    expect(preview.canSubmitNow).toBe(false);
    const narrative = { majorAccomplishments: 'Shipped module', projectProgress: '', keyDeliverables: '', blockers: '', decisionsRequired: '', collaborationSummary: '', nextWeekPlan: 'Testing', employeeComments: '' };
    await expectCode(w.call('e1', 'weekly.save', { periodStart: '2025-10-20', narrative, submit: true, expectedRevision: null }), 'failed-precondition');
    w.clock.now = w.at('2025-10-26', '18:00');
    await expectCode(w.call('e1', 'weekly.save', { periodStart: '2025-10-20', narrative: { ...narrative, majorAccomplishments: '' }, submit: true, expectedRevision: null }), 'invalid-argument');
    const saved = await w.call('e1', 'weekly.save', { periodStart: '2025-10-20', narrative, submit: true, expectedRevision: null });
    expect(saved.report.version).toBe(1);
    await expectCode(w.call('e1', 'weekly.save', { periodStart: '2025-10-21', narrative, submit: false, expectedRevision: null }), 'invalid-argument');
    await w.call('rm1', 'review.act', { reportType: 'WEEKLY', reportId: saved.report.id, action: 'APPROVED', comment: 'Fine', reportVersion: 1 });
    expect((await w.call('e1', 'weekly.get', { reportId: saved.report.id })).report.reviewStatus).toBe('APPROVED');
  });
});

describe('Scenario F: holidays and compliance', () => {
  it('does not count the Wednesday holiday as a missed report, but counts a declared working Wednesday', async () => {
    const w = await makeWorld({ now: w0() });
    const c1 = await w.call('mgmt', 'company.compliance', { from: '2025-10-20', to: '2025-10-24', departmentId: null });
    const e1 = c1.employees.find((e) => e.user.id === w.id('e1'))!;
    expect(e1.days!.find((d) => d.date === '2025-10-22')!.status).toBe('HOLIDAY');
    expect(e1.compliance.expected).toBe(4);
    expect(e1.compliance.missing).toBe(4);

    // Super Admin declares next Wednesday (29 Oct) a working day.
    await w.call('admin', 'admin.calendar.upsertException', { date: '2025-10-29', type: 'WORKING_DAY', name: 'Working Wednesday', description: '', departmentId: null });
    const month = await w.call('e1', 'calendar.month', { month: '2025-10', departmentId: null });
    expect(month.days.find((d) => d.date === '2025-10-29')!.isWorkingDay).toBe(true);
    expect(month.days.find((d) => d.date === '2025-10-22')!.isWorkingDay).toBe(false);
    w.clock.now = w.at('2025-10-30', '09:00');
    const c2 = await w.call('mgmt', 'company.compliance', { from: '2025-10-29', to: '2025-10-29', departmentId: null });
    expect(c2.employees.find((e) => e.user.id === w.id('e1'))!.days![0]!.status).toBe('MISSING');
    // Past calendar entries are locked.
    await expectCode(w.call('admin', 'admin.calendar.upsertException', { date: '2025-10-22', type: 'WORKING_DAY', name: 'Backdated', description: '', departmentId: null }), 'failed-precondition');
    await expectCode(w.call('admin', 'admin.calendar.setPolicy', { effectiveFrom: '2025-10-01', workingWeekdays: [1, 2, 3, 4, 5], note: '' }), 'invalid-argument');
  });
});

function w0() {
  // Saturday 25 Oct 2025, 10:00 IST
  return new Date('2025-10-25T04:30:00.000Z');
}

describe('Scenario G: administrator correction', () => {
  it('moves a report to the correct date, keeps the original version and audit trail, and requires re-review', async () => {
    const w = await makeWorld();
    w.clock.now = w.at('2025-10-24', '18:00');
    const sub = await w.call('e1', 'daily.save', { workDate: '2025-10-24', tasks: threeTasks(), employeeNotes: '', submit: true, expectedRevision: null });
    await w.call('rm1', 'review.act', { reportType: 'DAILY', reportId: sub.report.id, action: 'APPROVED', comment: '', reportVersion: 1 });
    w.clock.now = w.at('2025-10-25', '10:00');
    await expectCode(w.call('e1', 'admin.daily.correct', { reportId: sub.report.id, workDate: '2025-10-23', reason: 'Wrong date', expectedVersion: 1 }), 'permission-denied');
    await expectCode(w.call('admin', 'admin.daily.correct', { reportId: sub.report.id, workDate: '2025-10-23', reason: '', expectedVersion: 1 }), 'invalid-argument');
    const fixed = await w.call('admin', 'admin.daily.correct', { reportId: sub.report.id, workDate: '2025-10-23', reason: 'Employee entered the wrong date', expectedVersion: 1 });
    expect(fixed.report).toMatchObject({ workDate: '2025-10-23', version: 2, reviewStatus: 'PENDING_REVIEW', needsReReview: true });
    const v1 = await w.store.get<ReportVersionDoc & { id: string }>(COL.reportVersions, `DAILY_${sub.report.id}_v1`);
    const v2 = await w.store.get<ReportVersionDoc & { id: string }>(COL.reportVersions, `DAILY_${sub.report.id}_v2`);
    expect(v1!.snapshot.workDate).toBe('2025-10-24');
    expect(v1!.source).toBe('EMPLOYEE_SUBMISSION');
    expect(v2!.source).toBe('ADMIN_CORRECTION');
    expect(v2!.reason).toBe('Employee entered the wrong date');
    const audits = await w.store.query<AuditLogDoc & { id: string }>(COL.auditLogs, { where: [['action', '==', 'DAILY_REPORT_ADMIN_CORRECTED']] });
    expect(audits[0]!.beforeSnapshot!.workDate).toBe('2025-10-24');
    expect(audits[0]!.afterSnapshot!.workDate).toBe('2025-10-23');
    // The old date is free again, the new date is taken.
    w.clock.now = w.at('2025-10-24', '19:00');
    await w.call('e1', 'daily.save', { workDate: '2025-10-24', tasks: [task()], employeeNotes: '', submit: false, expectedRevision: null });
    await expectCode(w.call('admin', 'admin.daily.correct', { reportId: sub.report.id, workDate: '2025-10-24', reason: 'Move back', expectedVersion: 2 }), 'failed-precondition');
  });
});

describe('Scenarios D, E and I: management analytics on generated history', () => {
  let w: World;
  beforeEach(async () => (w = await makeWorld({ withHistory: true })), 60_000);

  it('searches employees by name, code, department and project', async () => {
    expect((await w.call('mgmt', 'search.global', { query: 'rohan' })).employees[0]!.employeeCode).toBe('EMP201');
    expect((await w.call('mgmt', 'search.global', { query: 'EMP204' })).employees[0]!.fullName).toContain('Pooja');
    const dept = await w.call('mgmt', 'search.global', { query: 'R&D' });
    expect(dept.departments.map((d) => d.name)).toContain('R&D (Engineering)');
    expect(dept.employees.map((e) => e.employeeCode)).toEqual(expect.arrayContaining(['EMP201', 'EMP202']));
    expect((await w.call('mgmt', 'search.global', { query: 'SAP Integration' })).projects).toHaveLength(1);
    await expectCode(w.call('e1', 'search.global', { query: 'rohan' }), 'permission-denied');
    // Managers search only within their team.
    expect((await w.call('rm1', 'search.global', { query: 'pooja' })).employees).toHaveLength(0);
  });

  it('opens an employee profile with history and projects', async () => {
    const p = await w.call('mgmt', 'employees.profile', { employeeId: w.id('e1'), from: '2025-10-06', to: '2025-10-25' });
    expect(p.primaryManager).toContain('Arjun');
    expect(p.stats.tasks.planned).toBeGreaterThan(0);
    expect(p.projects.length).toBeGreaterThan(0);
    expect(p.stats.compliance.rate).not.toBeNull();
  });

  it('filters company analytics by department', async () => {
    const all = await w.call('mgmt', 'company.overview', { from: '2025-10-06', to: '2025-10-25', departmentId: null });
    const rnd = await w.call('mgmt', 'company.overview', { from: '2025-10-06', to: '2025-10-25', departmentId: 'dept_rnd' });
    expect(rnd.employees.every((e) => e.user.departmentId === 'dept_rnd')).toBe(true);
    expect(rnd.employees.length).toBeLessThan(all.employees.length);
    // R&D: two employees plus their Reporting Manager, who also reports.
    expect(all.departments.find((d) => d.name === 'R&D (Engineering)')!.employees).toBe(3);
    await expectCode(w.call('rm1', 'company.overview', { from: '2025-10-06', to: '2025-10-25', departmentId: null }), 'permission-denied');
  });

  it('tracks a recurring project without confusing mentions with completion', async () => {
    const list = await w.call('mgmt', 'projects.analytics', {});
    const erp = list.projects.find((p) => p.project.code === 'ERP')!;
    expect(erp.history.tasks).toBeGreaterThanOrEqual(erp.history.activeDays);
    expect(erp.history.elapsedCalendarDays).toBeGreaterThanOrEqual(erp.history.activeDays);
    const detail = await w.call('mgmt', 'projects.detail', { projectId: erp.project.id });
    const rohan = detail.byEmployee.find((e) => e.employee?.employeeCode === 'EMP201')!;
    expect(rohan.history.firstActivity! <= rohan.history.latestActivity!).toBe(true);
    expect(detail.overall.employees).toBeGreaterThan(1);
  });

  it('produces a manager dashboard for the assigned team only', async () => {
    const d = await w.call('rm1', 'manager.dashboard', { date: null });
    expect(d.kpis.assignedEmployees).toBe(3);
    expect(d.rows.map((r) => r.user.employeeCode).sort()).toEqual(['EMP201', 'EMP202', 'EMP203']);
    expect(d.rows.find((r) => r.user.employeeCode === 'EMP201')!.todayStatus).toBe('DRAFT');
    await expectCode(w.call('e1', 'manager.dashboard', { date: null }), 'permission-denied');
  });
});

describe('notifications and reminders', () => {
  it('sends deadline reminders once per employee per reminder time', async () => {
    const w = await makeWorld();
    await submitToday(w, 'e1');
    w.clock.now = w.at(TODAY, '18:35');
    const first = await w.call('admin', 'admin.runReminders', { force: false });
    expect(first.ran).toBe(true);
    // 2 managers + 6 employees report; e1 already submitted.
    expect(first.deadlineReminders).toBe(7);
    const second = await w.call('admin', 'admin.runReminders', { force: false });
    expect(second.deadlineReminders).toBe(0);
    const list = await w.call('e2', 'notifications.list', { unreadOnly: true });
    expect(list.items.some((n) => n.type === 'DEADLINE_UPCOMING')).toBe(true);
    await w.call('e2', 'notifications.markRead', { ids: null });
    expect((await w.call('e2', 'notifications.list', { unreadOnly: true })).unreadCount).toBe(0);
  });

  it('reminds me four times a day to complete my 3 priority tasks until the report is submitted', async () => {
    const w = await makeWorld();
    w.clock.now = w.at(TODAY, '09:00');
    const early = await w.call('e1', 'me.checkReminders', {});
    expect(early).toEqual({ notification: null, nextCheckAt: w.at(TODAY, '10:00').toISOString() });
    w.clock.now = w.at(TODAY, '10:05');
    const first = await w.call('e1', 'me.checkReminders', {});
    expect(first.notification).toMatchObject({ title: 'Complete your 3 priority tasks', body: expect.stringMatching(/^0 of 3 filled/), link: '/daily/today' });
    expect(first.nextCheckAt).toBe(w.at(TODAY, '13:00').toISOString());
    // The same reminder time never fires twice, even if the scheduled job also runs.
    expect((await w.call('e1', 'me.checkReminders', {})).notification).toBeNull();
    expect((await w.call('admin', 'admin.runReminders', { force: false })).deadlineReminders).toBe(7);
    // Next reminder time: a new reminder that reflects progress.
    const draft = await w.call('e1', 'daily.save', { workDate: TODAY, tasks: [task()], employeeNotes: '', submit: false, expectedRevision: null });
    w.clock.now = w.at(TODAY, '13:02');
    expect((await w.call('e1', 'me.checkReminders', {})).notification?.body).toMatch(/^1 of 3 filled/);
    // Submitted: no more reminders today.
    await w.call('e1', 'daily.save', { workDate: TODAY, tasks: threeTasks(), employeeNotes: '', submit: true, expectedRevision: draft.report.revision });
    w.clock.now = w.at(TODAY, '16:01');
    expect(await w.call('e1', 'me.checkReminders', {})).toEqual({ notification: null, nextCheckAt: null });
    const reminders = (await w.call('e1', 'notifications.list', { unreadOnly: false, limit: 50 })).items.filter((n) => n.type === 'DEADLINE_UPCOMING');
    expect(reminders).toHaveLength(2);
    // Management does not report, so is never reminded.
    expect((await w.call('mgmt', 'me.checkReminders', {})).notification).toBeNull();
  });

  it('does not remind on a holiday', async () => {
    const w = await makeWorld({ now: new Date('2025-10-22T12:30:00.000Z') }); // Wednesday 18:00 IST
    const r = await w.call('admin', 'admin.runReminders', { force: true });
    expect(r.deadlineReminders).toBe(0);
    expect((await w.call('e1', 'me.checkReminders', {})).notification).toBeNull();
  });
});

describe('employee project requests', () => {
  it('creates a proposed project with dates, lead and reviewer, and notifies them', async () => {
    const w = await makeWorld();
    const r = await w.call('e1', 'projects.request', {
      name: 'Shop-floor tablet rollout', description: 'Tablets for production reporting', departmentId: null,
      startDate: '2025-10-27', targetEndDate: '2025-12-15', ownerId: w.id('e2'), reviewerId: w.id('rm1'),
    });
    expect(r.project.status).toBe('PROPOSED');
    const mine = await w.call('e1', 'projects.mine', {});
    const p = mine.items.find((x) => x.id === r.project.id)!;
    expect(p).toMatchObject({ startDate: '2025-10-27', targetEndDate: '2025-12-15', myRole: 'Requested' });
    expect(p.ownerName).toContain('Sneha');
    expect(p.reviewerName).toContain('Arjun');
    expect((await w.call('e2', 'projects.mine', {})).items.find((x) => x.id === r.project.id)?.myRole).toBe('Lead');
    const notes = await w.store.query<NotificationDoc & { id: string }>(COL.notifications, { where: [['type', '==', 'PROJECT_ASSIGNED']] });
    expect(notes.filter((n) => n.body.includes('Shop-floor')).map((n) => n.userId).sort()).toEqual([w.id('e2'), w.id('rm1')].sort());
  });

  it('rejects an employee as reviewer, a reviewer equal to the lead, and end before start', async () => {
    const w = await makeWorld();
    const base = { name: 'Bad project', description: 'Some description', departmentId: null, startDate: null, targetEndDate: null, ownerId: null };
    await expectCode(w.call('e1', 'projects.request', { ...base, reviewerId: w.id('e3') }), 'invalid-argument');
    await expectCode(w.call('e1', 'projects.request', { ...base, ownerId: w.id('rm1'), reviewerId: w.id('rm1') }), 'invalid-argument');
    await expectCode(w.call('e1', 'projects.request', { ...base, reviewerId: null, startDate: '2025-11-10', targetEndDate: '2025-11-01' }), 'invalid-argument');
  });
});

describe('daily routine (personal tasks besides the 3 priorities)', () => {
  it('saves today, carries repeating items to the next day unticked, and stays private', async () => {
    const w = await makeWorld();
    const empty = await w.call('e1', 'routine.get', { date: null });
    expect(empty).toMatchObject({ items: [], editable: true });
    await w.call('e1', 'routine.save', {
      items: [
        { id: 'a', text: 'Check emails', time: '09:00', done: true, repeat: true },
        { id: 'b', text: 'Call vendor about castings', time: null, done: false, repeat: false },
      ],
    });
    expect((await w.call('e1', 'routine.get', { date: null })).items).toHaveLength(2);
    // Another user never sees it.
    expect((await w.call('e2', 'routine.get', { date: null })).items).toHaveLength(0);
    // Next day: only the repeating item comes back, unticked.
    w.clock.now = w.at('2025-10-26', '09:00');
    const next = await w.call('e1', 'routine.get', { date: null });
    expect(next.carriedOver).toBe(true);
    expect(next.items).toEqual([{ id: 'a', text: 'Check emails', time: '09:00', done: false, repeat: true }]);
    // Past days are read-only.
    expect((await w.call('e1', 'routine.get', { date: '2025-10-25' })).editable).toBe(false);
    await expectCode(w.call('e1', 'routine.save', { items: [{ id: 'x', text: '', time: null, done: false, repeat: false }] }), 'invalid-argument');
  });
});

describe('collaborator notifications', () => {
  it('notifies a person once when added to a task, and only the newly added people later', async () => {
    const w = await makeWorld();
    const mine = (key: string) => w.call(key, 'notifications.list', { unreadOnly: false, limit: 50 }).then((r) => r.items.filter((n) => n.type === 'COLLABORATOR_ADDED'));
    const first = await w.call('e1', 'daily.save', { workDate: TODAY, tasks: [task({ title: 'Fixture trial', collaboratorIds: [w.id('e2')] })], employeeNotes: '', submit: false, expectedRevision: null });
    expect((await mine('e2')).map((n) => n.body)).toEqual([`Rohan Patil (Test) added you to “Fixture trial” on ${TODAY}.`]);
    // Saving again with the same people does not notify again; adding someone notifies only them.
    await w.call('e1', 'daily.save', { workDate: TODAY, tasks: [task({ title: 'Fixture trial', collaboratorIds: [w.id('e2'), w.id('e3')] })], employeeNotes: '', submit: false, expectedRevision: first.report.revision });
    expect(await mine('e2')).toHaveLength(1);
    expect(await mine('e3')).toHaveLength(1);
    expect(await mine('e1')).toHaveLength(0);
  });
});

describe('Outlook-style calendar', () => {
  it('shows my tasks and My day items, shows a manager only submitted work, and keeps others out', async () => {
    const w = await makeWorld();
    const draft = await w.call('e1', 'daily.save', { workDate: TODAY, tasks: [task({ title: 'Fixture trial', plannedStartTime: '09:00', plannedEndTime: '11:00' })], employeeNotes: '', submit: false, expectedRevision: null });
    await w.call('e1', 'routine.save', { items: [{ id: 'r1', text: 'Shop-floor round', time: '08:30', done: false, repeat: false }] });
    const mine = await w.call('e1', 'calendar.events', { from: '2025-10-20', to: '2025-10-26', employeeId: null });
    expect(mine.isSelf).toBe(true);
    expect(mine.days).toHaveLength(7);
    expect(mine.tasks.filter((t) => t.workDate === TODAY).map((t) => [t.title, t.plannedStartTime])).toEqual([['Fixture trial', '09:00']]);
    expect(mine.routine).toEqual([{ date: TODAY, id: 'r1', text: 'Shop-floor round', time: '08:30', done: false }]);
    // The manager sees the draft only once it is submitted, and never the My day list.
    const before = await w.call('rm1', 'calendar.events', { from: TODAY, to: TODAY, employeeId: w.id('e1') });
    expect(before.tasks).toHaveLength(0);
    expect(before.routine).toHaveLength(0);
    await w.call('e1', 'daily.save', { workDate: TODAY, tasks: threeTasks(task({ title: 'Fixture trial' })), employeeNotes: '', submit: true, expectedRevision: draft.report.revision });
    const after = await w.call('rm1', 'calendar.events', { from: TODAY, to: TODAY, employeeId: w.id('e1') });
    expect(after.tasks.length).toBeGreaterThan(0);
    expect(after.routine).toHaveLength(0);
    // Outside the viewer's scope, and over-long ranges, are refused.
    await expectCode(w.call('e2', 'calendar.events', { from: TODAY, to: TODAY, employeeId: w.id('e1') }), 'permission-denied');
    await expectCode(w.call('rm2', 'calendar.events', { from: TODAY, to: TODAY, employeeId: w.id('e1') }), 'permission-denied');
    await expectCode(w.call('e1', 'calendar.events', { from: '2025-09-01', to: '2025-10-26', employeeId: null }), 'invalid-argument');
  });
});

describe('permanent employee deletion', () => {
  it('deletes the employee and their data only after deactivation and a typed confirmation; audit is kept', async () => {
    const w = await makeWorld({ withHistory: true });
    const uid = w.id('e3');
    const reportsBefore = await w.store.query(COL.dailyReports, { where: [['employeeId', '==', uid]] });
    expect(reportsBefore.length).toBeGreaterThan(0);
    // Refused while active, with the wrong code, for non-admins, and for yourself.
    await expectCode(w.call('admin', 'admin.users.delete', { userId: uid, confirmCode: 'EMP203', reason: 'Left company' }), 'failed-precondition');
    await w.call('admin', 'admin.users.setStatus', { userId: uid, status: 'DEACTIVATED', reason: 'Left company' });
    await expectCode(w.call('admin', 'admin.users.delete', { userId: uid, confirmCode: 'EMP999', reason: 'Left company' }), 'invalid-argument');
    await expectCode(w.call('mgmt', 'admin.users.delete', { userId: uid, confirmCode: 'EMP203', reason: 'Left company' }), 'permission-denied');
    await expectCode(w.call('admin', 'admin.users.delete', { userId: w.id('admin'), confirmCode: 'SA001', reason: 'x y z' }), 'failed-precondition');

    const res = await w.call('admin', 'admin.users.delete', { userId: uid, confirmCode: 'emp203', reason: 'Left company' });
    expect(res.dailyReports).toBe(reportsBefore.length);
    expect(await w.store.get(COL.users, uid)).toBeNull();
    for (const col of [COL.dailyReports, COL.tasks, COL.weeklyReports, COL.reportVersions, COL.reportReviews]) {
      expect(await w.store.query(col, { where: [['employeeId', '==', uid]] })).toHaveLength(0);
    }
    expect(await w.store.query(COL.notifications, { where: [['userId', '==', uid]] })).toHaveLength(0);
    const projects = await w.store.query<{ id: string; participantIds: string[] }>(COL.projects, {});
    expect(projects.some((p) => p.participantIds.includes(uid))).toBe(false);
    // Audit trail stays, including the deletion itself.
    const audits = await w.store.query<AuditLogDoc & { id: string }>(COL.auditLogs, { where: [['entityId', '==', uid]] });
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['USER_CREATED', 'USER_DEACTIVATED', 'USER_PERMANENTLY_DELETED']));
    // Sign-in identity is gone and the employee code / mobile can be reused.
    const { email } = await w.call(null, 'auth.resolveIdentifier', { identifier: 'EMP203' });
    expect(await w.auth.verify(email, 'Test@1234')).toEqual({ error: 'auth/invalid-credential' });
    await w.call('admin', 'admin.users.create', { fullName: 'Rejoined (Test)', employeeCode: 'EMP203', phoneNumber: '9000000203', officialEmail: null, departmentId: 'dept_it', designation: 'SAP Consultant', role: 'EMPLOYEE', primaryReportingManagerId: w.id('rm1'), secondaryReviewerId: null, joinedAt: null, initialPassword: 'Welcome123' });
  }, 60_000);

  it('refuses to delete a manager who still has reportees', async () => {
    const w = await makeWorld();
    await expectCode(w.call('admin', 'admin.users.setStatus', { userId: w.id('rm1'), status: 'DEACTIVATED', reason: 'test' }), 'failed-precondition');
  });
});
