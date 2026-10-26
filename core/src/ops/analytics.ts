import { z } from 'zod';
import { dailyDeadline, isExpectedReporter, resolveWorkingDay, weekPeriod, weeklyDeadline, workingDatesInRange } from '../calendar';
import { addDays, dateRange, diffDays, maxDate, minDate, todayIn, weekStartFor, type DateStr } from '../dates';
import { AppError, deny, invalid } from '../errors';
import {
  combineCompliance,
  dailyCompliance,
  isOverdue,
  isSubmitted,
  latestTaskStates,
  projectHistory,
  taskStats,
  type ComplianceSummary,
  type TaskRecord,
} from '../metrics';
import { can } from '../permissions';
import { dateRangeInput, dateStr } from '../schemas';
import { queryIn } from '../store';
import {
  ACCOUNT_STATUSES,
  COL,
  ROLES,
  TASK_STATUSES,
  type CalendarExceptionDoc,
  type DailyReportDoc,
  type DepartmentDoc,
  type ProjectDoc,
  type SystemSettings,
  type TaskDoc,
  type TaskEntry,
  type UserDoc,
  type WeeklyReportDoc,
} from '../types';
import { op, requirePermission, type AuthedCtx } from './context';
import { dailyListInput, scopedDailyReports, summarizeDaily } from './daily';
import {
  allDepartments,
  assignedEmployees,
  audit,
  getExceptions,
  getSettings,
  getViewableEmployee,
  normalizeName,
  scopedEmployees,
  userProfile,
  usersById,
  userSummary,
} from './helpers';
import { scopedWeeklyReports, summarizeWeekly, weeklyListInput } from './weekly';

const MAX_ANALYTICS_DAYS = 92;
const OUTSTANDING_LOOKBACK_DAYS = 30;

export type TaskRow = TaskEntry & { employeeId: string; workDate: DateStr; reportId: string };

export function flattenTasks(reports: DailyReportDoc[]): TaskRow[] {
  return reports.flatMap((r) => r.tasks.map((t) => ({ ...t, employeeId: r.employeeId, workDate: r.workDate, reportId: r.id })));
}

function checkRange(from: DateStr, to: DateStr): void {
  if (diffDays(from, to) + 1 > MAX_ANALYTICS_DAYS) throw invalid(`Choose a range of at most ${MAX_ANALYTICS_DAYS} days.`);
}

/** Submitted daily reports for a set of users. Uses a date-range scan for large groups. */
async function loadDaily(ctx: AuthedCtx, users: UserDoc[], from: DateStr, to: DateStr): Promise<DailyReportDoc[]> {
  const ids = new Set(users.map((u) => u.id));
  let docs: DailyReportDoc[];
  if (users.length > 60) {
    docs = await ctx.store.query<DailyReportDoc & { id: string }>(COL.dailyReports, {
      where: [['workDate', '>=', from], ['workDate', '<=', to]],
      limit: 20_001,
    });
    if (docs.length > 20_000) throw new AppError('resource-exhausted', 'Too much data for one view. Narrow the date range or select a department.');
  } else {
    docs = await queryIn<DailyReportDoc & { id: string }>(ctx.store, COL.dailyReports, 'employeeId', [...ids], {
      where: [['workDate', '>=', from], ['workDate', '<=', to]],
    });
  }
  return docs.filter((r) => ids.has(r.employeeId) && isSubmitted(r));
}

async function loadWeekly(ctx: AuthedCtx, users: UserDoc[], from: DateStr, to: DateStr): Promise<WeeklyReportDoc[]> {
  const ids = new Set(users.map((u) => u.id));
  let docs: WeeklyReportDoc[];
  if (users.length > 60) {
    docs = await ctx.store.query<WeeklyReportDoc & { id: string }>(COL.weeklyReports, { where: [['periodStart', '>=', from], ['periodStart', '<=', to]] });
  } else {
    docs = await queryIn<WeeklyReportDoc & { id: string }>(ctx.store, COL.weeklyReports, 'employeeId', [...ids], {
      where: [['periodStart', '>=', from], ['periodStart', '<=', to]],
    });
  }
  return docs.filter((r) => ids.has(r.employeeId));
}

interface WeeklyCompliance {
  expected: number;
  submitted: number;
  approved: number;
  awaitingReview: number;
  returned: number;
}

/** A week is expected once its deadline has passed and it contained at least one working day for the employee. */
function weeklyCompliance(
  user: UserDoc,
  from: DateStr,
  to: DateStr,
  weekly: WeeklyReportDoc[],
  s: SystemSettings,
  exceptions: CalendarExceptionDoc[],
  now: Date,
): WeeklyCompliance {
  const mine = new Map(weekly.filter((w) => w.employeeId === user.id).map((w) => [w.periodStart, w]));
  let expected = 0;
  let submitted = 0;
  for (let start = weekStartFor(from, s.weekStartDay); start <= to; start = addDays(start, 7)) {
    const end = addDays(start, 6);
    const w = mine.get(start);
    const deadlinePassed = now.getTime() > weeklyDeadline(end, s).getTime();
    const working = workingDatesInRange(start, end, s.calendarPolicies, exceptions, user.departmentId).some((d) => isExpectedReporter(user, d, s));
    if (w && isSubmitted(w)) {
      expected++;
      submitted++;
    } else if (deadlinePassed && working) {
      expected++;
    }
  }
  const list = [...mine.values()].filter(isSubmitted);
  return {
    expected,
    submitted,
    approved: list.filter((w) => w.reviewStatus === 'APPROVED').length,
    awaitingReview: list.filter((w) => w.awaitingReview).length,
    returned: list.filter((w) => w.reviewStatus === 'RETURNED').length,
  };
}

export interface EmployeeStats {
  user: ReturnType<typeof userSummary>;
  compliance: Omit<ComplianceSummary, 'days'>;
  days?: ComplianceSummary['days'];
  tasks: ReturnType<typeof taskStats>;
  outstanding: { overdue: number; blocked: number; open: number };
  weekly: WeeklyCompliance;
  pendingReviews: number;
  lastSubmissionAt: string | null;
}

interface TeamData {
  employees: EmployeeStats[];
  series: { date: DateStr; expected: number; submitted: number; tasksPlanned: number; tasksCompleted: number }[];
  totals: {
    employees: number;
    compliance: ReturnType<typeof combineCompliance>;
    tasks: ReturnType<typeof taskStats>;
    outstanding: { overdue: number; blocked: number; open: number };
    weekly: WeeklyCompliance;
    pendingReviews: number;
  };
  reports: DailyReportDoc[];
  weeklyReports: WeeklyReportDoc[];
}

/** Shared aggregation behind manager, management and employee analytics. */
async function teamData(ctx: AuthedCtx, users: UserDoc[], from: DateStr, to: DateStr, opts: { includeDays?: boolean } = {}): Promise<TeamData> {
  checkRange(from, to);
  const settings = await getSettings(ctx);
  const now = ctx.now();
  const today = todayIn(settings.timezone, now);
  const lookFrom = minDate(from, addDays(today, -OUTSTANDING_LOOKBACK_DAYS));
  const lookTo = maxDate(to, today);
  const [exceptions, allReports, weekly] = await Promise.all([
    getExceptions(ctx, lookFrom, lookTo),
    loadDaily(ctx, users, lookFrom, lookTo),
    loadWeekly(ctx, users, weekStartFor(from, settings.weekStartDay), to),
  ]);
  const inRange = allReports.filter((r) => r.workDate >= from && r.workDate <= to);
  const outstandingTasks = latestTaskStates(flattenTasks(allReports.filter((r) => r.workDate >= addDays(today, -OUTSTANDING_LOOKBACK_DAYS))));
  const outstandingOf = (list: TaskRow[]) => ({
    overdue: list.filter((t) => isOverdue(t, today)).length,
    blocked: list.filter((t) => t.status === 'BLOCKED').length,
    open: list.filter((t) => t.status !== 'COMPLETED').length,
  });

  const employees: EmployeeStats[] = users.map((u) => {
    const reports = inRange.filter((r) => r.employeeId === u.id);
    const { days, ...compliance } = dailyCompliance(u, from, to, reports, settings, exceptions, now);
    const mineAll = allReports.filter((r) => r.employeeId === u.id);
    return {
      user: userSummary(u),
      compliance,
      ...(opts.includeDays ? { days } : {}),
      tasks: taskStats(flattenTasks(reports), today),
      outstanding: outstandingOf(outstandingTasks.filter((t) => t.employeeId === u.id)),
      weekly: weeklyCompliance(u, from, to, weekly, settings, exceptions, now),
      pendingReviews: mineAll.filter((r) => r.awaitingReview).length + weekly.filter((w) => w.employeeId === u.id && w.awaitingReview).length,
      lastSubmissionAt: mineAll.reduce<string | null>((a, r) => (r.submittedAt && (!a || r.submittedAt > a) ? r.submittedAt : a), null),
    };
  });

  const series = dateRange(from, to).map((date) => {
    const reports = inRange.filter((r) => r.workDate === date);
    const tasks = flattenTasks(reports);
    const expected = users.filter((u) => {
      const wd = resolveWorkingDay(date, settings.calendarPolicies, exceptions, u.departmentId);
      return wd.isWorkingDay && isExpectedReporter(u, date, settings);
    }).length;
    return {
      date,
      expected,
      submitted: reports.filter((r) => r.workingDay.isWorkingDay).length,
      tasksPlanned: tasks.length,
      tasksCompleted: tasks.filter((t) => t.status === 'COMPLETED').length,
    };
  });

  const sumWeekly = (k: keyof WeeklyCompliance) => employees.reduce((a, e) => a + e.weekly[k], 0);
  return {
    employees,
    series,
    totals: {
      employees: users.length,
      compliance: combineCompliance(employees.map((e) => e.compliance)),
      tasks: taskStats(flattenTasks(inRange), today),
      outstanding: outstandingOf(outstandingTasks),
      weekly: { expected: sumWeekly('expected'), submitted: sumWeekly('submitted'), approved: sumWeekly('approved'), awaitingReview: sumWeekly('awaitingReview'), returned: sumWeekly('returned') },
      pendingReviews: employees.reduce((a, e) => a + e.pendingReviews, 0),
    },
    reports: inRange,
    weeklyReports: weekly,
  };
}

function strip(t: TeamData) {
  const { reports: _r, weeklyReports: _w, ...rest } = t;
  return rest;
}

/** Employees that should appear in analytics: active, or deactivated within the period. */
function analyticsUsers(users: UserDoc[], from: DateStr): UserDoc[] {
  return users.filter((u) => u.accountStatus === 'ACTIVE' || (u.accountStatus === 'DEACTIVATED' && (u.deactivatedAt ?? '') >= from));
}

const rangeWithDept = z
  .object({ from: dateStr, to: dateStr, departmentId: z.string().nullable().default(null) })
  .refine((r) => r.from <= r.to, 'Start date must be on or before end date');

async function companyUsers(ctx: AuthedCtx, from: DateStr, departmentId: string | null, settings: SystemSettings): Promise<UserDoc[]> {
  const all = await scopedEmployees(ctx, { includeInactive: true });
  return analyticsUsers(all, from).filter((u) => settings.reportingRoles.includes(u.role) && (!departmentId || u.departmentId === departmentId));
}

function toTaskRecords(tasks: TaskDoc[]): (TaskRecord & { title: string })[] {
  return tasks.map((t) => ({
    employeeId: t.employeeId,
    workDate: t.workDate,
    projectId: t.projectId,
    status: t.status,
    dueDate: t.dueDate,
    progressPercentage: t.progressPercentage,
    actualStartTime: t.actualStartTime,
    actualEndTime: t.actualEndTime,
    overnight: t.overnight,
    title: t.title,
  }));
}

async function employeeProjectHistories(ctx: AuthedCtx, employeeId: string, settings: SystemSettings, today: DateStr) {
  const tasks = await ctx.store.query<TaskDoc & { id: string }>(COL.tasks, {
    where: [['employeeId', '==', employeeId]],
    orderBy: [['workDate', 'desc']],
    limit: 3000,
  });
  const records = toTaskRecords(tasks);
  const projectIds = [...new Set(records.map((t) => t.projectId))];
  const projects = await ctx.store.getMany<ProjectDoc & { id: string }>(COL.projects, projectIds.filter((x): x is string => !!x));
  const names = new Map(projects.map((p) => [p.id, p]));
  return projectIds
    .map((pid) => ({
      project: pid ? { id: pid, name: names.get(pid)?.name ?? 'Unknown project', code: names.get(pid)?.code ?? '', status: names.get(pid)?.status ?? null } : null,
      history: projectHistory(pid, records, settings.weekStartDay, today),
    }))
    .sort((a, b) => (b.history.latestActivity ?? '').localeCompare(a.history.latestActivity ?? ''));
}

async function upcomingCalendar(ctx: AuthedCtx, settings: SystemSettings, today: DateStr, departmentId: string) {
  const to = addDays(today, 30);
  const exceptions = await getExceptions(ctx, today, to);
  return exceptions
    .filter((e) => e.departmentId === null || e.departmentId === departmentId)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => ({ date: e.date, type: e.type, name: e.name, description: e.description, departmentSpecific: e.departmentId !== null }))
    .concat(
      dateRange(today, addDays(today, 13))
        .filter((d) => !exceptions.some((e) => e.date === d) && !resolveWorkingDay(d, settings.calendarPolicies, [], departmentId).isWorkingDay)
        .slice(0, 2)
        .map((d) => ({ date: d, type: 'HOLIDAY' as const, name: 'Weekly holiday', description: '', departmentSpecific: false })),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}

export const analyticsOps = {
  'me.dashboard': op({
    input: z.object({}).default({}),
    run: async (ctx) => {
      const me = ctx.actor;
      const settings = await getSettings(ctx);
      const now = ctx.now();
      const today = todayIn(settings.timezone, now);
      const { periodStart, periodEnd } = weekPeriod(today, settings);
      const from = addDays(today, -OUTSTANDING_LOOKBACK_DAYS);
      const [exceptions, reports, weeklyNow, weeklyPrev, people] = await Promise.all([
        getExceptions(ctx, from, today),
        ctx.store.query<DailyReportDoc & { id: string }>(COL.dailyReports, { where: [['employeeId', '==', me.id], ['workDate', '>=', from], ['workDate', '<=', today]] }),
        ctx.store.get<WeeklyReportDoc & { id: string }>(COL.weeklyReports, `${me.id}_${periodStart}`),
        ctx.store.get<WeeklyReportDoc & { id: string }>(COL.weeklyReports, `${me.id}_${addDays(periodStart, -7)}`),
        usersById(ctx, [me.primaryReportingManagerId, me.secondaryReviewerId]),
      ]);
      const todayReport = reports.find((r) => r.workDate === today) ?? null;
      const workingDay = resolveWorkingDay(today, settings.calendarPolicies, exceptions, me.departmentId);
      const submitted = reports.filter(isSubmitted);
      const outstanding = latestTaskStates(flattenTasks(submitted));
      const todayTasks = todayReport?.tasks ?? [];
      const histories = await employeeProjectHistories(ctx, me.id, settings, today);
      const { days: _d, ...compliance } = dailyCompliance(me, addDays(today, -13), today, reports, settings, exceptions, now);
      return {
        today,
        periodStart,
        periodEnd,
        workingDay,
        isReporter: settings.reportingRoles.includes(me.role),
        deadline: dailyDeadline(today, settings).toISOString(),
        todayReport: todayReport ? summarizeDaily(todayReport) : null,
        todayTasks: taskStats(todayTasks, today),
        outstanding: {
          overdue: outstanding.filter((t) => isOverdue(t, today)).length,
          blocked: outstanding.filter((t) => t.status === 'BLOCKED').length,
          open: outstanding.filter((t) => t.status !== 'COMPLETED').length,
        },
        compliance14d: compliance,
        weeklyCurrent: weeklyNow ? summarizeWeekly(weeklyNow) : null,
        weeklyPrevious: weeklyPrev ? summarizeWeekly(weeklyPrev) : null,
        awaitingReview: submitted.filter((r) => r.awaitingReview).length,
        returned: reports.filter((r) => r.reviewStatus === 'RETURNED').map(summarizeDaily),
        recentFeedback: submitted
          .filter((r) => r.lastReviewComment)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, 5)
          .map(summarizeDaily),
        recentReports: reports.sort((a, b) => b.workDate.localeCompare(a.workDate)).slice(0, 7).map(summarizeDaily),
        currentProjects: histories.filter((h) => h.project && (h.history.latestActivity ?? '') >= from).slice(0, 6),
        primaryManager: me.primaryReportingManagerId ? (people.get(me.primaryReportingManagerId) ? userSummary(people.get(me.primaryReportingManagerId)!) : null) : null,
        secondaryReviewer: me.secondaryReviewerId ? (people.get(me.secondaryReviewerId) ? userSummary(people.get(me.secondaryReviewerId)!) : null) : null,
        upcoming: await upcomingCalendar(ctx, settings, today, me.departmentId),
      };
    },
  }),

  'me.analytics': op({
    input: dateRangeInput,
    run: async (ctx, { from, to }) => {
      const data = await teamData(ctx, [ctx.actor], from, to, { includeDays: true });
      const settings = await getSettings(ctx);
      const today = todayIn(settings.timezone, ctx.now());
      const tasks = flattenTasks(data.reports);
      const projects = await ctx.store.getMany<ProjectDoc & { id: string }>(COL.projects, [...new Set(tasks.map((t) => t.projectId).filter((x): x is string => !!x))]);
      return {
        ...strip(data),
        statusBreakdown: TASK_STATUSES.map((s) => ({ status: s, count: tasks.filter((t) => t.status === s).length })),
        priorityBreakdown: (['HIGH', 'MEDIUM', 'LOW'] as const).map((p) => ({ priority: p, count: tasks.filter((t) => t.priority === p).length })),
        projectBreakdown: [...new Set(tasks.map((t) => t.projectId))].map((pid) => ({
          name: pid ? (projects.find((p) => p.id === pid)?.name ?? 'Unknown') : 'No project',
          ...projectHistory(pid, tasks, settings.weekStartDay, today),
        })),
      };
    },
  }),

  'me.projects': op({
    input: z.object({}).default({}),
    run: async (ctx) => {
      const settings = await getSettings(ctx);
      const today = todayIn(settings.timezone, ctx.now());
      return { projects: await employeeProjectHistories(ctx, ctx.actor.id, settings, today) };
    },
  }),

  'manager.dashboard': op({
    input: z.object({ date: dateStr.nullable().default(null) }),
    run: async (ctx, input) => {
      requirePermission(ctx, 'team.view');
      const settings = await getSettings(ctx);
      const now = ctx.now();
      const today = todayIn(settings.timezone, now);
      const date = input.date ?? today;
      const team = analyticsUsers(await assignedEmployees(ctx, ctx.actor.id), date);
      const data = await teamData(ctx, team, date, date);
      const { periodStart } = weekPeriod(date, settings);
      const [dayReports, weekly, departments, exceptions] = await Promise.all([
        queryIn<DailyReportDoc & { id: string }>(ctx.store, COL.dailyReports, 'employeeId', team.map((u) => u.id), { where: [['workDate', '==', date]] }),
        queryIn<WeeklyReportDoc & { id: string }>(ctx.store, COL.weeklyReports, 'employeeId', team.map((u) => u.id), { where: [['periodStart', '==', periodStart]] }),
        allDepartments(ctx),
        getExceptions(ctx, date, date),
      ]);
      const deadline = dailyDeadline(date, settings);
      const rows = team.map((u) => {
        const r = dayReports.find((x) => x.employeeId === u.id);
        const stats = data.employees.find((e) => e.user.id === u.id)!;
        const wd = resolveWorkingDay(date, settings.calendarPolicies, exceptions, u.departmentId);
        const expected = wd.isWorkingDay && isExpectedReporter(u, date, settings);
        const submitted = !!r && isSubmitted(r);
        const todayStatus = submitted
          ? r.reviewStatus
          : !expected
            ? wd.isWorkingDay ? 'NOT_EXPECTED' : 'HOLIDAY'
            : now > deadline ? 'MISSING' : r ? 'DRAFT' : 'NOT_SUBMITTED';
        const w = weekly.find((x) => x.employeeId === u.id);
        const tasks = submitted ? r.tasks : [];
        return {
          user: userSummary(u),
          departmentName: departments.find((d) => d.id === u.departmentId)?.name ?? '',
          todayStatus,
          workingDayReason: wd.reason,
          reportId: submitted ? r.id : null,
          tasksPlanned: tasks.length,
          tasksCompleted: tasks.filter((t) => t.status === 'COMPLETED').length,
          tasksInProgress: tasks.filter((t) => t.status === 'IN_PROGRESS').length,
          tasksBlocked: tasks.filter((t) => t.status === 'BLOCKED').length,
          overdue: stats.outstanding.overdue,
          weeklyStatus: w ? (isSubmitted(w) ? w.reviewStatus : 'DRAFT') : 'NOT_SUBMITTED',
          weeklyReportId: w && isSubmitted(w) ? w.id : null,
          lastSubmissionAt: stats.lastSubmissionAt,
          pendingReviewCount: stats.pendingReviews,
        };
      });
      const submittedToday = dayReports.filter(isSubmitted);
      const expectedToday = rows.filter((r) => !['HOLIDAY', 'NOT_EXPECTED'].includes(r.todayStatus)).length;
      const pendingAll = await queryIn<DailyReportDoc & { id: string }>(ctx.store, COL.dailyReports, 'employeeId', team.map((u) => u.id), { where: [['awaitingReview', '==', true]] });
      const weeklyPending = await queryIn<WeeklyReportDoc & { id: string }>(ctx.store, COL.weeklyReports, 'employeeId', team.map((u) => u.id), { where: [['awaitingReview', '==', true]] });
      return {
        date,
        today,
        deadline: deadline.toISOString(),
        kpis: {
          assignedEmployees: team.length,
          expectedToday,
          submittedToday: submittedToday.filter((r) => rows.find((x) => x.user.id === r.employeeId && !['HOLIDAY', 'NOT_EXPECTED'].includes(x.todayStatus))).length,
          notSubmitted: rows.filter((r) => ['MISSING', 'NOT_SUBMITTED', 'DRAFT'].includes(r.todayStatus)).length,
          missingAfterDeadline: rows.filter((r) => r.todayStatus === 'MISSING').length,
          awaitingReview: pendingAll.length,
          approved: submittedToday.filter((r) => r.reviewStatus === 'APPROVED').length,
          returned: submittedToday.filter((r) => r.reviewStatus === 'RETURNED').length,
          tasksCompleted: rows.reduce((a, r) => a + r.tasksCompleted, 0),
          overdue: data.totals.outstanding.overdue,
          blocked: data.totals.outstanding.blocked,
          weeklyAwaitingReview: weeklyPending.length,
        },
        rows,
        departments: departments.filter((d) => team.some((u) => u.departmentId === d.id)).map((d) => ({ id: d.id, name: d.name })),
      };
    },
  }),

  'team.analytics': op({
    input: rangeWithDept,
    run: async (ctx, { from, to, departmentId }) => {
      if (!can(ctx.actor.role, 'team.view') && !can(ctx.actor.role, 'analytics.company')) throw deny();
      const settings = await getSettings(ctx);
      const users = ctx.actor.role === 'REPORTING_MANAGER'
        ? analyticsUsers(await assignedEmployees(ctx, ctx.actor.id), from).filter((u) => !departmentId || u.departmentId === departmentId)
        : await companyUsers(ctx, from, departmentId, settings);
      return strip(await teamData(ctx, users, from, to));
    },
  }),

  'company.overview': op({
    input: rangeWithDept,
    run: async (ctx, { from, to, departmentId }) => {
      requirePermission(ctx, 'analytics.company');
      const settings = await getSettings(ctx);
      const today = todayIn(settings.timezone, ctx.now());
      const users = await companyUsers(ctx, from, departmentId, settings);
      const [data, departments, todayReports, pendingDaily, pendingWeekly] = await Promise.all([
        teamData(ctx, users, from, to),
        allDepartments(ctx),
        ctx.store.query<DailyReportDoc & { id: string }>(COL.dailyReports, { where: [['workDate', '==', today]] }),
        ctx.store.query<DailyReportDoc & { id: string }>(COL.dailyReports, { where: [['awaitingReview', '==', true]], limit: 5000 }),
        ctx.store.query<WeeklyReportDoc & { id: string }>(COL.weeklyReports, { where: [['awaitingReview', '==', true]], limit: 5000 }),
      ]);
      const ids = new Set(users.map((u) => u.id));
      const deptRows = departments
        .filter((d) => !departmentId || d.id === departmentId)
        .map((d) => {
          const emps = data.employees.filter((e) => e.user.departmentId === d.id);
          return {
            id: d.id,
            name: d.name,
            active: d.active,
            employees: emps.length,
            compliance: combineCompliance(emps.map((e) => e.compliance)),
            tasks: {
              planned: emps.reduce((a, e) => a + e.tasks.planned, 0),
              completed: emps.reduce((a, e) => a + e.tasks.completed, 0),
              inProgress: emps.reduce((a, e) => a + e.tasks.inProgress, 0),
              pending: emps.reduce((a, e) => a + e.tasks.pending, 0),
              blocked: emps.reduce((a, e) => a + e.tasks.blocked, 0),
            },
            outstanding: {
              overdue: emps.reduce((a, e) => a + e.outstanding.overdue, 0),
              blocked: emps.reduce((a, e) => a + e.outstanding.blocked, 0),
            },
            weekly: { expected: emps.reduce((a, e) => a + e.weekly.expected, 0), submitted: emps.reduce((a, e) => a + e.weekly.submitted, 0) },
            pendingReviews: emps.reduce((a, e) => a + e.pendingReviews, 0),
          };
        })
        .filter((d) => d.employees > 0 || d.active);
      return {
        ...strip(data),
        today,
        kpis: {
          activeEmployees: users.filter((u) => u.accountStatus === 'ACTIVE').length,
          reportingToday: todayReports.filter((r) => ids.has(r.employeeId) && isSubmitted(r)).length,
          compliance: data.totals.compliance,
          tasks: data.totals.tasks,
          outstanding: data.totals.outstanding,
          weeklySubmitted: data.totals.weekly.submitted,
          weeklyExpected: data.totals.weekly.expected,
          weeklyAwaitingApproval: pendingWeekly.filter((w) => ids.has(w.employeeId)).length,
          reviewsPending: pendingDaily.filter((r) => ids.has(r.employeeId)).length + pendingWeekly.filter((w) => ids.has(w.employeeId)).length,
        },
        departments: deptRows,
      };
    },
  }),

  'company.compliance': op({
    input: rangeWithDept,
    run: async (ctx, { from, to, departmentId }) => {
      if (!can(ctx.actor.role, 'analytics.company') && !can(ctx.actor.role, 'team.view')) throw deny();
      const settings = await getSettings(ctx);
      const users = ctx.actor.role === 'REPORTING_MANAGER'
        ? analyticsUsers(await assignedEmployees(ctx, ctx.actor.id), from)
        : await companyUsers(ctx, from, departmentId, settings);
      const data = await teamData(ctx, users, from, to, { includeDays: true });
      return { from, to, dates: dateRange(from, to), employees: data.employees, totals: data.totals.compliance };
    },
  }),

  /** Outstanding work: latest state of each open work item over the last 30 days, plus pending reviews. */
  'company.pendingWork': op({
    input: z.object({ departmentId: z.string().nullable().default(null) }),
    run: async (ctx, { departmentId }) => {
      if (!can(ctx.actor.role, 'analytics.company') && !can(ctx.actor.role, 'team.view')) throw deny();
      const settings = await getSettings(ctx);
      const today = todayIn(settings.timezone, ctx.now());
      const from = addDays(today, -OUTSTANDING_LOOKBACK_DAYS);
      const users = ctx.actor.role === 'REPORTING_MANAGER'
        ? analyticsUsers(await assignedEmployees(ctx, ctx.actor.id), from)
        : await companyUsers(ctx, from, departmentId, settings);
      const byId = new Map(users.map((u) => [u.id, u]));
      const reports = await loadDaily(ctx, users, from, today);
      const open = latestTaskStates(flattenTasks(reports)).filter((t) => t.status !== 'COMPLETED');
      const projectMap = new Map((await ctx.store.getMany<ProjectDoc & { id: string }>(COL.projects, [...new Set(open.map((t) => t.projectId).filter((x): x is string => !!x))])).map((p) => [p.id, p.name]));
      const row = (t: TaskRow) => ({
        reportId: t.reportId,
        employee: userSummary(byId.get(t.employeeId)!),
        workDate: t.workDate,
        title: t.title,
        status: t.status,
        priority: t.priority,
        dueDate: t.dueDate,
        daysOverdue: t.dueDate && t.dueDate < today ? diffDays(t.dueDate, today) : 0,
        progressPercentage: t.progressPercentage,
        projectName: t.projectId ? (projectMap.get(t.projectId) ?? 'Unknown') : null,
      });
      const pendingDaily = reports.filter((r) => r.awaitingReview);
      return {
        today,
        overdue: open.filter((t) => isOverdue(t, today)).map(row).sort((a, b) => b.daysOverdue - a.daysOverdue).slice(0, 300),
        blocked: open.filter((t) => t.status === 'BLOCKED').map(row).slice(0, 300),
        inProgress: open.filter((t) => t.status === 'IN_PROGRESS' && !isOverdue(t, today)).map(row).slice(0, 300),
        notStarted: open.filter((t) => t.status === 'PLANNED' && !isOverdue(t, today)).map(row).slice(0, 300),
        pendingReviews: pendingDaily
          .map((r) => ({ ...summarizeDaily(r), ageDays: r.submittedAt ? diffDays(r.submittedAt.slice(0, 10), today) : 0 }))
          .sort((a, b) => b.ageDays - a.ageDays)
          .slice(0, 300),
      };
    },
  }),

  'employees.profile': op({
    input: z.object({ employeeId: z.string().min(1), from: dateStr, to: dateStr }),
    run: async (ctx, { employeeId, from, to }) => {
      const employee = await getViewableEmployee(ctx, employeeId);
      const settings = await getSettings(ctx);
      const today = todayIn(settings.timezone, ctx.now());
      const data = await teamData(ctx, [employee], from, to, { includeDays: true });
      const [people, dept, weeklyRecent, histories] = await Promise.all([
        usersById(ctx, [employee.primaryReportingManagerId, employee.secondaryReviewerId]),
        ctx.store.get<DepartmentDoc & { id: string }>(COL.departments, employee.departmentId),
        ctx.store.query<WeeklyReportDoc & { id: string }>(COL.weeklyReports, {
          where: [['employeeId', '==', employee.id]],
          orderBy: [['periodStart', 'desc']],
          limit: 8,
        }),
        employeeProjectHistories(ctx, employee.id, settings, today),
      ]);
      const tasks = flattenTasks(data.reports).sort((a, b) => b.workDate.localeCompare(a.workDate));
      const stats = data.employees[0]!;
      const fullAccess = ctx.actor.role === 'SUPER_ADMIN' || ctx.actor.role === 'MANAGEMENT' || ctx.actor.id === employee.id || employee.primaryReportingManagerId === ctx.actor.id || employee.secondaryReviewerId === ctx.actor.id;
      return {
        profile: fullAccess ? userProfile(employee) : userSummary(employee),
        departmentName: dept?.name ?? '',
        primaryManager: employee.primaryReportingManagerId ? (people.get(employee.primaryReportingManagerId)?.fullName ?? null) : null,
        secondaryReviewer: employee.secondaryReviewerId ? (people.get(employee.secondaryReviewerId)?.fullName ?? null) : null,
        stats,
        series: data.series,
        reviewStatus: ['PENDING_REVIEW', 'VIEWED', 'REVIEWED', 'APPROVED', 'RETURNED'].map((s) => ({ status: s, count: data.reports.filter((r) => r.reviewStatus === s).length })),
        recentWork: tasks.slice(0, 15).map((t) => ({ reportId: t.reportId, workDate: t.workDate, title: t.title, description: t.description, status: t.status, progressPercentage: t.progressPercentage, projectId: t.projectId })),
        recentReports: data.reports.sort((a, b) => b.workDate.localeCompare(a.workDate)).slice(0, 20).map(summarizeDaily),
        weeklyReports: weeklyRecent.filter(isSubmitted).map((w) => ({ ...summarizeWeekly(w), majorAccomplishments: w.narrative.majorAccomplishments })),
        projects: histories,
      };
    },
  }),

  'projects.analytics': op({
    input: z.object({ staleAfterDays: z.number().int().min(1).max(90).default(14) }),
    run: async (ctx, { staleAfterDays }) => {
      requirePermission(ctx, 'analytics.company');
      const settings = await getSettings(ctx);
      const today = todayIn(settings.timezone, ctx.now());
      const [projects, departments] = await Promise.all([
        ctx.store.query<ProjectDoc & { id: string }>(COL.projects, { orderBy: [['normalizedName', 'asc']], limit: 1000 }),
        allDepartments(ctx),
      ]);
      const rows = [];
      for (const p of projects) {
        const tasks = toTaskRecords(await ctx.store.query<TaskDoc & { id: string }>(COL.tasks, { where: [['projectId', '==', p.id]], orderBy: [['workDate', 'desc']], limit: 5000 }));
        const h = projectHistory(p.id, tasks, settings.weekStartDay, today);
        const open = latestTaskStates(tasks).filter((t) => t.status !== 'COMPLETED');
        rows.push({
          project: { id: p.id, name: p.name, code: p.code, status: p.status, priority: p.priority, departmentName: departments.find((d) => d.id === p.departmentId)?.name ?? '', targetEndDate: p.targetEndDate },
          history: h,
          unresolvedTasks: open.length,
          stale: p.status === 'ACTIVE' && (!h.latestActivity || diffDays(h.latestActivity, today) > staleAfterDays),
          daysSinceActivity: h.latestActivity ? diffDays(h.latestActivity, today) : null,
        });
      }
      return { today, staleAfterDays, projects: rows };
    },
  }),

  'projects.detail': op({
    input: z.object({ projectId: z.string().min(1) }),
    run: async (ctx, { projectId }) => {
      const settings = await getSettings(ctx);
      const today = todayIn(settings.timezone, ctx.now());
      const project = await ctx.store.get<ProjectDoc & { id: string }>(COL.projects, projectId);
      if (!project) throw invalid('Project not found.');
      let docs = await ctx.store.query<TaskDoc & { id: string }>(COL.tasks, { where: [['projectId', '==', projectId]], orderBy: [['workDate', 'desc']], limit: 5000 });
      if (!can(ctx.actor.role, 'analytics.company')) {
        // Employees and managers see only their own / their team's work on the project.
        const visible = new Set([ctx.actor.id, ...(ctx.actor.role === 'REPORTING_MANAGER' ? (await assignedEmployees(ctx, ctx.actor.id)).map((u) => u.id) : [])]);
        docs = docs.filter((t) => visible.has(t.employeeId));
        if (!docs.length && !project.participantIds.includes(ctx.actor.id) && project.ownerId !== ctx.actor.id) throw deny();
      }
      const records = toTaskRecords(docs);
      const people = await usersById(ctx, [...new Set([...records.map((t) => t.employeeId), project.ownerId, project.reviewerId ?? null])]);
      const weeks = new Map<string, { week: string; tasks: number; completed: number; employees: Set<string> }>();
      for (const t of records) {
        const w = weekStartFor(t.workDate, settings.weekStartDay);
        const e = weeks.get(w) ?? { week: w, tasks: 0, completed: 0, employees: new Set<string>() };
        e.tasks++;
        if (t.status === 'COMPLETED') e.completed++;
        e.employees.add(t.employeeId);
        weeks.set(w, e);
      }
      return {
        project,
        ownerName: project.ownerId ? (people.get(project.ownerId)?.fullName ?? null) : null,
        reviewerName: project.reviewerId ? (people.get(project.reviewerId)?.fullName ?? null) : null,
        overall: projectHistory(projectId, records, settings.weekStartDay, today),
        byEmployee: [...new Set(records.map((t) => t.employeeId))].map((eid) => ({
          employee: people.get(eid) ? userSummary(people.get(eid)!) : null,
          history: projectHistory(projectId, records.filter((t) => t.employeeId === eid), settings.weekStartDay, today),
        })),
        weekly: [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week)).map((w) => ({ week: w.week, tasks: w.tasks, completed: w.completed, employees: w.employees.size })),
        recentTasks: docs.slice(0, 25).map((t) => ({ reportId: t.reportId, workDate: t.workDate, title: t.title, status: t.status, progressPercentage: t.progressPercentage, employeeName: people.get(t.employeeId)?.fullName ?? '' })),
      };
    },
  }),

  /** Collaborator / people picker: active employees, minimal fields, available to every signed-in user. */
  'directory.people': op({
    input: z.object({ query: z.string().trim().max(60).default(''), limit: z.number().int().min(1).max(25).default(10) }),
    run: async (ctx, { query, limit }) => {
      const words = normalizeName(query).split(' ').filter(Boolean);
      if (!words.length) return { people: [] };
      const candidates = await ctx.store.query<UserDoc & { id: string }>(COL.users, {
        where: [['searchTokens', 'array-contains', words[0]!.slice(0, 15)]],
        limit: 100,
      });
      const people = candidates
        .filter((u) => u.accountStatus === 'ACTIVE' && words.every((w) => u.searchTokens.includes(w.slice(0, 15))))
        .slice(0, limit)
        .map(userSummary);
      return { people };
    },
  }),

  /** Global search for management, admin and managers (managers see their own team only). */
  'search.global': op({
    input: z.object({ query: z.string().trim().min(1).max(60) }),
    run: async (ctx, { query }) => {
      if (!can(ctx.actor.role, 'directory.full') && !can(ctx.actor.role, 'team.view')) throw deny();
      const q = normalizeName(query);
      const pool = await scopedEmployees(ctx, { includeInactive: can(ctx.actor.role, 'admin.users') });
      const [departments, projects] = await Promise.all([
        allDepartments(ctx),
        ctx.store.query<ProjectDoc & { id: string }>(COL.projects, { limit: 1000 }),
      ]);
      const managers = new Map(pool.concat(await ctx.store.getMany<UserDoc & { id: string }>(COL.users, [...new Set(pool.map((u) => u.primaryReportingManagerId).filter((x): x is string => !!x))])).map((u) => [u.id, u]));
      const matchedDepts = departments.filter((d) => normalizeName(d.name).includes(q) || d.code.toLowerCase() === q);
      const matchedProjects = projects.filter((p) => p.normalizedName.includes(q) || p.code.toLowerCase().includes(q));
      const score = (u: UserDoc): number => {
        if (u.employeeCode.toLowerCase() === q) return 100;
        if (u.normalizedName === q) return 90;
        if (u.normalizedName.startsWith(q)) return 80;
        if (q.split(' ').every((w) => u.searchTokens.includes(w.slice(0, 15)))) return 70;
        if (u.employeeCode.toLowerCase().includes(q)) return 60;
        if (normalizeName(u.designation).includes(q)) return 40;
        const mgr = u.primaryReportingManagerId ? managers.get(u.primaryReportingManagerId) : undefined;
        if (mgr && mgr.normalizedName.includes(q)) return 30;
        if (matchedDepts.some((d) => d.id === u.departmentId)) return 20;
        if (matchedProjects.some((p) => p.participantIds.includes(u.id) || p.ownerId === u.id)) return 10;
        return 0;
      };
      const employees = pool
        .map((u) => ({ u, s: score(u) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || a.u.fullName.localeCompare(b.u.fullName))
        .slice(0, 25)
        .map(({ u, s }) => ({
          ...userSummary(u),
          departmentName: departments.find((d) => d.id === u.departmentId)?.name ?? '',
          managerName: u.primaryReportingManagerId ? (managers.get(u.primaryReportingManagerId)?.fullName ?? null) : null,
          matchedBy: s >= 60 ? 'employee' : s === 40 ? 'designation' : s === 30 ? 'manager' : s === 20 ? 'department' : 'project',
        }));
      return {
        employees,
        departments: can(ctx.actor.role, 'directory.full') ? matchedDepts.map((d) => ({ id: d.id, name: d.name })) : [],
        projects: can(ctx.actor.role, 'analytics.company') ? matchedProjects.slice(0, 10).map((p) => ({ id: p.id, name: p.name, code: p.code })) : [],
      };
    },
  }),

  'directory.list': op({
    input: z.object({
      query: z.string().trim().max(60).default(''),
      departmentId: z.string().nullable().default(null),
      role: z.enum(ROLES).nullable().default(null),
      status: z.enum(ACCOUNT_STATUSES).nullable().default(null),
      managerId: z.string().nullable().default(null),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }),
    run: async (ctx, f) => {
      if (!can(ctx.actor.role, 'directory.full') && !can(ctx.actor.role, 'team.view')) throw deny();
      const q = normalizeName(f.query);
      const pool = await scopedEmployees(ctx, { includeInactive: true });
      const departments = await allDepartments(ctx);
      const managers = await usersById(ctx, [...new Set(pool.map((u) => u.primaryReportingManagerId))]);
      const filtered = pool.filter(
        (u) =>
          (!f.departmentId || u.departmentId === f.departmentId) &&
          (!f.role || u.role === f.role) &&
          (!f.status || u.accountStatus === f.status) &&
          (!f.managerId || u.primaryReportingManagerId === f.managerId || u.secondaryReviewerId === f.managerId) &&
          (!q || u.normalizedName.includes(q) || u.employeeCode.toLowerCase().includes(q) || normalizeName(u.designation).includes(q) || u.phoneNumber.includes(q)),
      );
      const admin = can(ctx.actor.role, 'admin.users');
      return {
        total: filtered.length,
        items: filtered.slice(f.offset, f.offset + f.limit).map((u) => ({
          ...(admin || can(ctx.actor.role, 'directory.full') ? userProfile(u) : userSummary(u)),
          departmentName: departments.find((d) => d.id === u.departmentId)?.name ?? '',
          managerName: u.primaryReportingManagerId ? (managers.get(u.primaryReportingManagerId)?.fullName ?? null) : null,
        })),
      };
    },
  }),

  /** Export rows. Uses exactly the same scoping as the list views, so it cannot widen access. */
  'export.run': op({
    input: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('dailyTasks'), filters: dailyListInput }),
      z.object({ kind: z.literal('weeklyReports'), filters: weeklyListInput }),
      z.object({ kind: z.literal('compliance'), filters: rangeWithDept }),
      z.object({ kind: z.literal('employees'), filters: z.object({ departmentId: z.string().nullable().default(null) }) }),
    ]),
    run: async (ctx, input) => {
      const role = ctx.actor.role;
      const allowed = can(role, 'export.company') || can(role, 'export.team') || role === 'EMPLOYEE';
      if (!allowed) throw deny();
      let rows: Record<string, string | number | null>[] = [];
      const departments = await allDepartments(ctx);
      const deptName = (id: string) => departments.find((d) => d.id === id)?.name ?? '';
      if (input.kind === 'dailyTasks') {
        if (role === 'EMPLOYEE') input.filters.employeeId = ctx.actor.id;
        const reports = await scopedDailyReports(ctx, { ...input.filters, includeDrafts: false });
        const projects = await ctx.store.getMany<ProjectDoc & { id: string }>(COL.projects, [...new Set(reports.flatMap((r) => r.projectIds))]);
        for (const r of reports) {
          for (const t of r.tasks) {
            rows.push({
              'Work Date': r.workDate,
              'Employee Code': r.employeeCode,
              'Employee Name': r.employeeName,
              Department: deptName(r.departmentId),
              'Task #': t.slot,
              'Task Title': t.title,
              Description: t.description,
              Priority: t.priority,
              Project: t.projectId ? (projects.find((p) => p.id === t.projectId)?.name ?? '') : '',
              Category: t.category ?? '',
              'Planned Start': t.plannedStartTime,
              'Planned End': t.plannedEndTime,
              'Actual Start': t.actualStartTime,
              'Actual End': t.actualEndTime,
              'Due Date': t.dueDate,
              'Progress %': t.progressPercentage,
              'Task Status': t.status,
              'Review Status': r.reviewStatus,
              'Report Version': r.version,
              'Submitted At': r.submittedAt,
              'Holiday Work': r.isHolidayWork ? 'Yes' : 'No',
            });
          }
        }
      } else if (input.kind === 'weeklyReports') {
        if (role === 'EMPLOYEE') input.filters.employeeId = ctx.actor.id;
        const reports = (await scopedWeeklyReports(ctx, input.filters)).filter(isSubmitted);
        rows = reports.map((w) => ({
          'Week Start': w.periodStart,
          'Week End': w.periodEnd,
          'Employee Code': w.employeeCode,
          'Employee Name': w.employeeName,
          Department: deptName(w.departmentId),
          'Working Days': w.calculatedSummary.workingDays,
          'Daily Reports Submitted': w.calculatedSummary.dailyReportsSubmitted,
          'Tasks Planned': w.calculatedSummary.tasksPlanned,
          'Tasks Completed': w.calculatedSummary.tasksCompleted,
          'Tasks In Progress': w.calculatedSummary.tasksInProgress,
          'Tasks Pending': w.calculatedSummary.tasksPending,
          'Tasks Blocked': w.calculatedSummary.tasksBlocked,
          'Major Accomplishments': w.narrative.majorAccomplishments,
          Blockers: w.narrative.blockers,
          'Next Week Plan': w.narrative.nextWeekPlan,
          'Review Status': w.reviewStatus,
          'Submitted At': w.submittedAt,
        }));
      } else if (input.kind === 'compliance') {
        if (role === 'EMPLOYEE') throw deny();
        const settings = await getSettings(ctx);
        const { from, to, departmentId } = input.filters;
        const users = role === 'REPORTING_MANAGER' ? analyticsUsers(await assignedEmployees(ctx, ctx.actor.id), from) : await companyUsers(ctx, from, departmentId, settings);
        const data = await teamData(ctx, users, from, to);
        rows = data.employees.map((e) => ({
          'Employee Code': e.user.employeeCode,
          'Employee Name': e.user.fullName,
          Department: deptName(e.user.departmentId),
          'Expected Reports': e.compliance.expected,
          Submitted: e.compliance.submitted,
          'On Time': e.compliance.onTime,
          Late: e.compliance.late,
          Missing: e.compliance.missing,
          'Compliance %': e.compliance.rate,
          'Weekly Expected': e.weekly.expected,
          'Weekly Submitted': e.weekly.submitted,
          'Tasks Planned': e.tasks.planned,
          'Tasks Completed': e.tasks.completed,
          'Open Overdue': e.outstanding.overdue,
        }));
      } else {
        if (!can(role, 'directory.full')) throw deny();
        const pool = (await scopedEmployees(ctx, { includeInactive: true })).filter((u) => !input.filters.departmentId || u.departmentId === input.filters.departmentId);
        const managers = await usersById(ctx, pool.map((u) => u.primaryReportingManagerId));
        rows = pool.map((u) => ({
          'Employee Code': u.employeeCode,
          'Full Name': u.fullName,
          Department: deptName(u.departmentId),
          Designation: u.designation,
          Role: u.role,
          'Reporting Manager': u.primaryReportingManagerId ? (managers.get(u.primaryReportingManagerId)?.fullName ?? '') : '',
          'Account Status': u.accountStatus,
          'Joined On': u.joinedAt,
        }));
      }
      if (rows.length > 20_000) throw new AppError('resource-exhausted', 'Export too large. Narrow the filters.');
      await ctx.store.transaction(async (tx) => {
        audit(tx, ctx, { action: 'REPORT_EXPORTED', entityType: 'export', entityId: input.kind, afterSnapshot: { filters: input.filters as Record<string, unknown>, rows: rows.length } });
      });
      return { kind: input.kind, rows };
    },
  }),
};
