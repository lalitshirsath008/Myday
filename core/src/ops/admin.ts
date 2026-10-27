import { z } from 'zod';
import { resolveWorkingDay } from '../calendar';
import { todayIn } from '../dates';
import { AppError, conflict, invalid, notFound, precondition } from '../errors';
import { REVIEWER_ROLES } from '../permissions';
import {
  dateStr,
  employeeFields,
  narrativeInput,
  password,
  projectInput,
  reasonRequired,
  taskInput,
  userUpdateInput,
} from '../schemas';
import { maxTasksPerReport, withSettingsDefaults } from '../settings';
import { StoreError } from '../store';
import {
  ACCOUNT_STATUSES,
  COL,
  NOTIFICATION_TYPES,
  ROLES,
  type AuditLogDoc,
  type CollectionName,
  type DailyReportDoc,
  type DepartmentDoc,
  type ProjectDoc,
  type RegistrationRequestDoc,
  type SystemSettings,
  type UserDoc,
  type WeeklyReportDoc,
} from '../types';
import { codeKey, phoneKey, syntheticEmail } from './auth';
import { nowIso, op, requirePermission, type AuthedCtx } from './context';
import { dailyKey, syncTaskIndex, taskIssues, validateReferences } from './daily';
import {
  allDepartments,
  assignedEmployees,
  audit,
  getExceptions,
  getSettings,
  getUser,
  normalizeName,
  notify,
  searchTokens,
  SETTINGS_ID,
  userProfile,
} from './helpers';
import { notifyProjectPeople, validateProjectPeople } from './misc';
import { writeVersion } from './reportCommon';
import { computeWeeklySummary } from './weekly';

const emailKey = (email: string) => `email_${email.toLowerCase()}`;

/** Initial password chosen by the admin when creating an account. */
const initialCreds = { initialPassword: password, requirePasswordChange: z.boolean().default(true) };

async function validateManagers(ctx: AuthedCtx, userId: string | null, primaryId: string | null, secondaryId: string | null): Promise<void> {
  if (primaryId && primaryId === secondaryId) throw invalid('Primary manager and secondary reviewer must be different people.');
  for (const id of [primaryId, secondaryId]) {
    if (!id) continue;
    if (id === userId) throw invalid('An employee cannot be their own reviewer.');
    const m = await ctx.store.get<UserDoc & { id: string }>(COL.users, id);
    if (!m || m.accountStatus !== 'ACTIVE') throw invalid('The selected reviewer is not an active user.');
    if (!REVIEWER_ROLES.includes(m.role)) throw invalid(`${m.fullName} does not have the Reporting Manager role.`);
  }
  // Prevent circular reporting lines (A → B → … → A).
  let cur = primaryId;
  const seen = new Set<string>();
  while (cur && userId) {
    if (cur === userId) throw invalid('This assignment would create a circular reporting line.');
    if (seen.has(cur)) break;
    seen.add(cur);
    cur = (await ctx.store.get<UserDoc & { id: string }>(COL.users, cur))?.primaryReportingManagerId ?? null;
  }
}

async function validateDepartment(ctx: AuthedCtx, departmentId: string): Promise<void> {
  const d = await ctx.store.get<DepartmentDoc & { id: string }>(COL.departments, departmentId);
  if (!d || !d.active) throw invalid('Select an active department.');
}

function mapStoreError(e: unknown): never {
  if (e instanceof StoreError && e.code === 'ALREADY_EXISTS') {
    throw new AppError('already-exists', 'Employee code, mobile number or email is already registered to another account.');
  }
  throw e;
}

type EmployeeInput = z.output<typeof employeeFields>;

/**
 * Create a user (sign-in identity + profile) that is ACTIVE straight away with the password the admin chose.
 * The password is never stored in Firestore or the audit log.
 */
export async function createEmployee(ctx: AuthedCtx, input: EmployeeInput, registrationRequestId: string | null, creds: { password: string; requireChange: boolean }) {
  await validateDepartment(ctx, input.departmentId);
  await validateManagers(ctx, null, input.primaryReportingManagerId, input.secondaryReviewerId);
  const uid = globalThis.crypto.randomUUID().replace(/-/g, '');
  const now = nowIso(ctx);
  const authEmail = input.officialEmail ?? syntheticEmail(input.employeeCode);
  const user: UserDoc = {
    id: uid,
    employeeCode: input.employeeCode,
    fullName: input.fullName,
    normalizedName: normalizeName(input.fullName),
    searchTokens: searchTokens({ ...input, phoneNumber: input.phoneNumber }),
    phoneNumber: input.phoneNumber,
    officialEmail: input.officialEmail,
    authEmail,
    departmentId: input.departmentId,
    designation: input.designation,
    role: input.role,
    primaryReportingManagerId: input.primaryReportingManagerId,
    secondaryReviewerId: input.secondaryReviewerId,
    accountStatus: 'ACTIVE',
    mustChangePassword: creds.requireChange,
    joinedAt: input.joinedAt,
    activatedAt: now,
    deactivatedAt: null,
    alternatePhone: '',
    location: '',
    createdAt: now,
    updatedAt: now,
    createdBy: ctx.actor.id,
  };
  const keys = [codeKey(input.employeeCode), phoneKey(input.phoneNumber), emailKey(authEmail)];
  await ctx.store
    .transaction(async (tx) => {
      const req = registrationRequestId ? await tx.get<RegistrationRequestDoc & { id: string }>(COL.registrationRequests, registrationRequestId) : null;
      if (registrationRequestId && (!req || req.status !== 'PENDING')) throw precondition('This registration request was already decided.');
      for (const k of keys) tx.create(COL.uniqueKeys, k, { id: k, ownerId: uid, createdAt: now });
      tx.create(COL.users, uid, user as unknown as UserDoc & { id: string });
      if (req) tx.update(COL.registrationRequests, req.id, { status: 'APPROVED', decidedBy: ctx.actor.id, decidedAt: now, createdUserId: uid });
      audit(tx, ctx, { action: 'USER_CREATED', entityType: 'user', entityId: uid, afterSnapshot: userProfile(user) as unknown as Record<string, unknown> });
    })
    .catch(mapStoreError);
  try {
    await ctx.auth.createUser({ uid, email: authEmail, disabled: false, password: creds.password });
  } catch (e) {
    // Compensate so the employee code and phone can be reused after a provider failure.
    await ctx.store.transaction(async (tx) => {
      for (const k of keys) tx.delete(COL.uniqueKeys, k);
      tx.delete(COL.users, uid);
      if (registrationRequestId) tx.update(COL.registrationRequests, registrationRequestId, { status: 'PENDING', decidedBy: null, decidedAt: null, createdUserId: null });
    });
    throw new AppError('internal', `Could not create the sign-in account: ${(e as Error).message}`);
  }
  return { userId: uid, employeeCode: user.employeeCode, mustChangePassword: creds.requireChange };
}

async function lastSuperAdminGuard(ctx: AuthedCtx, target: UserDoc, losingAdmin: boolean): Promise<void> {
  if (!losingAdmin || target.role !== 'SUPER_ADMIN') return;
  const admins = await ctx.store.query<UserDoc & { id: string }>(COL.users, { where: [['role', '==', 'SUPER_ADMIN'], ['accountStatus', '==', 'ACTIVE']] });
  if (admins.filter((a) => a.id !== target.id).length === 0) throw precondition('At least one active Super Admin must remain.');
}

const settingsUpdateInput = z
  .object({
    companyName: z.string().trim().min(2).max(120),
    timezone: z.string().refine((tz) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, 'Unknown timezone'),
    weekStartDay: z.number().int().min(0).max(6),
    dailyDeadlineDayOffset: z.number().int().min(0).max(3),
    dailyDeadlineTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    dailyGraceMinutes: z.number().int().min(0).max(24 * 60),
    weeklyDeadlineDayOffset: z.number().int().min(0).max(7),
    weeklyDeadlineTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    reminderTimes: z
      .array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/))
      .min(1)
      .max(6)
      .transform((t) => [...new Set(t)].sort()),
    primaryTaskSlots: z.number().int().min(1).max(5),
    minTasksForSubmission: z.number().int().min(1).max(5),
    allowAdditionalTasks: z.boolean(),
    maxAdditionalTasks: z.number().int().min(0).max(5),
    allowOvernightTasks: z.boolean(),
    maxBackdateDays: z.number().int().min(0).max(60),
    reReviewOnAdminCorrection: z.boolean(),
    allowSelfRegistration: z.boolean(),
    allowProjectRequests: z.boolean(),
    reportingRoles: z.array(z.enum(ROLES)).min(1),
    taskCategories: z.array(z.string().trim().min(1).max(60)).min(1).max(50),
    notificationTypesEnabled: z.record(z.enum(NOTIFICATION_TYPES), z.boolean()),
  })
  .partial()
  .refine((s) => s.minTasksForSubmission === undefined || s.primaryTaskSlots === undefined || s.minTasksForSubmission <= s.primaryTaskSlots, {
    message: 'Minimum tasks cannot exceed the number of primary task slots',
  });

const userIdInput = z.object({ userId: z.string().min(1) });

export const adminOps = {
  'admin.dashboard': op({
    input: z.object({}).default({}),
    run: async (ctx) => {
      requirePermission(ctx, 'admin.users');
      const settings = await getSettings(ctx);
      const today = todayIn(settings.timezone, ctx.now());
      const [users, requests, todayReports, pendingDaily, pendingWeekly, recentAudit, departments, projects] = await Promise.all([
        ctx.store.query<UserDoc & { id: string }>(COL.users, { limit: 5000 }),
        ctx.store.query<RegistrationRequestDoc & { id: string }>(COL.registrationRequests, { where: [['status', '==', 'PENDING']], limit: 100 }),
        ctx.store.query<DailyReportDoc & { id: string }>(COL.dailyReports, { where: [['workDate', '==', today]] }),
        ctx.store.query<DailyReportDoc & { id: string }>(COL.dailyReports, { where: [['awaitingReview', '==', true]], limit: 5000 }),
        ctx.store.query<WeeklyReportDoc & { id: string }>(COL.weeklyReports, { where: [['awaitingReview', '==', true]], limit: 5000 }),
        ctx.store.query<AuditLogDoc & { id: string }>(COL.auditLogs, { orderBy: [['timestamp', 'desc']], limit: 10 }),
        allDepartments(ctx),
        ctx.store.query<ProjectDoc & { id: string }>(COL.projects, { limit: 1000 }),
      ]);
      const exceptions = await getExceptions(ctx, today, today);
      const byStatus = Object.fromEntries(ACCOUNT_STATUSES.map((s) => [s, users.filter((u) => u.accountStatus === s).length]));
      const byRole = Object.fromEntries(ROLES.map((r) => [r, users.filter((u) => u.role === r && u.accountStatus === 'ACTIVE').length]));
      const reporters = users.filter((u) => u.accountStatus === 'ACTIVE' && settings.reportingRoles.includes(u.role));
      return {
        today,
        todayWorkingDay: resolveWorkingDay(today, settings.calendarPolicies, exceptions, null),
        usersByStatus: byStatus,
        usersByRole: byRole,
        withoutManager: reporters.filter((u) => !u.primaryReportingManagerId).length,
        pendingRegistrations: requests.length,
        reportsToday: todayReports.filter((r) => r.version > 0).length,
        reportersActive: reporters.length,
        pendingReviews: pendingDaily.length + pendingWeekly.length,
        needsReReview: pendingDaily.filter((r) => r.needsReReview).length + pendingWeekly.filter((r) => r.needsReReview).length,
        departments: departments.length,
        activeProjects: projects.filter((p) => p.status === 'ACTIVE').length,
        proposedProjects: projects.filter((p) => p.status === 'PROPOSED').length,
        recentAudit,
      };
    },
  }),

  'admin.users.create': op({
    input: employeeFields.extend(initialCreds),
    run: async (ctx, { initialPassword, requirePasswordChange, ...input }) => {
      requirePermission(ctx, 'admin.users');
      return createEmployee(ctx, input, null, { password: initialPassword, requireChange: requirePasswordChange });
    },
  }),

  'admin.users.get': op({
    input: userIdInput,
    run: async (ctx, { userId }) => {
      requirePermission(ctx, 'admin.users');
      const u = await getUser(ctx, userId);
      const reportees = await assignedEmployees(ctx, userId);
      return { user: userProfile(u), authEmail: u.authEmail, reporteeCount: reportees.length };
    },
  }),

  'admin.users.update': op({
    input: userUpdateInput,
    run: async (ctx, input) => {
      requirePermission(ctx, 'admin.users');
      const before = await getUser(ctx, input.userId);
      if (input.departmentId && input.departmentId !== before.departmentId) await validateDepartment(ctx, input.departmentId);
      const { userId, reason, ...changes } = input;
      const next: UserDoc = { ...before, ...Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)) } as UserDoc;
      next.normalizedName = normalizeName(next.fullName);
      next.searchTokens = searchTokens(next);
      next.authEmail = next.officialEmail ?? syntheticEmail(next.employeeCode);
      next.updatedAt = nowIso(ctx);
      const keyChanges: [string, string][] = [];
      if (next.employeeCode !== before.employeeCode) keyChanges.push([codeKey(before.employeeCode), codeKey(next.employeeCode)]);
      if (next.phoneNumber !== before.phoneNumber) keyChanges.push([phoneKey(before.phoneNumber), phoneKey(next.phoneNumber)]);
      if (next.authEmail !== before.authEmail) keyChanges.push([emailKey(before.authEmail), emailKey(next.authEmail)]);
      await ctx.store
        .transaction(async (tx) => {
          const fresh = await tx.get<UserDoc & { id: string }>(COL.users, userId);
          if (!fresh || fresh.updatedAt !== before.updatedAt) throw conflict();
          for (const [oldK, newK] of keyChanges) {
            tx.delete(COL.uniqueKeys, oldK);
            tx.create(COL.uniqueKeys, newK, { id: newK, ownerId: userId, createdAt: nowIso(ctx) });
          }
          tx.set(COL.users, userId, next as unknown as UserDoc & { id: string });
          const changed = Object.keys(changes).filter((k) => JSON.stringify((before as unknown as Record<string, unknown>)[k]) !== JSON.stringify((next as unknown as Record<string, unknown>)[k]));
          audit(tx, ctx, {
            action: changed.includes('departmentId') ? 'USER_DEPARTMENT_CHANGED' : 'USER_UPDATED',
            entityType: 'user',
            entityId: userId,
            reason,
            beforeSnapshot: Object.fromEntries(changed.map((k) => [k, (before as unknown as Record<string, unknown>)[k]])),
            afterSnapshot: Object.fromEntries(changed.map((k) => [k, (next as unknown as Record<string, unknown>)[k]])),
          });
        })
        .catch(mapStoreError);
      if (next.authEmail !== before.authEmail) await ctx.auth.updateEmail(userId, next.authEmail);
      return { user: userProfile(next) };
    },
  }),

  'admin.users.changeRole': op({
    input: z.object({ userId: z.string().min(1), role: z.enum(ROLES), reason: reasonRequired }),
    run: async (ctx, { userId, role, reason }) => {
      requirePermission(ctx, 'admin.users');
      const u = await getUser(ctx, userId);
      if (u.role === role) return { ok: true as const };
      if (userId === ctx.actor.id) throw precondition('You cannot change your own role. Ask another Super Admin.');
      await lastSuperAdminGuard(ctx, u, role !== 'SUPER_ADMIN');
      if (u.role === 'REPORTING_MANAGER' && !REVIEWER_ROLES.includes(role)) {
        const reportees = await assignedEmployees(ctx, userId);
        if (reportees.length) throw precondition(`${reportees.length} employee(s) report to ${u.fullName}. Reassign them before changing this role.`);
      }
      await ctx.store.transaction(async (tx) => {
        tx.update(COL.users, userId, { role, updatedAt: nowIso(ctx) });
        audit(tx, ctx, { action: 'USER_ROLE_CHANGED', entityType: 'user', entityId: userId, reason, beforeSnapshot: { role: u.role }, afterSnapshot: { role } });
      });
      return { ok: true as const };
    },
  }),

  'admin.users.setManagers': op({
    input: z.object({
      userId: z.string().min(1),
      primaryReportingManagerId: z.string().nullable(),
      secondaryReviewerId: z.string().nullable(),
      reason: reasonRequired,
    }),
    run: async (ctx, input) => {
      requirePermission(ctx, 'admin.users');
      const u = await getUser(ctx, input.userId);
      await validateManagers(ctx, u.id, input.primaryReportingManagerId, input.secondaryReviewerId);
      const settings = await getSettings(ctx);
      await ctx.store.transaction(async (tx) => {
        tx.update(COL.users, u.id, { primaryReportingManagerId: input.primaryReportingManagerId, secondaryReviewerId: input.secondaryReviewerId, updatedAt: nowIso(ctx) });
        audit(tx, ctx, {
          action: 'REPORTING_MANAGER_CHANGED',
          entityType: 'user',
          entityId: u.id,
          reason: input.reason,
          beforeSnapshot: { primaryReportingManagerId: u.primaryReportingManagerId, secondaryReviewerId: u.secondaryReviewerId },
          afterSnapshot: { primaryReportingManagerId: input.primaryReportingManagerId, secondaryReviewerId: input.secondaryReviewerId },
        });
        if (input.primaryReportingManagerId !== u.primaryReportingManagerId) {
          notify(tx, ctx, settings, { userId: u.id, type: 'MANAGER_REASSIGNED', title: 'Reporting Manager changed', body: 'Your Reporting Manager has been updated. Open your profile to see who reviews your reports.', link: '/profile' });
          notify(tx, ctx, settings, { userId: input.primaryReportingManagerId, type: 'MANAGER_REASSIGNED', title: 'New team member', body: `${u.fullName} (${u.employeeCode}) now reports to you.`, link: `/team/${u.id}` });
        }
      });
      return { ok: true as const };
    },
  }),

  'admin.users.setStatus': op({
    input: z.object({ userId: z.string().min(1), status: z.enum(['ACTIVE', 'DEACTIVATED', 'ARCHIVED']), reason: reasonRequired }),
    run: async (ctx, { userId, status, reason }) => {
      requirePermission(ctx, 'admin.users');
      const u = await getUser(ctx, userId);
      if (userId === ctx.actor.id) throw precondition('You cannot change the status of your own account.');
      if (u.accountStatus === status) return { ok: true as const };
      if (status !== 'ACTIVE') {
        await lastSuperAdminGuard(ctx, u, true);
        const reportees = (await assignedEmployees(ctx, userId)).filter((r) => r.accountStatus === 'ACTIVE');
        if (reportees.length) throw precondition(`${reportees.length} active employee(s) report to ${u.fullName}. Reassign them first.`);
      }
      const next = status === 'ACTIVE' && !u.activatedAt ? 'PENDING_ACTIVATION' : status;
      await ctx.auth.setDisabled(userId, next !== 'ACTIVE');
      await ctx.store.transaction(async (tx) => {
        tx.update(COL.users, userId, {
          accountStatus: next,
          deactivatedAt: next === 'DEACTIVATED' || next === 'ARCHIVED' ? (u.deactivatedAt ?? nowIso(ctx)) : null,
          updatedAt: nowIso(ctx),
        });
        audit(tx, ctx, {
          action: next === 'ACTIVE' ? 'USER_REACTIVATED' : status === 'ARCHIVED' ? 'USER_ARCHIVED' : 'USER_DEACTIVATED',
          entityType: 'user',
          entityId: userId,
          reason,
          beforeSnapshot: { accountStatus: u.accountStatus },
          afterSnapshot: { accountStatus: next },
        });
      });
      return { ok: true as const, accountStatus: next };
    },
  }),

  /** Admin sets a new password (admins can never read existing passwords). Ends the user's other sessions. */
  'admin.users.setPassword': op({
    input: z.object({ userId: z.string().min(1), password, requirePasswordChange: z.boolean().default(true), reason: z.string().trim().max(500).default('') }),
    run: async (ctx, { userId, password: newPassword, requirePasswordChange, reason }) => {
      requirePermission(ctx, 'admin.users');
      if (userId === ctx.actor.id) throw precondition('Change your own password from your profile.');
      const u = await getUser(ctx, userId);
      if (u.accountStatus === 'DEACTIVATED' || u.accountStatus === 'ARCHIVED') throw precondition('Reactivate the account before setting a password.');
      await ctx.auth.setPassword(userId, newPassword);
      if (u.accountStatus === 'PENDING_ACTIVATION') await ctx.auth.setDisabled(userId, false);
      await ctx.store.transaction(async (tx) => {
        tx.update(COL.users, userId, {
          mustChangePassword: requirePasswordChange,
          ...(u.accountStatus === 'PENDING_ACTIVATION' ? { accountStatus: 'ACTIVE', activatedAt: nowIso(ctx) } : {}),
          updatedAt: nowIso(ctx),
        });
        audit(tx, ctx, { action: 'PASSWORD_SET_BY_ADMIN', entityType: 'user', entityId: userId, reason, afterSnapshot: { mustChangePassword: requirePasswordChange } });
      });
      return { ok: true as const };
    },
  }),

  /**
   * Permanently delete an employee and their reporting data. Only for accounts that are already
   * deactivated or archived, with the employee code typed to confirm and a reason. Audit history is kept.
   */
  'admin.users.delete': op({
    input: z.object({ userId: z.string().min(1), confirmCode: z.string().trim().min(1), reason: reasonRequired }),
    run: async (ctx, { userId, confirmCode, reason }) => {
      requirePermission(ctx, 'admin.users');
      if (userId === ctx.actor.id) throw precondition('You cannot delete your own account.');
      const u = await getUser(ctx, userId);
      if (u.accountStatus !== 'DEACTIVATED' && u.accountStatus !== 'ARCHIVED') throw precondition('Deactivate the account before deleting it permanently.');
      if (confirmCode.toUpperCase() !== u.employeeCode.toUpperCase()) throw invalid(`Type ${u.employeeCode} to confirm.`);
      const reportees = await assignedEmployees(ctx, userId);
      if (reportees.length) throw precondition(`${reportees.length} employee(s) still report to ${u.fullName}. Reassign them first.`);

      const byEmployee = (col: CollectionName, field = 'employeeId') => ctx.store.query<{ id: string }>(col, { where: [[field, '==', userId]], limit: 20_000 });
      const [daily, tasks, weekly, versions, reviews, notifications, routines, tokens, projects] = await Promise.all([
        ctx.store.query<DailyReportDoc & { id: string }>(COL.dailyReports, { where: [['employeeId', '==', userId]], limit: 20_000 }),
        byEmployee(COL.tasks),
        byEmployee(COL.weeklyReports),
        byEmployee(COL.reportVersions),
        byEmployee(COL.reportReviews),
        byEmployee(COL.notifications, 'userId'),
        byEmployee(COL.dailyRoutines, 'userId'),
        byEmployee(COL.activationTokens, 'userId'),
        ctx.store.query<ProjectDoc & { id: string }>(COL.projects, { limit: 1000 }),
      ]);
      const deletes: [CollectionName, string][] = [
        ...daily.map((r) => [COL.dailyReports, r.id] as [CollectionName, string]),
        ...daily.map((r) => [COL.uniqueKeys, dailyKey(userId, r.workDate)] as [CollectionName, string]),
        ...[tasks, weekly, versions, reviews, notifications, routines, tokens].flatMap((list, i) =>
          list.map((d) => [[COL.tasks, COL.weeklyReports, COL.reportVersions, COL.reportReviews, COL.notifications, COL.dailyRoutines, COL.activationTokens][i]!, d.id] as [CollectionName, string]),
        ),
      ];
      // Firestore allows 500 writes per transaction; delete in chunks.
      for (let i = 0; i < deletes.length; i += 400) {
        const chunk = deletes.slice(i, i + 400);
        await ctx.store.transaction(async (tx) => chunk.forEach(([c, id]) => tx.delete(c, id)));
      }
      const touched = projects.filter((p) => p.ownerId === userId || p.reviewerId === userId || p.requestedBy === userId || p.participantIds.includes(userId));
      for (let i = 0; i < touched.length; i += 400) {
        const chunk = touched.slice(i, i + 400);
        await ctx.store.transaction(async (tx) =>
          chunk.forEach((p) =>
            tx.update(COL.projects, p.id, {
              ownerId: p.ownerId === userId ? null : p.ownerId,
              reviewerId: p.reviewerId === userId ? null : (p.reviewerId ?? null),
              requestedBy: p.requestedBy === userId ? null : p.requestedBy,
              participantIds: p.participantIds.filter((x) => x !== userId),
              updatedAt: nowIso(ctx),
            }),
          ),
        );
      }
      await ctx.auth.deleteUser(userId);
      const counts = { dailyReports: daily.length, weeklyReports: weekly.length, tasks: tasks.length, notifications: notifications.length };
      await ctx.store.transaction(async (tx) => {
        for (const k of [codeKey(u.employeeCode), phoneKey(u.phoneNumber), emailKey(u.authEmail)]) tx.delete(COL.uniqueKeys, k);
        tx.delete(COL.users, userId);
        audit(tx, ctx, {
          action: 'USER_PERMANENTLY_DELETED',
          entityType: 'user',
          entityId: userId,
          reason,
          beforeSnapshot: { employeeCode: u.employeeCode, fullName: u.fullName, departmentId: u.departmentId, role: u.role },
          afterSnapshot: counts,
        });
      });
      return { ok: true as const, ...counts };
    },
  }),

  'admin.registrations.list': op({
    input: z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('PENDING') }),
    run: async (ctx, { status }) => {
      requirePermission(ctx, 'admin.users');
      const items = await ctx.store.query<RegistrationRequestDoc & { id: string }>(COL.registrationRequests, {
        where: [['status', '==', status]],
        orderBy: [['createdAt', 'desc']],
        limit: 200,
      });
      return { items };
    },
  }),

  'admin.registrations.approve': op({
    input: employeeFields.extend({ requestId: z.string().min(1), ...initialCreds }),
    run: async (ctx, { requestId, initialPassword, requirePasswordChange, ...fields }) => {
      requirePermission(ctx, 'admin.users');
      return createEmployee(ctx, fields, requestId, { password: initialPassword, requireChange: requirePasswordChange });
    },
  }),

  'admin.registrations.reject': op({
    input: z.object({ requestId: z.string().min(1), reason: reasonRequired }),
    run: async (ctx, { requestId, reason }) => {
      requirePermission(ctx, 'admin.users');
      await ctx.store.transaction(async (tx) => {
        const r = await tx.get<RegistrationRequestDoc & { id: string }>(COL.registrationRequests, requestId);
        if (!r) throw notFound('Registration request');
        if (r.status !== 'PENDING') throw precondition('This request was already decided.');
        tx.update(COL.registrationRequests, requestId, { status: 'REJECTED', decidedBy: ctx.actor.id, decidedAt: nowIso(ctx), decisionReason: reason });
        audit(tx, ctx, { action: 'REGISTRATION_REJECTED', entityType: 'registrationRequest', entityId: requestId, reason });
      });
      return { ok: true as const };
    },
  }),

  'admin.departments.upsert': op({
    input: z.object({
      id: z.string().nullable(),
      name: z.string().trim().min(2).max(80),
      code: z.string().trim().toUpperCase().min(1).max(12),
      description: z.string().trim().max(500).default(''),
      active: z.boolean().default(true),
    }),
    run: async (ctx, input) => {
      requirePermission(ctx, 'admin.departments');
      const existing = await allDepartments(ctx);
      if (existing.some((d) => d.id !== input.id && (d.code === input.code || normalizeName(d.name) === normalizeName(input.name)))) {
        throw new AppError('already-exists', 'A department with this name or code already exists.');
      }
      const id = input.id ?? `dept_${input.code.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      const before = existing.find((d) => d.id === input.id) ?? null;
      if (input.id && !before) throw notFound('Department');
      if (before && before.active && !input.active) {
        const members = await ctx.store.query<UserDoc & { id: string }>(COL.users, { where: [['departmentId', '==', id], ['accountStatus', '==', 'ACTIVE']], limit: 1 });
        if (members.length) throw precondition('Move active employees out of this department before deactivating it.');
      }
      const now = nowIso(ctx);
      const doc: DepartmentDoc = { id, name: input.name, code: input.code, description: input.description, active: input.active, createdAt: before?.createdAt ?? now, updatedAt: now };
      await ctx.store.transaction(async (tx) => {
        if (before) tx.set(COL.departments, id, doc as unknown as DepartmentDoc & { id: string });
        else tx.create(COL.departments, id, doc as unknown as DepartmentDoc & { id: string });
        audit(tx, ctx, { action: before ? 'DEPARTMENT_UPDATED' : 'DEPARTMENT_CREATED', entityType: 'department', entityId: id, beforeSnapshot: before as unknown as Record<string, unknown>, afterSnapshot: doc as unknown as Record<string, unknown> });
      }).catch(mapStoreError);
      return { department: doc };
    },
  }),

  'admin.departments.list': op({
    input: z.object({}).default({}),
    run: async (ctx) => {
      requirePermission(ctx, 'admin.departments');
      const [departments, users] = await Promise.all([allDepartments(ctx), ctx.store.query<UserDoc & { id: string }>(COL.users, { limit: 5000 })]);
      return {
        items: departments.map((d) => ({ ...d, activeEmployees: users.filter((u) => u.departmentId === d.id && u.accountStatus === 'ACTIVE').length })),
      };
    },
  }),

  'admin.projects.upsert': op({
    input: projectInput,
    run: async (ctx, input) => {
      requirePermission(ctx, 'admin.projects');
      if (input.startDate && input.targetEndDate && input.targetEndDate < input.startDate) throw invalid('Target end date must be after the start date.');
      const all = await ctx.store.query<ProjectDoc & { id: string }>(COL.projects, { limit: 1000 });
      if (all.some((p) => p.id !== input.id && (p.code === input.code || p.normalizedName === normalizeName(input.name)))) {
        throw new AppError('already-exists', 'A project with this name or code already exists.');
      }
      const before = input.id ? (all.find((p) => p.id === input.id) ?? null) : null;
      if (input.id && !before) throw notFound('Project');
      await validateProjectPeople(ctx, input.ownerId, input.reviewerId);
      const settings = await getSettings(ctx);
      const id = input.id ?? globalThis.crypto.randomUUID();
      const now = nowIso(ctx);
      const doc: ProjectDoc = { ...input, id, normalizedName: normalizeName(input.name), requestedBy: before?.requestedBy ?? null, createdAt: before?.createdAt ?? now, updatedAt: now };
      await ctx.store.transaction(async (tx) => {
        tx.set(COL.projects, id, doc as unknown as ProjectDoc & { id: string });
        audit(tx, ctx, {
          action: !before ? 'PROJECT_CREATED' : before.status !== doc.status ? 'PROJECT_STATUS_CHANGED' : 'PROJECT_UPDATED',
          entityType: 'project',
          entityId: id,
          beforeSnapshot: before as unknown as Record<string, unknown>,
          afterSnapshot: doc as unknown as Record<string, unknown>,
        });
        if (doc.ownerId !== before?.ownerId || doc.reviewerId !== before?.reviewerId) notifyProjectPeople(tx, ctx, settings, doc);
      });
      return { project: doc };
    },
  }),

  'admin.settings.get': op({
    input: z.object({}).default({}),
    run: async (ctx) => {
      requirePermission(ctx, 'admin.settings');
      return { settings: await getSettings(ctx) };
    },
  }),

  'admin.settings.update': op({
    input: z.object({ changes: settingsUpdateInput, reason: z.string().trim().max(500).default('') }),
    run: async (ctx, { changes, reason }) => {
      requirePermission(ctx, 'admin.settings');
      return ctx.store.transaction(async (tx) => {
        const stored = await tx.get<SystemSettings & { id: string }>(COL.systemSettings, SETTINGS_ID);
        const before = withSettingsDefaults(stored, nowIso(ctx));
        const next: SystemSettings = { ...before, ...changes, notificationTypesEnabled: { ...before.notificationTypesEnabled, ...(changes.notificationTypesEnabled ?? {}) }, updatedAt: nowIso(ctx), updatedBy: ctx.actor.id };
        if (next.minTasksForSubmission > next.primaryTaskSlots) throw invalid('Minimum tasks cannot exceed the number of primary task slots.');
        tx.set(COL.systemSettings, SETTINGS_ID, { ...next, id: SETTINGS_ID } as unknown as SystemSettings & { id: string });
        const keys = Object.keys(changes) as (keyof SystemSettings)[];
        audit(tx, ctx, {
          action: 'SETTINGS_UPDATED',
          entityType: 'systemSettings',
          entityId: SETTINGS_ID,
          reason,
          beforeSnapshot: Object.fromEntries(keys.map((k) => [k, before[k]])),
          afterSnapshot: Object.fromEntries(keys.map((k) => [k, next[k]])),
        });
        return { settings: next };
      });
    },
  }),

  /** Audited correction of a submitted daily report. The original stays in version history. */
  'admin.daily.correct': op({
    input: z.object({
      reportId: z.string().min(1),
      workDate: dateStr.optional(),
      tasks: z.array(taskInput).max(10).optional(),
      employeeNotes: z.string().trim().max(4000).optional(),
      reason: reasonRequired,
      expectedVersion: z.number().int().min(1),
    }),
    run: async (ctx, input) => {
      requirePermission(ctx, 'admin.reports.correct');
      const settings = await getSettings(ctx);
      const pre = await ctx.store.get<DailyReportDoc & { id: string }>(COL.dailyReports, input.reportId);
      if (!pre) throw notFound('Daily report');
      if (pre.submissionStatus !== 'SUBMITTED') throw precondition('Only submitted reports can be corrected. Drafts belong to the employee.');
      const employee = await getUser(ctx, pre.employeeId);
      if (input.tasks) {
        if (input.tasks.length < 1 || input.tasks.length > maxTasksPerReport(settings)) throw invalid('Invalid number of tasks.');
        input.tasks.forEach((t, i) => {
          const issue = taskIssues(t, settings)[0];
          if (issue) throw invalid(`Task ${i + 1}: ${issue.message}`);
        });
        await validateReferences(ctx, input.tasks, pre.tasks);
      }
      const newDate = input.workDate ?? pre.workDate;
      const today = todayIn(settings.timezone, ctx.now());
      if (newDate > today) throw invalid('The work date cannot be in the future.');
      const exceptions = await getExceptions(ctx, newDate, newDate);
      const workingDay = resolveWorkingDay(newDate, settings.calendarPolicies, exceptions, employee.departmentId);
      const now = nowIso(ctx);
      const result = await ctx.store
        .transaction(async (tx) => {
          const r = await tx.get<DailyReportDoc & { id: string }>(COL.dailyReports, input.reportId);
          if (!r || r.version !== input.expectedVersion) throw conflict('The report changed while you were editing. Reload and try again.');
          const tasks = input.tasks
            ? input.tasks.map((t, i) => ({
                ...t,
                overnight: settings.allowOvernightTasks && t.overnight,
                slot: i + 1,
                isPrimary: i < settings.primaryTaskSlots,
                departmentId: r.departmentId,
                collaboratorIds: t.collaboratorIds.filter((c) => c !== r.employeeId),
              }))
            : r.tasks;
          const reReview = settings.reReviewOnAdminCorrection && r.reviewStatus === 'APPROVED';
          const next: DailyReportDoc = {
            ...r,
            workDate: newDate,
            workingDay,
            isHolidayWork: !workingDay.isWorkingDay,
            tasks,
            projectIds: [...new Set(tasks.map((t) => t.projectId).filter((x): x is string => !!x))],
            employeeNotes: input.employeeNotes ?? r.employeeNotes,
            version: r.version + 1,
            revision: r.revision + 1,
            lastAdminCorrectionAt: now,
            updatedAt: now,
            ...(reReview ? { reviewStatus: 'PENDING_REVIEW' as const, awaitingReview: true, needsReReview: true, approvedAt: null, approvedBy: null } : {}),
          };
          if (newDate !== r.workDate) {
            tx.delete(COL.uniqueKeys, dailyKey(r.employeeId, r.workDate));
            tx.create(COL.uniqueKeys, dailyKey(r.employeeId, newDate), { id: dailyKey(r.employeeId, newDate), ownerId: r.id, createdAt: now });
          }
          tx.set(COL.dailyReports, r.id, next as unknown as DailyReportDoc & { id: string });
          writeVersion(tx, ctx, 'DAILY', next as unknown as DailyReportDoc & Record<string, unknown>, next.version, 'ADMIN_CORRECTION', input.reason);
          syncTaskIndex(tx, next, r.tasks.length, now);
          audit(tx, ctx, {
            action: 'DAILY_REPORT_ADMIN_CORRECTED',
            entityType: 'dailyReport',
            entityId: r.id,
            reason: input.reason,
            beforeSnapshot: { workDate: r.workDate, tasks: r.tasks, employeeNotes: r.employeeNotes, version: r.version, reviewStatus: r.reviewStatus },
            afterSnapshot: { workDate: next.workDate, tasks: next.tasks, employeeNotes: next.employeeNotes, version: next.version, reviewStatus: next.reviewStatus },
          });
          notify(tx, ctx, settings, { userId: r.employeeId, type: 'FEEDBACK_RECEIVED', title: 'Report corrected by administrator', body: `Your report for ${r.workDate} was corrected: ${input.reason}`, link: `/reports/daily/${r.id}` });
          if (reReview) {
            notify(tx, ctx, settings, { userId: employee.primaryReportingManagerId, type: 'REVIEW_REQUESTED', title: 'Corrected report needs re-review', body: `An administrator corrected ${r.employeeName}'s report for ${newDate}.`, link: `/reviews/daily/${r.id}`, key: `${r.id}_v${next.version}` });
          }
          return next;
        })
        .catch((e) => {
          if (e instanceof StoreError && e.code === 'ALREADY_EXISTS') throw precondition('The employee already has a report on that date.');
          throw e;
        });
      return { report: result };
    },
  }),

  'admin.weekly.correct': op({
    input: z.object({ reportId: z.string().min(1), narrative: narrativeInput, reason: reasonRequired, recalculate: z.boolean().default(true), expectedVersion: z.number().int().min(1) }),
    run: async (ctx, input) => {
      requirePermission(ctx, 'admin.reports.correct');
      const settings = await getSettings(ctx);
      const pre = await ctx.store.get<WeeklyReportDoc & { id: string }>(COL.weeklyReports, input.reportId);
      if (!pre) throw notFound('Weekly report');
      if (pre.submissionStatus !== 'SUBMITTED') throw precondition('Only submitted reports can be corrected.');
      const employee = await getUser(ctx, pre.employeeId);
      const recalculated = input.recalculate ? await computeWeeklySummary(ctx, employee, pre.periodStart, settings) : null;
      const now = nowIso(ctx);
      const next = await ctx.store.transaction(async (tx) => {
        const r = await tx.get<WeeklyReportDoc & { id: string }>(COL.weeklyReports, input.reportId);
        if (!r || r.version !== input.expectedVersion) throw conflict('The report changed while you were editing. Reload and try again.');
        const reReview = settings.reReviewOnAdminCorrection && r.reviewStatus === 'APPROVED';
        const updated: WeeklyReportDoc = {
          ...r,
          narrative: input.narrative,
          calculatedSummary: recalculated?.summary ?? r.calculatedSummary,
          dailyReportIds: recalculated?.dailyReportIds ?? r.dailyReportIds,
          version: r.version + 1,
          revision: r.revision + 1,
          lastAdminCorrectionAt: now,
          updatedAt: now,
          ...(reReview ? { reviewStatus: 'PENDING_REVIEW' as const, awaitingReview: true, needsReReview: true, approvedAt: null, approvedBy: null } : {}),
        };
        tx.set(COL.weeklyReports, r.id, updated as unknown as WeeklyReportDoc & { id: string });
        writeVersion(tx, ctx, 'WEEKLY', updated as unknown as WeeklyReportDoc & Record<string, unknown>, updated.version, 'ADMIN_CORRECTION', input.reason);
        audit(tx, ctx, {
          action: 'WEEKLY_REPORT_ADMIN_CORRECTED',
          entityType: 'weeklyReport',
          entityId: r.id,
          reason: input.reason,
          beforeSnapshot: { narrative: r.narrative, version: r.version, reviewStatus: r.reviewStatus },
          afterSnapshot: { narrative: updated.narrative, version: updated.version, reviewStatus: updated.reviewStatus },
        });
        notify(tx, ctx, settings, { userId: r.employeeId, type: 'FEEDBACK_RECEIVED', title: 'Weekly report corrected by administrator', body: input.reason, link: `/reports/weekly/${r.id}` });
        if (reReview) notify(tx, ctx, settings, { userId: employee.primaryReportingManagerId, type: 'REVIEW_REQUESTED', title: 'Corrected weekly report needs re-review', body: `${r.employeeName}, ${r.periodStart} – ${r.periodEnd}`, link: `/reviews/weekly/${r.id}`, key: `${r.id}_v${updated.version}` });
        return updated;
      });
      return { report: next };
    },
  }),

  /** Cursor-paged audit log, newest first. Extra filters apply within each scanned page. */
  'admin.audit.list': op({
    input: z.object({
      from: dateStr,
      to: dateStr,
      action: z.string().max(80).nullable().default(null),
      entityType: z.string().max(40).nullable().default(null),
      actorId: z.string().nullable().default(null),
      entityId: z.string().nullable().default(null),
      cursor: z.string().nullable().default(null),
      pageSize: z.number().int().min(10).max(500).default(200),
    }),
    run: async (ctx, f) => {
      requirePermission(ctx, 'admin.audit');
      const where: [string, '>=' | '<=' | '==', string][] = [
        ['timestamp', '>=', `${f.from}T00:00:00.000Z`],
        ['timestamp', '<=', `${f.to}T23:59:59.999Z`],
      ];
      if (f.entityId) where.unshift(['entityId', '==', f.entityId]);
      const scanned = await ctx.store.query<AuditLogDoc & { id: string }>(COL.auditLogs, {
        where,
        orderBy: [['timestamp', 'desc']],
        limit: f.pageSize,
        ...(f.cursor ? { startAfter: [f.cursor] } : {}),
      });
      const items = scanned.filter(
        (a) => (!f.action || a.action === f.action) && (!f.entityType || a.entityType === f.entityType) && (!f.actorId || a.actorId === f.actorId),
      );
      return { items, nextCursor: scanned.length === f.pageSize ? (scanned[scanned.length - 1]?.timestamp ?? null) : null };
    },
  }),
};

