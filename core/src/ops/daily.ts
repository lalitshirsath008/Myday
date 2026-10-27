import { z } from 'zod';
import { dailyDeadline, resolveWorkingDay } from '../calendar';
import { diffDays, intervalMinutes, todayIn, type DateStr } from '../dates';
import { AppError, conflict, deny, invalid, notFound, precondition } from '../errors';
import { canViewEmployee, isAssignedReviewer } from '../permissions';
import { dailySaveInput, dateStr, type TaskInput } from '../schemas';
import { maxTasksPerReport } from '../settings';
import { queryIn } from '../store';
import {
  COL,
  REVIEW_STATUSES,
  TASK_STATUSES,
  type DailyReportDoc,
  type ProjectDoc,
  type ReviewDoc,
  type SystemSettings,
  type TaskDoc,
  type TaskEntry,
  type UniqueKeyDoc,
  type UserDoc,
} from '../types';
import { nowIso, op, type AuthedCtx } from './context';
import {
  audit,
  getExceptions,
  getSettings,
  getViewableEmployee,
  notify,
  projectsById,
  scopedEmployees,
  usersById,
  userSummary,
} from './helpers';
import {
  editBlockReason,
  getVersion,
  initialReviewFields,
  listVersions,
  submissionPatch,
  writeVersion,
} from './reportCommon';

export const dailyKey = (employeeId: string, workDate: DateStr) => `daily_${employeeId}_${workDate}`;

export interface TaskIssue {
  field: keyof TaskInput;
  message: string;
}

/** Cross-field task rules shared by the form and the server. */
export function taskIssues(t: TaskInput, s: Pick<SystemSettings, 'allowOvernightTasks' | 'taskCategories'>): TaskIssue[] {
  const issues: TaskIssue[] = [];
  const overnight = s.allowOvernightTasks && t.overnight;
  const pair = (start: string | null, end: string | null, label: string, endField: keyof TaskInput) => {
    if ((start === null) !== (end === null)) {
      issues.push({ field: endField, message: `Enter both ${label} start and end times` });
    } else if (start && end && intervalMinutes(start, end, overnight) === null) {
      issues.push({
        field: endField,
        message: s.allowOvernightTasks
          ? `${label} end time must be after start time (tick "Overnight" for work past midnight)`
          : `${label} end time must be after start time`,
      });
    }
  };
  pair(t.plannedStartTime, t.plannedEndTime, 'Planned', 'plannedEndTime');
  pair(t.actualStartTime, t.actualEndTime, 'Actual', 'actualEndTime');
  if (t.overnight && !s.allowOvernightTasks) issues.push({ field: 'overnight', message: 'Overnight work is not enabled' });
  if (t.status === 'COMPLETED' && t.progressPercentage !== 100) {
    issues.push({ field: 'progressPercentage', message: 'Completed tasks must be at 100% progress' });
  }
  if (t.status !== 'COMPLETED' && t.progressPercentage === 100) {
    issues.push({ field: 'status', message: 'Mark the task Completed or lower the progress below 100%' });
  }
  if (t.category && !s.taskCategories.includes(t.category)) issues.push({ field: 'category', message: 'Unknown task category' });
  return issues;
}

function toTaskEntries(tasks: TaskInput[], employee: UserDoc, s: SystemSettings): TaskEntry[] {
  return tasks.map((t, i) => ({
    ...t,
    overnight: s.allowOvernightTasks && t.overnight,
    slot: i + 1,
    isPrimary: i < s.primaryTaskSlots,
    departmentId: employee.departmentId,
    collaboratorIds: [...new Set(t.collaboratorIds)].filter((c) => c !== employee.id),
  }));
}

function taskDocs(report: DailyReportDoc, nowIsoStr: string): TaskDoc[] {
  return report.tasks.map((t) => ({
    ...t,
    id: `${report.id}_${t.slot}`,
    reportId: report.id,
    employeeId: report.employeeId,
    workDate: report.workDate,
    reportVersion: report.version,
    submittedAt: report.submittedAt,
    createdAt: report.createdAt,
    updatedAt: nowIsoStr,
  }));
}

/** Replace the task index rows of a report (only submitted content is indexed). */
export function syncTaskIndex(tx: import('../store').Tx, report: DailyReportDoc, previousCount: number, nowIsoStr: string): void {
  for (const t of taskDocs(report, nowIsoStr)) tx.set(COL.tasks, t.id, t as unknown as TaskDoc & { id: string });
  for (let slot = report.tasks.length + 1; slot <= previousCount; slot++) tx.delete(COL.tasks, `${report.id}_${slot}`);
}

/** Validate collaborators and projects referenced by tasks. */
export async function validateReferences(ctx: AuthedCtx, tasks: TaskInput[], previous: TaskEntry[] = []): Promise<void> {
  const collabIds = [...new Set(tasks.flatMap((t) => t.collaboratorIds))];
  const users = await usersById(ctx, collabIds);
  for (const id of collabIds) {
    const u = users.get(id);
    if (!u || u.accountStatus !== 'ACTIVE') throw invalid('One of the selected collaborators is not an active employee.');
  }
  const projectIds = [...new Set(tasks.map((t) => t.projectId).filter((x): x is string => !!x))];
  const projects = await projectsById(ctx, projectIds);
  const previousIds = new Set(previous.map((t) => t.projectId));
  for (const id of projectIds) {
    const p = projects.get(id);
    if (!p) throw invalid('One of the selected projects does not exist.');
    const usable = p.status === 'ACTIVE' || p.status === 'ON_HOLD' || (p.status === 'PROPOSED' && p.requestedBy === ctx.actor.id);
    if (!usable && !previousIds.has(id)) throw invalid(`Project "${p.name}" is ${p.status.toLowerCase()} and cannot take new tasks.`);
  }
}

async function findReportId(ctx: AuthedCtx, employeeId: string, workDate: DateStr): Promise<string | null> {
  const key = await ctx.store.get<UniqueKeyDoc & { id: string }>(COL.uniqueKeys, dailyKey(employeeId, workDate));
  return key?.ownerId ?? null;
}

export function summarizeDaily(r: DailyReportDoc) {
  return {
    id: r.id,
    employeeId: r.employeeId,
    employeeName: r.employeeName,
    employeeCode: r.employeeCode,
    departmentId: r.departmentId,
    workDate: r.workDate,
    isHolidayWork: r.isHolidayWork,
    taskCount: r.tasks.length,
    completed: r.tasks.filter((t) => t.status === 'COMPLETED').length,
    inProgress: r.tasks.filter((t) => t.status === 'IN_PROGRESS').length,
    blocked: r.tasks.filter((t) => t.status === 'BLOCKED').length,
    titles: r.tasks.map((t) => t.title),
    projectIds: r.projectIds,
    submissionStatus: r.submissionStatus,
    reviewStatus: r.reviewStatus,
    version: r.version,
    submittedAt: r.submittedAt,
    submittedLate: r.submittedLate,
    lastReviewComment: r.lastReviewComment,
    needsReReview: r.needsReReview,
    updatedAt: r.updatedAt,
  };
}
export type DailySummaryRow = ReturnType<typeof summarizeDaily>;

const MAX_RANGE_DAYS = 92;
const MAX_SCAN = 5000;

export const dailyListInput = z.object({
  from: dateStr,
  to: dateStr,
  employeeId: z.string().nullable().default(null),
  departmentId: z.string().nullable().default(null),
  reviewStatus: z.enum(REVIEW_STATUSES).nullable().default(null),
  projectId: z.string().nullable().default(null),
  taskStatus: z.enum(TASK_STATUSES).nullable().default(null),
  includeDrafts: z.boolean().default(false),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

/** Daily reports within the actor's scope. Shared by history, review queues, admin and exports. */
export async function scopedDailyReports(ctx: AuthedCtx, f: z.output<typeof dailyListInput>): Promise<DailyReportDoc[]> {
  if (f.from > f.to) throw invalid('Start date must be on or before end date');
  if (diffDays(f.from, f.to) + 1 > MAX_RANGE_DAYS) throw invalid(`Choose a range of at most ${MAX_RANGE_DAYS} days.`);
  const range = { where: [['workDate', '>=', f.from], ['workDate', '<=', f.to]] as [string, '>=' | '<=', string][] };
  let docs: DailyReportDoc[];
  if (f.employeeId) {
    await getViewableEmployee(ctx, f.employeeId);
    docs = await ctx.store.query<DailyReportDoc & { id: string }>(COL.dailyReports, {
      where: [['employeeId', '==', f.employeeId], ...range.where],
    });
  } else if (ctx.actor.role === 'MANAGEMENT' || ctx.actor.role === 'SUPER_ADMIN') {
    docs = await ctx.store.query<DailyReportDoc & { id: string }>(COL.dailyReports, {
      where: [...(f.departmentId ? [['departmentId', '==', f.departmentId] as [string, '==', string]] : []), ...range.where],
      limit: MAX_SCAN + 1,
    });
  } else {
    const team = await scopedEmployees(ctx, { includeInactive: true });
    docs = await queryIn<DailyReportDoc & { id: string }>(ctx.store, COL.dailyReports, 'employeeId', team.map((u) => u.id), range);
  }
  if (docs.length > MAX_SCAN) {
    throw new AppError('resource-exhausted', 'Too many reports match. Narrow the date range or filter by department.');
  }
  const own = (r: DailyReportDoc) => r.employeeId === ctx.actor.id;
  return docs
    .filter((r) => f.includeDrafts ? own(r) || r.submissionStatus === 'SUBMITTED' : r.submissionStatus === 'SUBMITTED' || (own(r) && f.employeeId === ctx.actor.id))
    .filter((r) => !f.departmentId || r.departmentId === f.departmentId)
    .filter((r) => !f.reviewStatus || r.reviewStatus === f.reviewStatus)
    .filter((r) => !f.projectId || r.projectIds.includes(f.projectId))
    .filter((r) => !f.taskStatus || r.tasks.some((t) => t.status === f.taskStatus))
    .sort((a, b) => (a.workDate === b.workDate ? a.employeeName.localeCompare(b.employeeName) : a.workDate < b.workDate ? 1 : -1));
}

export const dailyOps = {
  'daily.getForDate': op({
    input: z.object({ workDate: dateStr }),
    run: async (ctx, { workDate }) => {
      const settings = await getSettings(ctx);
      const today = todayIn(settings.timezone, ctx.now());
      const [exceptions, reportId] = await Promise.all([getExceptions(ctx, workDate, workDate), findReportId(ctx, ctx.actor.id, workDate)]);
      const report = reportId ? await ctx.store.get<DailyReportDoc & { id: string }>(COL.dailyReports, reportId) : null;
      const workingDay = resolveWorkingDay(workDate, settings.calendarPolicies, exceptions, ctx.actor.departmentId);
      const deadline = dailyDeadline(workDate, settings);
      let blockReason: string | null = report ? editBlockReason(report) : null;
      if (!settings.reportingRoles.includes(ctx.actor.role)) blockReason = 'Your role does not submit daily reports.';
      else if (workDate > today) blockReason = 'You cannot report for a future date.';
      else if (diffDays(workDate, today) > settings.maxBackdateDays && !report) {
        blockReason = `Reports older than ${settings.maxBackdateDays} days are closed. Ask your administrator if you need the reporting window extended.`;
      }
      const reviews = report
        ? await ctx.store.query<ReviewDoc & { id: string }>(COL.reportReviews, {
            where: [['reportId', '==', report.id], ['reportType', '==', 'DAILY']],
            orderBy: [['createdAt', 'asc']],
          })
        : [];
      return {
        workDate,
        today,
        report,
        reviews,
        workingDay,
        deadline: deadline.toISOString(),
        pastDeadline: ctx.now() > deadline,
        editable: blockReason === null,
        blockReason,
        maxTasks: maxTasksPerReport(settings),
      };
    },
  }),

  'daily.save': op({
    input: dailySaveInput,
    run: async (ctx, input) => {
      const settings = await getSettings(ctx);
      const me = ctx.actor;
      if (!settings.reportingRoles.includes(me.role)) throw deny('Your role does not submit daily reports.');
      const today = todayIn(settings.timezone, ctx.now());
      if (input.workDate > today) throw invalid('You cannot report for a future date.');
      const max = maxTasksPerReport(settings);
      if (input.tasks.length > max) throw invalid(`At most ${max} tasks per daily report.`);
      if (input.submit) {
        const requiredSlots = Math.max(settings.minTasksForSubmission, settings.primaryTaskSlots || 3);
        if (input.tasks.length < requiredSlots) {
          throw invalid(`Please fill all ${requiredSlots} priority tasks before submitting.`);
        }
        for (let i = 0; i < requiredSlots; i++) {
          const taskItem = input.tasks[i];
          if (!taskItem || !taskItem.title.trim()) {
            throw invalid(`Priority Task ${i + 1} is required before submitting.`, { task: i, field: 'title' });
          }
        }
      }
      input.tasks.forEach((t, i) => {
        const issue = taskIssues(t, settings)[0];
        if (issue) throw invalid(`Task ${i + 1}: ${issue.message}`, { task: i, field: issue.field });
      });

      const reportId = await findReportId(ctx, me.id, input.workDate);
      const existingPre = reportId ? await ctx.store.get<DailyReportDoc & { id: string }>(COL.dailyReports, reportId) : null;
      if (!existingPre && diffDays(input.workDate, today) > settings.maxBackdateDays) {
        throw deny(`Reports older than ${settings.maxBackdateDays} days are closed. Ask your administrator if you need the reporting window extended.`);
      }
      await validateReferences(ctx, input.tasks, existingPre?.tasks);
      const exceptions = await getExceptions(ctx, input.workDate, input.workDate);
      const workingDay = resolveWorkingDay(input.workDate, settings.calendarPolicies, exceptions, me.departmentId);
      const late = ctx.now() > dailyDeadline(input.workDate, settings);
      const now = nowIso(ctx);

      const saved = await ctx.store.transaction(async (tx) => {
        const id = reportId ?? globalThis.crypto.randomUUID();
        const existing = await tx.get<DailyReportDoc & { id: string }>(COL.dailyReports, id);
        if (existing) {
          const block = editBlockReason(existing);
          if (block) throw precondition(block);
          if (input.expectedRevision !== existing.revision) throw conflict();
        } else if (input.expectedRevision !== null) {
          throw conflict();
        }
        const tasks = toTaskEntries(input.tasks, me, settings);
        const base: DailyReportDoc = existing ?? {
          id,
          employeeId: me.id,
          employeeName: me.fullName,
          employeeCode: me.employeeCode,
          departmentId: me.departmentId,
          workDate: input.workDate,
          timezone: settings.timezone,
          workingDay,
          isHolidayWork: !workingDay.isWorkingDay,
          tasks: [],
          projectIds: [],
          employeeNotes: '',
          ...initialReviewFields(now, me),
        };
        let report: DailyReportDoc = {
          ...base,
          employeeName: me.fullName,
          employeeCode: me.employeeCode,
          departmentId: me.departmentId,
          workingDay,
          isHolidayWork: !workingDay.isWorkingDay,
          tasks,
          projectIds: [...new Set(tasks.map((t) => t.projectId).filter((x): x is string => !!x))],
          employeeNotes: input.employeeNotes,
          revision: base.revision + 1,
          updatedAt: now,
        };
        if (!existing) tx.create(COL.uniqueKeys, dailyKey(me.id, input.workDate), { id: dailyKey(me.id, input.workDate), ownerId: id, createdAt: now });
        // Tell people they were added as a collaborator, once: only when they were not already on that task.
        const added = new Map<string, string[]>();
        tasks.forEach((t, i) => {
          const before = new Set(existing?.tasks[i]?.collaboratorIds ?? []);
          for (const c of t.collaboratorIds) if (!before.has(c)) added.set(c, [...(added.get(c) ?? []), t.title.trim() || `Task ${i + 1}`]);
        });
        for (const [userId, titles] of added) {
          notify(tx, ctx, settings, {
            userId,
            type: 'COLLABORATOR_ADDED',
            title: 'Added as a collaborator',
            body: `${me.fullName} added you to ${titles.map((t) => `“${t}”`).join(', ')} on ${input.workDate}.`,
            link: null,
            key: `${id}_${titles.join('|')}`,
          });
        }
        if (input.submit) {
          const resubmission = report.version > 0;
          report = { ...report, ...submissionPatch(ctx, report, me, late) };
          writeVersion(tx, ctx, 'DAILY', report as unknown as DailyReportDoc & Record<string, unknown>, report.version, 'EMPLOYEE_SUBMISSION', resubmission ? 'Resubmitted after correction' : 'Submitted');
          syncTaskIndex(tx, report, existing && existing.version > 0 ? existing.tasks.length : 0, now);
          audit(tx, ctx, {
            action: resubmission ? 'DAILY_REPORT_RESUBMITTED' : 'DAILY_REPORT_SUBMITTED',
            entityType: 'dailyReport',
            entityId: id,
            afterSnapshot: { workDate: report.workDate, version: report.version, tasks: tasks.length, late },
          });
          const link = `/reviews/daily/${id}`;
          for (const reviewer of new Set([me.primaryReportingManagerId, me.secondaryReviewerId])) {
            notify(tx, ctx, settings, {
              userId: reviewer,
              type: 'REVIEW_REQUESTED',
              title: 'Daily report awaiting review',
              body: `${me.fullName} submitted the daily report for ${input.workDate}.`,
              link,
              key: `${id}_v${report.version}`,
            });
          }
          notify(tx, ctx, settings, {
            userId: me.id,
            type: 'DAILY_SUBMITTED',
            title: 'Daily report submitted',
            body: `Your report for ${input.workDate} was submitted${late ? ' after the deadline' : ''}.`,
            link: `/reports/daily/${id}`,
            key: `${id}_v${report.version}`,
          });
        }
        tx.set(COL.dailyReports, id, report as unknown as DailyReportDoc & { id: string });
        return report;
      });
      return { report: saved };
    },
  }),

  'daily.get': op({
    input: z.object({ reportId: z.string().min(1) }),
    run: async (ctx, { reportId }) => {
      const report = await ctx.store.get<DailyReportDoc & { id: string }>(COL.dailyReports, reportId);
      if (!report) throw notFound('Daily report');
      const employee = await getViewableEmployee(ctx, report.employeeId);
      if (report.submissionStatus === 'DRAFT' && employee.id !== ctx.actor.id) throw notFound('Daily report');
      const [reviews, versions] = await Promise.all([
        ctx.store.query<ReviewDoc & { id: string }>(COL.reportReviews, {
          where: [['reportId', '==', reportId], ['reportType', '==', 'DAILY']],
          orderBy: [['createdAt', 'asc']],
        }),
        listVersions(ctx, 'DAILY', reportId),
      ]);
      const people = await usersById(ctx, [
        ...report.tasks.flatMap((t) => t.collaboratorIds),
        employee.primaryReportingManagerId,
        employee.secondaryReviewerId,
      ]);
      const projects = await projectsById(ctx, report.projectIds);
      return {
        report,
        employee: userSummary(employee),
        primaryManager: employee.primaryReportingManagerId ? (people.get(employee.primaryReportingManagerId)?.fullName ?? null) : null,
        reviews,
        versions,
        people: Object.fromEntries([...people.values()].map((u) => [u.id, { fullName: u.fullName, employeeCode: u.employeeCode }])),
        projects: Object.fromEntries([...projects.values()].map((p: ProjectDoc) => [p.id, { name: p.name, code: p.code }])),
        canReview: isAssignedReviewer(ctx.actor, employee),
        isOwner: employee.id === ctx.actor.id,
        canCorrect: ctx.actor.role === 'SUPER_ADMIN',
      };
    },
  }),

  'daily.version': op({
    input: z.object({ reportId: z.string(), version: z.number().int().min(1) }),
    run: async (ctx, { reportId, version }) => {
      const v = await getVersion(ctx, 'DAILY', reportId, version);
      const employee = await ctx.store.get<UserDoc & { id: string }>(COL.users, v.employeeId);
      if (!employee || !canViewEmployee(ctx.actor, employee)) throw deny();
      return v;
    },
  }),

  'daily.list': op({
    input: dailyListInput,
    run: async (ctx, f) => {
      const all = await scopedDailyReports(ctx, f);
      return { total: all.length, items: all.slice(f.offset, f.offset + f.limit).map(summarizeDaily) };
    },
  }),
};
