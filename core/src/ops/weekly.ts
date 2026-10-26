import { z } from 'zod';
import { dailyDeadline, weekPeriod, weeklyDeadline, workingDatesInRange } from '../calendar';
import { addDays, diffDays, todayIn, weekStartFor, type DateStr } from '../dates';
import { AppError, conflict, deny, invalid, notFound, precondition } from '../errors';
import { isOverdue, isSubmitted, projectBreakdown, taskStats } from '../metrics';
import { canViewEmployee, isAssignedReviewer } from '../permissions';
import { dateStr, weeklySaveInput } from '../schemas';
import { queryIn } from '../store';
import {
  COL,
  REVIEW_STATUSES,
  type DailyReportDoc,
  type ReviewDoc,
  type SystemSettings,
  type UserDoc,
  type WeeklyNarrative,
  type WeeklyReportDoc,
  type WeeklySummary,
} from '../types';
import { nowIso, op, type AuthedCtx, type Ctx } from './context';
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
import { editBlockReason, getVersion, initialReviewFields, listVersions, submissionPatch, writeVersion } from './reportCommon';

export const EMPTY_NARRATIVE: WeeklyNarrative = {
  majorAccomplishments: '',
  projectProgress: '',
  keyDeliverables: '',
  blockers: '',
  decisionsRequired: '',
  collaborationSummary: '',
  nextWeekPlan: '',
  employeeComments: '',
};

const MAX_WEEKS_BACK = 8;

/** Compile the automatic part of a weekly report from submitted daily reports and the work calendar. */
export async function computeWeeklySummary(
  ctx: Ctx,
  employee: UserDoc,
  periodStart: DateStr,
  settings: SystemSettings,
): Promise<{ summary: WeeklySummary; dailyReportIds: string[]; periodEnd: DateStr }> {
  const periodEnd = addDays(periodStart, 6);
  const [exceptions, reports] = await Promise.all([
    getExceptions(ctx, periodStart, periodEnd),
    ctx.store.query<DailyReportDoc & { id: string }>(COL.dailyReports, {
      where: [['employeeId', '==', employee.id], ['workDate', '>=', periodStart], ['workDate', '<=', periodEnd]],
    }),
  ]);
  const submitted = reports.filter(isSubmitted).sort((a, b) => a.workDate.localeCompare(b.workDate));
  const workingDates = workingDatesInRange(periodStart, periodEnd, settings.calendarPolicies, exceptions, employee.departmentId);
  const submittedDates = new Set(submitted.map((r) => r.workDate));
  const now = ctx.now();
  const today = todayIn(settings.timezone, now);
  const missing = workingDates.filter((d) => !submittedDates.has(d) && now > dailyDeadline(d, settings));
  const tasks = submitted.flatMap((r) => r.tasks);
  const stats = taskStats(tasks, today);
  const projects = await projectsById(ctx, [...new Set(tasks.map((t) => t.projectId))]);
  const collabCounts = new Map<string, number>();
  for (const t of tasks) for (const c of t.collaboratorIds) collabCounts.set(c, (collabCounts.get(c) ?? 0) + 1);
  const collabUsers = await usersById(ctx, [...collabCounts.keys()]);
  const summary: WeeklySummary = {
    workingDays: workingDates.length,
    workingDates,
    dailyReportsSubmitted: submitted.filter((r) => workingDates.includes(r.workDate)).length,
    holidayWorkReports: submitted.filter((r) => !workingDates.includes(r.workDate)).length,
    missingReportDates: missing,
    tasksPlanned: stats.planned,
    tasksCompleted: stats.completed,
    tasksInProgress: stats.inProgress,
    tasksPending: stats.pending,
    tasksBlocked: stats.blocked,
    tasksOverdue: tasks.filter((t) => isOverdue(t, today)).length,
    averageProgress: stats.averageProgress,
    projects: projectBreakdown(submitted, new Map([...projects.values()].map((p) => [p.id, p.name]))),
    collaborators: [...collabCounts.entries()]
      .map(([id, n]) => ({ id, name: collabUsers.get(id)?.fullName ?? 'Unknown', tasks: n }))
      .sort((a, b) => b.tasks - a.tasks),
    calculatedAt: now.toISOString(),
  };
  return { summary, dailyReportIds: submitted.map((r) => r.id), periodEnd };
}

/** The weekly report can be submitted once its last working day (or last day, if none) has arrived. */
function submitOpensOn(summary: WeeklySummary, periodEnd: DateStr): DateStr {
  return summary.workingDates[summary.workingDates.length - 1] ?? periodEnd;
}

const weeklyId = (employeeId: string, periodStart: DateStr) => `${employeeId}_${periodStart}`;

function checkPeriod(periodStart: DateStr, settings: SystemSettings, today: DateStr): void {
  if (weekStartFor(periodStart, settings.weekStartDay) !== periodStart) throw invalid('The reporting period must start on the configured first day of the week.');
  if (periodStart > today) throw invalid('You cannot create a weekly report for a future week.');
}

export function summarizeWeekly(r: WeeklyReportDoc) {
  return {
    id: r.id,
    employeeId: r.employeeId,
    employeeName: r.employeeName,
    employeeCode: r.employeeCode,
    departmentId: r.departmentId,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    workingDays: r.calculatedSummary.workingDays,
    dailyReportsSubmitted: r.calculatedSummary.dailyReportsSubmitted,
    tasksPlanned: r.calculatedSummary.tasksPlanned,
    tasksCompleted: r.calculatedSummary.tasksCompleted,
    submissionStatus: r.submissionStatus,
    reviewStatus: r.reviewStatus,
    version: r.version,
    submittedAt: r.submittedAt,
    submittedLate: r.submittedLate,
    lastReviewComment: r.lastReviewComment,
    needsReReview: r.needsReReview,
  };
}
export type WeeklySummaryRow = ReturnType<typeof summarizeWeekly>;

export const weeklyListInput = z.object({
  from: dateStr,
  to: dateStr,
  employeeId: z.string().nullable().default(null),
  departmentId: z.string().nullable().default(null),
  reviewStatus: z.enum(REVIEW_STATUSES).nullable().default(null),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export async function scopedWeeklyReports(ctx: AuthedCtx, f: z.output<typeof weeklyListInput>): Promise<WeeklyReportDoc[]> {
  if (f.from > f.to) throw invalid('Start date must be on or before end date');
  if (diffDays(f.from, f.to) > 370) throw invalid('Choose a range of at most one year.');
  const range: [string, '>=' | '<=', string][] = [['periodStart', '>=', f.from], ['periodStart', '<=', f.to]];
  let docs: WeeklyReportDoc[];
  if (f.employeeId) {
    await getViewableEmployee(ctx, f.employeeId);
    docs = await ctx.store.query<WeeklyReportDoc & { id: string }>(COL.weeklyReports, { where: [['employeeId', '==', f.employeeId], ...range] });
  } else if (ctx.actor.role === 'MANAGEMENT' || ctx.actor.role === 'SUPER_ADMIN') {
    docs = await ctx.store.query<WeeklyReportDoc & { id: string }>(COL.weeklyReports, {
      where: [...(f.departmentId ? [['departmentId', '==', f.departmentId] as [string, '==', string]] : []), ...range],
      limit: 5001,
    });
    if (docs.length > 5000) throw new AppError('resource-exhausted', 'Too many reports match. Narrow the date range or filter by department.');
  } else {
    const team = await scopedEmployees(ctx, { includeInactive: true });
    docs = await queryIn<WeeklyReportDoc & { id: string }>(ctx.store, COL.weeklyReports, 'employeeId', team.map((u) => u.id), { where: range });
  }
  return docs
    .filter((r) => r.submissionStatus === 'SUBMITTED' || r.employeeId === ctx.actor.id)
    .filter((r) => !f.departmentId || r.departmentId === f.departmentId)
    .filter((r) => !f.reviewStatus || r.reviewStatus === f.reviewStatus)
    .sort((a, b) => (a.periodStart === b.periodStart ? a.employeeName.localeCompare(b.employeeName) : a.periodStart < b.periodStart ? 1 : -1));
}

export const weeklyOps = {
  /** Auto-compiled summary plus any saved report for the period (own reports). */
  'weekly.preview': op({
    input: z.object({ periodStart: dateStr.nullable().default(null) }),
    run: async (ctx, input) => {
      const settings = await getSettings(ctx);
      if (!settings.reportingRoles.includes(ctx.actor.role)) throw deny('Your role does not submit weekly reports.');
      const today = todayIn(settings.timezone, ctx.now());
      const periodStart = input.periodStart ?? weekPeriod(today, settings).periodStart;
      checkPeriod(periodStart, settings, today);
      const { summary, periodEnd } = await computeWeeklySummary(ctx, ctx.actor, periodStart, settings);
      const report = await ctx.store.get<WeeklyReportDoc & { id: string }>(COL.weeklyReports, weeklyId(ctx.actor.id, periodStart));
      const opensOn = submitOpensOn(summary, periodEnd);
      let blockReason = report ? editBlockReason(report) : null;
      if (!blockReason && diffDays(periodStart, today) > MAX_WEEKS_BACK * 7) blockReason = `Weekly reports older than ${MAX_WEEKS_BACK} weeks can only be changed by an administrator.`;
      const reviews = report
        ? await ctx.store.query<ReviewDoc & { id: string }>(COL.reportReviews, {
            where: [['reportId', '==', report.id], ['reportType', '==', 'WEEKLY']],
            orderBy: [['createdAt', 'asc']],
          })
        : [];
      return {
        periodStart,
        periodEnd,
        today,
        summary,
        report,
        reviews,
        deadline: weeklyDeadline(periodEnd, settings).toISOString(),
        submitOpensOn: opensOn,
        canSubmitNow: today >= opensOn,
        editable: blockReason === null,
        blockReason,
        weekStartDay: settings.weekStartDay,
      };
    },
  }),

  'weekly.save': op({
    input: weeklySaveInput,
    run: async (ctx, input) => {
      const settings = await getSettings(ctx);
      const me = ctx.actor;
      if (!settings.reportingRoles.includes(me.role)) throw deny('Your role does not submit weekly reports.');
      const today = todayIn(settings.timezone, ctx.now());
      checkPeriod(input.periodStart, settings, today);
      if (diffDays(input.periodStart, today) > MAX_WEEKS_BACK * 7) throw deny(`Weekly reports older than ${MAX_WEEKS_BACK} weeks can only be changed by an administrator.`);
      const { summary, dailyReportIds, periodEnd } = await computeWeeklySummary(ctx, me, input.periodStart, settings);
      if (input.submit) {
        if (today < submitOpensOn(summary, periodEnd)) throw precondition(`You can submit this weekly report from ${submitOpensOn(summary, periodEnd)}.`);
        if (!input.narrative.majorAccomplishments.trim()) throw invalid('Major accomplishments are required before submitting.');
        if (!input.narrative.nextWeekPlan.trim()) throw invalid("Next week's plan is required before submitting.");
      }
      const late = ctx.now() > weeklyDeadline(periodEnd, settings);
      const id = weeklyId(me.id, input.periodStart);
      const now = nowIso(ctx);
      const saved = await ctx.store.transaction(async (tx) => {
        const existing = await tx.get<WeeklyReportDoc & { id: string }>(COL.weeklyReports, id);
        if (existing) {
          const block = editBlockReason(existing);
          if (block) throw precondition(block);
          if (input.expectedRevision !== existing.revision) throw conflict();
        } else if (input.expectedRevision !== null) {
          throw conflict();
        }
        const base: WeeklyReportDoc = existing ?? {
          id,
          employeeId: me.id,
          employeeName: me.fullName,
          employeeCode: me.employeeCode,
          departmentId: me.departmentId,
          periodStart: input.periodStart,
          periodEnd,
          dailyReportIds: [],
          calculatedSummary: summary,
          narrative: EMPTY_NARRATIVE,
          ...initialReviewFields(now, me),
        };
        let report: WeeklyReportDoc = {
          ...base,
          employeeName: me.fullName,
          employeeCode: me.employeeCode,
          departmentId: me.departmentId,
          calculatedSummary: summary,
          dailyReportIds,
          narrative: { ...EMPTY_NARRATIVE, ...input.narrative },
          revision: base.revision + 1,
          updatedAt: now,
        };
        if (input.submit) {
          const resubmission = report.version > 0;
          report = { ...report, ...submissionPatch(ctx, report, me, late) };
          writeVersion(tx, ctx, 'WEEKLY', report as unknown as WeeklyReportDoc & Record<string, unknown>, report.version, 'EMPLOYEE_SUBMISSION', resubmission ? 'Resubmitted after correction' : 'Submitted');
          audit(tx, ctx, {
            action: resubmission ? 'WEEKLY_REPORT_RESUBMITTED' : 'WEEKLY_REPORT_SUBMITTED',
            entityType: 'weeklyReport',
            entityId: id,
            afterSnapshot: { periodStart: report.periodStart, version: report.version, late },
          });
          for (const reviewer of new Set([me.primaryReportingManagerId, me.secondaryReviewerId])) {
            notify(tx, ctx, settings, {
              userId: reviewer,
              type: 'REVIEW_REQUESTED',
              title: 'Weekly report awaiting review',
              body: `${me.fullName} submitted the weekly report for ${report.periodStart} – ${report.periodEnd}.`,
              link: `/reviews/weekly/${id}`,
              key: `${id}_v${report.version}`,
            });
          }
          notify(tx, ctx, settings, {
            userId: me.id,
            type: 'WEEKLY_SUBMITTED',
            title: 'Weekly report submitted',
            body: `Your weekly report for ${report.periodStart} – ${report.periodEnd} was submitted.`,
            link: `/reports/weekly/${id}`,
            key: `${id}_v${report.version}`,
          });
        }
        tx.set(COL.weeklyReports, id, report as unknown as WeeklyReportDoc & { id: string });
        return report;
      });
      return { report: saved };
    },
  }),

  'weekly.get': op({
    input: z.object({ reportId: z.string().min(1) }),
    run: async (ctx, { reportId }) => {
      const report = await ctx.store.get<WeeklyReportDoc & { id: string }>(COL.weeklyReports, reportId);
      if (!report) throw notFound('Weekly report');
      const employee = await getViewableEmployee(ctx, report.employeeId);
      if (report.submissionStatus === 'DRAFT' && employee.id !== ctx.actor.id) throw notFound('Weekly report');
      const [reviews, versions, people] = await Promise.all([
        ctx.store.query<ReviewDoc & { id: string }>(COL.reportReviews, {
          where: [['reportId', '==', reportId], ['reportType', '==', 'WEEKLY']],
          orderBy: [['createdAt', 'asc']],
        }),
        listVersions(ctx, 'WEEKLY', reportId),
        usersById(ctx, [employee.primaryReportingManagerId, employee.secondaryReviewerId]),
      ]);
      const dept = await ctx.store.get<{ id: string; name: string }>(COL.departments, employee.departmentId);
      return {
        report,
        employee: userSummary(employee),
        departmentName: dept?.name ?? '',
        primaryManager: employee.primaryReportingManagerId ? (people.get(employee.primaryReportingManagerId)?.fullName ?? null) : null,
        reviews,
        versions,
        canReview: isAssignedReviewer(ctx.actor, employee),
        isOwner: employee.id === ctx.actor.id,
        canCorrect: ctx.actor.role === 'SUPER_ADMIN',
      };
    },
  }),

  'weekly.version': op({
    input: z.object({ reportId: z.string(), version: z.number().int().min(1) }),
    run: async (ctx, { reportId, version }) => {
      const v = await getVersion(ctx, 'WEEKLY', reportId, version);
      const employee = await ctx.store.get<UserDoc & { id: string }>(COL.users, v.employeeId);
      if (!employee || !canViewEmployee(ctx.actor, employee)) throw deny();
      return v;
    },
  }),

  'weekly.list': op({
    input: weeklyListInput,
    run: async (ctx, f) => {
      const all = await scopedWeeklyReports(ctx, f);
      return { total: all.length, items: all.slice(f.offset, f.offset + f.limit).map(summarizeWeekly) };
    },
  }),
};
