import { z } from 'zod';
import { dailyDeadline, isExpectedReporter, resolveWorkingDay } from '../calendar';
import { addDays, todayIn, zonedParts, timeToMinutes, type DateStr } from '../dates';
import { AppError, deny, invalid } from '../errors';
import { isOverdue, isSubmitted, latestTaskStates } from '../metrics';
import { can } from '../permissions';
import { dateStr } from '../schemas';
import type { Tx } from '../store';
import { COL, type DailyReportDoc, type NotificationDoc, type ProjectDoc, type SystemSettings, type UserDoc } from '../types';
import { nowIso, op, requirePermission, type Ctx } from './context';
import { flattenTasks } from './analytics';
import { allDepartments, audit, getExceptions, getSettings, normalizeName, notify, userSummary } from './helpers';

/** Lead: any active user. Reviewer: an active Reporting Manager, Management or Super Admin, not the lead. */
export async function validateProjectPeople(ctx: Ctx, ownerId: string | null, reviewerId: string | null): Promise<void> {
  const ids = [ownerId, reviewerId].filter((x): x is string => !!x);
  const users = await ctx.store.getMany<UserDoc & { id: string }>(COL.users, ids);
  const get = (id: string) => users.find((u) => u.id === id);
  if (ownerId && get(ownerId)?.accountStatus !== 'ACTIVE') throw invalid('The project lead must be an active employee.');
  if (reviewerId) {
    const r = get(reviewerId);
    if (!r || r.accountStatus !== 'ACTIVE') throw invalid('The reviewer must be an active employee.');
    if (!['REPORTING_MANAGER', 'MANAGEMENT', 'SUPER_ADMIN'].includes(r.role)) throw invalid(`${r.fullName} cannot review projects. Choose a Reporting Manager or Management.`);
    if (reviewerId === ownerId) throw invalid('The reviewer must be different from the project lead.');
  }
}

export function notifyProjectPeople(tx: Tx, ctx: Ctx, settings: SystemSettings, p: ProjectDoc): void {
  const by = ctx.actor?.fullName ?? 'An administrator';
  if (p.ownerId && p.ownerId !== ctx.actor?.id) notify(tx, ctx, settings, { userId: p.ownerId, type: 'PROJECT_ASSIGNED', title: 'You lead a project', body: `${by} made you lead of "${p.name}".`, link: '/my/projects', key: `${p.id}_lead_${p.ownerId}` });
  if (p.reviewerId && p.reviewerId !== ctx.actor?.id) notify(tx, ctx, settings, { userId: p.reviewerId, type: 'PROJECT_ASSIGNED', title: 'You review a project', body: `${by} made you reviewer of "${p.name}".`, link: `/projects/${p.id}`, key: `${p.id}_reviewer_${p.reviewerId}` });
}

export const miscOps = {
  'lookup.departments': op({
    input: z.object({}).default({}),
    run: async (ctx) => ({ items: (await allDepartments(ctx)).map((d) => ({ id: d.id, name: d.name, code: d.code, active: d.active })) }),
  }),

  /** Projects an employee can attach tasks to (and, for admins / management, all projects). */
  'lookup.projects': op({
    input: z.object({ includeAll: z.boolean().default(false) }),
    run: async (ctx, { includeAll }) => {
      const all = await ctx.store.query<ProjectDoc & { id: string }>(COL.projects, { orderBy: [['normalizedName', 'asc']], limit: 1000 });
      const seeAll = includeAll && (can(ctx.actor.role, 'analytics.company') || can(ctx.actor.role, 'admin.projects'));
      const items = all.filter((p) => seeAll || p.status === 'ACTIVE' || p.status === 'ON_HOLD' || (p.status === 'PROPOSED' && p.requestedBy === ctx.actor.id));
      return {
        items: items.map((p) => ({
          id: p.id,
          name: p.name,
          code: p.code,
          status: p.status,
          priority: p.priority,
          departmentId: p.departmentId,
          ...(seeAll ? { description: p.description, ownerId: p.ownerId, reviewerId: p.reviewerId, participantIds: p.participantIds, startDate: p.startDate, targetEndDate: p.targetEndDate, milestones: p.milestones, requestedBy: p.requestedBy } : {}),
        })),
      };
    },
  }),

  'lookup.people': op({
    input: z.object({ ids: z.array(z.string()).max(100) }),
    run: async (ctx, { ids }) => {
      const users = await ctx.store.getMany<UserDoc & { id: string }>(COL.users, ids);
      return { items: users.map(userSummary) };
    },
  }),

  /** Employees can propose a new project / workstream; it stays PROPOSED until an admin activates it. */
  /** Projects the user leads, reviews, requested or takes part in (including ones without tasks yet). */
  'projects.mine': op({
    input: z.object({}).default({}),
    run: async (ctx) => {
      const all = await ctx.store.query<ProjectDoc & { id: string }>(COL.projects, { limit: 1000 });
      const me = ctx.actor.id;
      const mine = all.filter((p) => p.requestedBy === me || p.ownerId === me || p.reviewerId === me || p.participantIds.includes(me));
      const people = await ctx.store.getMany<UserDoc & { id: string }>(COL.users, mine.flatMap((p) => [p.ownerId, p.reviewerId]).filter((x): x is string => !!x));
      const name = (id: string | null) => (id ? (people.find((u) => u.id === id)?.fullName ?? null) : null);
      return {
        items: mine.map((p) => ({
          id: p.id,
          name: p.name,
          code: p.code,
          description: p.description,
          status: p.status,
          startDate: p.startDate,
          targetEndDate: p.targetEndDate,
          ownerName: name(p.ownerId),
          reviewerName: name(p.reviewerId),
          myRole: p.ownerId === me ? 'Lead' : p.reviewerId === me ? 'Reviewer' : p.requestedBy === me ? 'Requested' : 'Member',
        })),
      };
    },
  }),

  /** Employees can propose a new project; it stays PROPOSED until a Super Admin activates it. */
  'projects.request': op({
    input: z
      .object({
        name: z.string().trim().min(2, 'Project name is required').max(120),
        description: z.string().trim().min(5, 'Describe the project').max(2000),
        departmentId: z.string().nullable().default(null),
        startDate: dateStr.nullable().default(null),
        targetEndDate: dateStr.nullable().default(null),
        ownerId: z.string().nullable().default(null),
        reviewerId: z.string().nullable().default(null),
      })
      .refine((v) => !v.startDate || !v.targetEndDate || v.targetEndDate >= v.startDate, { message: 'End date must be on or after the start date', path: ['targetEndDate'] }),
    run: async (ctx, input) => {
      const settings = await getSettings(ctx);
      if (!settings.allowProjectRequests) throw deny('Project requests are disabled.');
      await validateProjectPeople(ctx, input.ownerId ?? ctx.actor.id, input.reviewerId);
      const all = await ctx.store.query<ProjectDoc & { id: string }>(COL.projects, { limit: 1000 });
      if (all.some((p) => p.normalizedName === normalizeName(input.name))) throw new AppError('already-exists', 'A project with this name already exists. Select it from the list.');
      const id = globalThis.crypto.randomUUID();
      const now = nowIso(ctx);
      const base = input.name.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 6) || 'PRJ';
      const doc: ProjectDoc = {
        id,
        name: input.name,
        normalizedName: normalizeName(input.name),
        code: `${base}-${id.slice(0, 4).toUpperCase()}`,
        description: input.description,
        departmentId: input.departmentId ?? ctx.actor.departmentId,
        ownerId: input.ownerId ?? ctx.actor.id,
        reviewerId: input.reviewerId,
        participantIds: [...new Set([ctx.actor.id, input.ownerId ?? ctx.actor.id])],
        startDate: input.startDate,
        targetEndDate: input.targetEndDate,
        status: 'PROPOSED',
        priority: 'MEDIUM',
        milestones: [],
        requestedBy: ctx.actor.id,
        createdAt: now,
        updatedAt: now,
      };
      await ctx.store.transaction(async (tx) => {
        tx.create(COL.projects, id, doc as unknown as ProjectDoc & { id: string });
        audit(tx, ctx, { action: 'PROJECT_REQUESTED', entityType: 'project', entityId: id, afterSnapshot: { name: doc.name, code: doc.code, ownerId: doc.ownerId, reviewerId: doc.reviewerId, startDate: doc.startDate, targetEndDate: doc.targetEndDate } });
        notifyProjectPeople(tx, ctx, settings, doc);
      });
      return { project: { id, name: doc.name, code: doc.code, status: doc.status } };
    },
  }),

  'notifications.list': op({
    input: z.object({ unreadOnly: z.boolean().default(false), limit: z.number().int().min(1).max(100).default(50) }),
    run: async (ctx, { unreadOnly, limit }) => {
      const items = await ctx.store.query<NotificationDoc & { id: string }>(COL.notifications, {
        where: [['userId', '==', ctx.actor.id], ...(unreadOnly ? [['read', '==', false] as [string, '==', boolean]] : [])],
        orderBy: [['createdAt', 'desc']],
        limit,
      });
      const unread = await ctx.store.query<NotificationDoc & { id: string }>(COL.notifications, {
        where: [['userId', '==', ctx.actor.id], ['read', '==', false]],
        limit: 100,
      });
      return { items, unreadCount: unread.length };
    },
  }),

  'notifications.markRead': op({
    input: z.object({ ids: z.array(z.string()).max(100).nullable().default(null) }),
    run: async (ctx, { ids }) => {
      const targets = ids
        ? await ctx.store.getMany<NotificationDoc & { id: string }>(COL.notifications, ids)
        : await ctx.store.query<NotificationDoc & { id: string }>(COL.notifications, { where: [['userId', '==', ctx.actor.id], ['read', '==', false]], limit: 400 });
      const mine = targets.filter((n) => n.userId === ctx.actor.id && !n.read);
      if (mine.length) await ctx.store.transaction(async (tx) => mine.forEach((n) => tx.update(COL.notifications, n.id, { read: true })));
      return { updated: mine.length };
    },
  }),

  'admin.runReminders': op({
    input: z.object({ force: z.boolean().default(true) }),
    run: async (ctx, { force }) => {
      requirePermission(ctx, 'admin.settings');
      return runReminders(ctx, { force });
    },
  }),
};

/**
 * Reminder job (scheduled hourly in production; also runnable by Super Admin).
 * Uses the configured calendar and deadlines. Deterministic notification ids mean a reminder
 * is never sent twice for the same employee, date and event.
 */
export async function runReminders(ctx: Ctx, opts: { force: boolean }): Promise<{ ran: boolean; deadlineReminders: number; overdueNotices: number; date: DateStr }> {
  const settings = await getSettings(ctx);
  const now = ctx.now();
  const local = zonedParts(now, settings.timezone);
  const today = local.date;
  const reminderMinute = timeToMinutes(settings.reminderTime);
  const nowMinute = local.hour * 60 + local.minute;
  if (!opts.force && (nowMinute < reminderMinute || nowMinute >= reminderMinute + 60)) {
    return { ran: false, deadlineReminders: 0, overdueNotices: 0, date: today };
  }
  const deadline = dailyDeadline(today, settings);
  const [users, exceptions, todayReports] = await Promise.all([
    ctx.store.query<UserDoc & { id: string }>(COL.users, { where: [['accountStatus', '==', 'ACTIVE']], limit: 5000 }),
    getExceptions(ctx, today, today),
    ctx.store.query<DailyReportDoc & { id: string }>(COL.dailyReports, { where: [['workDate', '==', today]] }),
  ]);
  const submittedToday = new Set(todayReports.filter(isSubmitted).map((r) => r.employeeId));
  const due = now < deadline
    ? users.filter((u) => isExpectedReporter(u, today, settings) && resolveWorkingDay(today, settings.calendarPolicies, exceptions, u.departmentId).isWorkingDay && !submittedToday.has(u.id))
    : [];

  const from = addDays(today, -30);
  const recent = await ctx.store.query<DailyReportDoc & { id: string }>(COL.dailyReports, { where: [['workDate', '>=', from], ['workDate', '<=', today]], limit: 20_000 });
  const overdue = latestTaskStates(flattenTasks(recent.filter(isSubmitted))).filter((t) => isOverdue(t, todayIn(settings.timezone, now)));

  const notifId = (type: string, userId: string, key: string) => `${type}_${userId}_${key}`.replace(/[^A-Za-z0-9_-]/g, '_');
  const candidates = [
    ...due.map((u) => ({ id: notifId('DEADLINE_UPCOMING', u.id, `daily_${today}`), userId: u.id, kind: 'deadline' as const, task: null })),
    ...overdue.map((t) => ({ id: notifId('TASK_OVERDUE', t.employeeId, `${t.reportId}_${t.slot}`), userId: t.employeeId, kind: 'overdue' as const, task: t })),
  ];
  const existing = new Set((await ctx.store.getMany(COL.notifications, candidates.map((c) => c.id))).map((n) => n.id));
  const fresh = candidates.filter((c) => !existing.has(c.id));
  const time = new Intl.DateTimeFormat('en-IN', { timeZone: settings.timezone, hour: '2-digit', minute: '2-digit' }).format(deadline);
  for (let i = 0; i < fresh.length; i += 200) {
    const chunk = fresh.slice(i, i + 200);
    await ctx.store.transaction(async (tx) => {
      for (const c of chunk) {
        if (c.kind === 'deadline') {
          notify(tx, ctx, settings, { userId: c.userId, type: 'DEADLINE_UPCOMING', title: "Today's report is due", body: `Submit your daily report for ${today} before ${time}.`, link: '/daily/today', key: `daily_${today}` });
        } else if (c.task) {
          notify(tx, ctx, settings, { userId: c.userId, type: 'TASK_OVERDUE', title: 'Task overdue', body: `"${c.task.title}" was due on ${c.task.dueDate} and is not completed.`, link: `/reports/daily/${c.task.reportId}`, key: `${c.task.reportId}_${c.task.slot}` });
        }
      }
    });
  }
  return {
    ran: true,
    deadlineReminders: fresh.filter((c) => c.kind === 'deadline').length,
    overdueNotices: fresh.filter((c) => c.kind === 'overdue').length,
    date: today,
  };
}
