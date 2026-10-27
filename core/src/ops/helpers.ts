import { withSettingsDefaults } from '../settings';
import { queryIn, type Tx } from '../store';
import {
  COL,
  type AuditLogDoc,
  type CalendarExceptionDoc,
  type DepartmentDoc,
  type NotificationDoc,
  type NotificationType,
  type ProjectDoc,
  type SystemSettings,
  type UserDoc,
} from '../types';
import { notFound } from '../errors';
import { canViewEmployee } from '../permissions';
import { deny } from '../errors';
import type { AuthedCtx, Ctx } from './context';
import { nowIso } from './context';
import type { DateStr } from '../dates';

export const SETTINGS_ID = 'general';

export async function getSettings(ctx: Ctx): Promise<SystemSettings> {
  const stored = await ctx.store.get<SystemSettings & { id: string }>(COL.systemSettings, SETTINGS_ID);
  return withSettingsDefaults(stored, nowIso(ctx));
}

export async function getExceptions(ctx: Ctx, from: DateStr, to: DateStr): Promise<CalendarExceptionDoc[]> {
  return ctx.store.query<CalendarExceptionDoc & { id: string }>(COL.workCalendar, {
    where: [
      ['date', '>=', from],
      ['date', '<=', to],
    ],
  });
}

export async function getUser(ctx: Ctx, id: string): Promise<UserDoc> {
  const u = await ctx.store.get<UserDoc & { id: string }>(COL.users, id);
  if (!u) throw notFound('Employee');
  return u;
}

export async function usersById(ctx: Ctx, ids: (string | null | undefined)[]): Promise<Map<string, UserDoc>> {
  const list = await ctx.store.getMany<UserDoc & { id: string }>(COL.users, ids.filter((x): x is string => !!x));
  return new Map(list.map((u) => [u.id, u]));
}

export async function allDepartments(ctx: Ctx): Promise<DepartmentDoc[]> {
  return ctx.store.query<DepartmentDoc & { id: string }>(COL.departments, { orderBy: [['name', 'asc']] });
}

export async function projectsById(ctx: Ctx, ids: (string | null)[]): Promise<Map<string, ProjectDoc>> {
  const list = await ctx.store.getMany<ProjectDoc & { id: string }>(COL.projects, ids.filter((x): x is string => !!x));
  return new Map(list.map((p) => [p.id, p]));
}

/** Load an employee and confirm the actor may see their records. */
export async function getViewableEmployee(ctx: AuthedCtx, employeeId: string): Promise<UserDoc> {
  const employee = await getUser(ctx, employeeId);
  if (!canViewEmployee(ctx.actor, employee)) throw deny('You are not authorized to view this employee.');
  return employee;
}

/** Users whose primary manager or secondary reviewer is the actor. */
export async function assignedEmployees(ctx: Ctx, managerId: string): Promise<UserDoc[]> {
  const [primary, secondary] = await Promise.all([
    ctx.store.query<UserDoc & { id: string }>(COL.users, { where: [['primaryReportingManagerId', '==', managerId]] }),
    ctx.store.query<UserDoc & { id: string }>(COL.users, { where: [['secondaryReviewerId', '==', managerId]] }),
  ]);
  const map = new Map<string, UserDoc>();
  for (const u of [...primary, ...secondary]) if (u.id !== managerId && u.accountStatus !== 'ARCHIVED') map.set(u.id, u);
  return [...map.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/** Employees in the actor's reporting scope (management / admin: everyone; manager: assigned; others: self). */
export async function scopedEmployees(ctx: AuthedCtx, opts: { includeInactive?: boolean } = {}): Promise<UserDoc[]> {
  let list: UserDoc[];
  if (ctx.actor.role === 'MANAGEMENT' || ctx.actor.role === 'SUPER_ADMIN') {
    list = await ctx.store.query<UserDoc & { id: string }>(COL.users, { orderBy: [['normalizedName', 'asc']], limit: 5000 });
  } else if (ctx.actor.role === 'REPORTING_MANAGER') {
    list = await assignedEmployees(ctx, ctx.actor.id);
  } else {
    list = [ctx.actor];
  }
  return opts.includeInactive ? list : list.filter((u) => u.accountStatus === 'ACTIVE' || u.accountStatus === 'DEACTIVATED');
}

export async function reportsForEmployees<T extends { id: string }>(
  ctx: Ctx,
  col: typeof COL.dailyReports | typeof COL.weeklyReports,
  employeeIds: string[],
  dateField: 'workDate' | 'periodStart',
  from: DateStr,
  to: DateStr,
): Promise<T[]> {
  return queryIn<T>(ctx.store, col, 'employeeId', employeeIds, {
    where: [
      [dateField, '>=', from],
      [dateField, '<=', to],
    ],
  });
}

export function audit(
  tx: Tx,
  ctx: Ctx,
  e: Pick<AuditLogDoc, 'action' | 'entityType' | 'entityId'> & Partial<Pick<AuditLogDoc, 'reason' | 'beforeSnapshot' | 'afterSnapshot'>>,
): void {
  const id = globalThis.crypto.randomUUID();
  const doc: AuditLogDoc = {
    id,
    actorId: ctx.actor?.id ?? null,
    actorName: ctx.actor?.fullName ?? 'System',
    actorRole: ctx.actor?.role ?? 'SYSTEM',
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    timestamp: nowIso(ctx),
    reason: e.reason ?? '',
    beforeSnapshot: e.beforeSnapshot ?? null,
    afterSnapshot: e.afterSnapshot ?? null,
    requestCorrelationId: ctx.correlationId,
  };
  tx.create(COL.auditLogs, id, doc as unknown as AuditLogDoc & { id: string });
}

/** Deterministic notification id for a keyed event (see `notify`). */
export const notificationId = (type: NotificationType, userId: string, key: string) => `${type}_${userId}_${key}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 300);

/**
 * Queue a notification inside a transaction. `key` makes the id deterministic, so retrying the
 * same event never produces a second notification.
 */
export function notify(
  tx: Tx,
  ctx: Ctx,
  settings: SystemSettings,
  n: { userId: string | null; type: NotificationType; title: string; body: string; link: string | null; key?: string },
): void {
  if (!n.userId || !settings.notificationTypesEnabled[n.type]) return;
  const id = n.key ? notificationId(n.type, n.userId, n.key) : globalThis.crypto.randomUUID();
  const doc: NotificationDoc = {
    id,
    userId: n.userId,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link,
    read: false,
    createdAt: nowIso(ctx),
  };
  tx.set(COL.notifications, id, doc as unknown as NotificationDoc & { id: string });
}

export function normalizeName(name: string): string {
  return name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Prefix tokens for name / code / designation search (bounded). */
export function searchTokens(u: Pick<UserDoc, 'fullName' | 'employeeCode' | 'designation' | 'phoneNumber'>): string[] {
  const tokens = new Set<string>();
  const add = (word: string) => {
    for (let i = 1; i <= Math.min(word.length, 15); i++) tokens.add(word.slice(0, i));
  };
  for (const w of normalizeName(u.fullName).split(' ')) if (w) add(w);
  add(u.employeeCode.toLowerCase());
  for (const w of normalizeName(u.designation).split(' ')) if (w) add(w);
  return [...tokens].slice(0, 200);
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

/** Public-safe user summary for pickers and lists. */
export function userSummary(u: UserDoc) {
  return {
    id: u.id,
    fullName: u.fullName,
    employeeCode: u.employeeCode,
    departmentId: u.departmentId,
    designation: u.designation,
    role: u.role,
    accountStatus: u.accountStatus,
  };
}
export type UserSummary = ReturnType<typeof userSummary>;

/** Full profile for authorized viewers (management, admin, own manager). Never includes auth secrets. */
export function userProfile(u: UserDoc) {
  return {
    ...userSummary(u),
    phoneNumber: u.phoneNumber,
    officialEmail: u.officialEmail,
    primaryReportingManagerId: u.primaryReportingManagerId,
    secondaryReviewerId: u.secondaryReviewerId,
    joinedAt: u.joinedAt,
    activatedAt: u.activatedAt,
    deactivatedAt: u.deactivatedAt,
    mustChangePassword: u.mustChangePassword ?? false,
    alternatePhone: u.alternatePhone,
    location: u.location,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}
export type UserProfile = ReturnType<typeof userProfile>;
