import { dailyDeadline, isExpectedReporter, resolveWorkingDay } from './calendar';
import { dateRange, diffDays, timeToMinutes, weekStartFor, type DateStr } from './dates';
import type {
  CalendarExceptionDoc,
  DailyReportDoc,
  ProjectBreakdown,
  SystemSettings,
  TaskEntry,
  TaskStatus,
  UserDoc,
} from './types';

/**
 * Metric definitions (documented in docs/ARCHITECTURE.md):
 * - planned:     every task recorded in a submitted daily report
 * - pending:     status PLANNED (not started)
 * - inProgress:  status IN_PROGRESS
 * - completed:   status COMPLETED
 * - blocked:     status BLOCKED
 * - overdue:     not COMPLETED and an explicit due date earlier than today.
 *                Tasks without a due date are never overdue.
 */
export interface TaskStats {
  planned: number;
  pending: number;
  inProgress: number;
  completed: number;
  blocked: number;
  overdue: number;
  averageProgress: number | null;
}

export function isOverdue(t: Pick<TaskEntry, 'status' | 'dueDate'>, today: DateStr): boolean {
  return t.status !== 'COMPLETED' && t.dueDate !== null && t.dueDate < today;
}

export function taskStats(tasks: Pick<TaskEntry, 'status' | 'dueDate' | 'progressPercentage'>[], today: DateStr): TaskStats {
  const by = (s: TaskStatus) => tasks.filter((t) => t.status === s).length;
  return {
    planned: tasks.length,
    pending: by('PLANNED'),
    inProgress: by('IN_PROGRESS'),
    completed: by('COMPLETED'),
    blocked: by('BLOCKED'),
    overdue: tasks.filter((t) => isOverdue(t, today)).length,
    averageProgress: tasks.length ? Math.round(tasks.reduce((a, t) => a + t.progressPercentage, 0) / tasks.length) : null,
  };
}

export const isSubmitted = (r: Pick<DailyReportDoc, 'version'>) => r.version > 0;

export type DayComplianceStatus =
  | 'HOLIDAY'
  | 'HOLIDAY_WORK'
  | 'NOT_EXPECTED'
  | 'NOT_DUE'
  | 'SUBMITTED_ON_TIME'
  | 'SUBMITTED_LATE'
  | 'MISSING';

export interface DayCompliance {
  date: DateStr;
  status: DayComplianceStatus;
  reason: string;
  reportId: string | null;
}

export interface ComplianceSummary {
  expected: number;
  submitted: number;
  onTime: number;
  late: number;
  missing: number;
  notDue: number;
  holidayWork: number;
  /** submitted / expected as a whole percentage, or null when nothing was expected. */
  rate: number | null;
  days: DayCompliance[];
}

/**
 * Daily reporting compliance for one employee over a date range.
 * A working day counts as "expected" once its deadline has passed, or earlier if a report was submitted.
 * Holidays and days before joining are never counted against the employee.
 */
export function dailyCompliance(
  user: UserDoc,
  from: DateStr,
  to: DateStr,
  reports: DailyReportDoc[],
  settings: SystemSettings,
  exceptions: CalendarExceptionDoc[],
  now: Date,
): ComplianceSummary {
  const byDate = new Map(reports.filter((r) => r.employeeId === user.id).map((r) => [r.workDate, r]));
  const days: DayCompliance[] = [];
  for (const date of dateRange(from, to)) {
    const report = byDate.get(date);
    const submitted = report && isSubmitted(report);
    const wd = resolveWorkingDay(date, settings.calendarPolicies, exceptions, user.departmentId);
    if (!isExpectedReporter(user, date, settings)) {
      days.push({ date, status: 'NOT_EXPECTED', reason: 'Not expected to report on this date', reportId: report?.id ?? null });
      continue;
    }
    if (!wd.isWorkingDay) {
      days.push({ date, status: submitted ? 'HOLIDAY_WORK' : 'HOLIDAY', reason: wd.reason, reportId: report?.id ?? null });
      continue;
    }
    if (submitted) {
      days.push({
        date,
        status: report.submittedLate ? 'SUBMITTED_LATE' : 'SUBMITTED_ON_TIME',
        reason: wd.reason,
        reportId: report.id,
      });
    } else if (now.getTime() <= dailyDeadline(date, settings).getTime()) {
      days.push({ date, status: 'NOT_DUE', reason: 'Deadline not yet reached', reportId: report?.id ?? null });
    } else {
      days.push({ date, status: 'MISSING', reason: 'No report submitted before the deadline', reportId: report?.id ?? null });
    }
  }
  const count = (s: DayComplianceStatus) => days.filter((d) => d.status === s).length;
  const onTime = count('SUBMITTED_ON_TIME');
  const late = count('SUBMITTED_LATE');
  const missing = count('MISSING');
  const expected = onTime + late + missing;
  return {
    expected,
    submitted: onTime + late,
    onTime,
    late,
    missing,
    notDue: count('NOT_DUE'),
    holidayWork: count('HOLIDAY_WORK'),
    rate: expected ? Math.round(((onTime + late) / expected) * 100) : null,
    days,
  };
}

export function combineCompliance(list: Pick<ComplianceSummary, 'expected' | 'submitted' | 'onTime' | 'late' | 'missing'>[]) {
  const sum = (k: 'expected' | 'submitted' | 'onTime' | 'late' | 'missing') => list.reduce((a, c) => a + c[k], 0);
  const expected = sum('expected');
  const submitted = sum('submitted');
  return {
    expected,
    submitted,
    onTime: sum('onTime'),
    late: sum('late'),
    missing: sum('missing'),
    rate: expected ? Math.round((submitted / expected) * 100) : null,
  };
}

export interface TaskRecord {
  employeeId: string;
  workDate: DateStr;
  projectId: string | null;
  status: TaskStatus;
  dueDate: DateStr | null;
  progressPercentage: number;
  actualStartTime: string | null;
  actualEndTime: string | null;
  overnight: boolean;
}

/**
 * Merge overlapping intervals (minutes since midnight of the work date) and return total minutes.
 * Prevents double counting when two tasks were worked on at the same time.
 */
export function mergedMinutes(intervals: [number, number][]): number {
  const sorted = intervals.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cur: [number, number] | null = null;
  for (const [s, e] of sorted) {
    if (!cur || s > cur[1]) {
      if (cur) total += cur[1] - cur[0];
      cur = [s, e];
    } else {
      cur[1] = Math.max(cur[1], e);
    }
  }
  if (cur) total += cur[1] - cur[0];
  return total;
}

export interface DurationResult {
  /** Total minutes from tasks with actual start and end times, overlaps merged per employee per day. */
  minutes: number;
  tasksWithTimes: number;
  tasksWithoutTimes: number;
  /** COMPLETE when every task had actual times, PARTIAL when some did, UNAVAILABLE when none did. */
  reliability: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
}

export function recordedDuration(tasks: TaskRecord[]): DurationResult {
  const groups = new Map<string, [number, number][]>();
  let withTimes = 0;
  for (const t of tasks) {
    if (!t.actualStartTime || !t.actualEndTime) continue;
    const s = timeToMinutes(t.actualStartTime);
    let e = timeToMinutes(t.actualEndTime);
    if (e <= s) {
      if (!t.overnight) continue;
      e += 1440;
    }
    withTimes++;
    const key = `${t.employeeId}|${t.workDate}`;
    const list = groups.get(key) ?? [];
    list.push([s, e]);
    groups.set(key, list);
  }
  const minutes = [...groups.values()].reduce((a, list) => a + mergedMinutes(list), 0);
  const without = tasks.length - withTimes;
  return {
    minutes,
    tasksWithTimes: withTimes,
    tasksWithoutTimes: without,
    reliability: withTimes === 0 ? 'UNAVAILABLE' : without === 0 ? 'COMPLETE' : 'PARTIAL',
  };
}

export interface ProjectHistory {
  projectId: string | null;
  firstActivity: DateStr | null;
  latestActivity: DateStr | null;
  /** Distinct dates with at least one task — not the number of tasks. */
  activeDays: number;
  /** Calendar days from first to latest activity, inclusive. Not the same as active days. */
  elapsedCalendarDays: number;
  reportingWeeks: number;
  tasks: number;
  completed: number;
  inProgress: number;
  pending: number;
  blocked: number;
  overdue: number;
  employees: number;
  duration: DurationResult;
  /** Status of the most recent task(s) — repeated mentions do not imply progress. */
  latestStatus: TaskStatus | null;
  latestProgress: number | null;
}

export function projectHistory(projectId: string | null, tasks: TaskRecord[], weekStartDay: number, today: DateStr): ProjectHistory {
  const list = tasks.filter((t) => t.projectId === projectId);
  const dates = [...new Set(list.map((t) => t.workDate))].sort();
  const first = dates[0] ?? null;
  const latest = dates[dates.length - 1] ?? null;
  const stats = taskStats(list, today);
  const latestTasks = latest ? list.filter((t) => t.workDate === latest) : [];
  const latestTask = latestTasks.sort((a, b) => b.progressPercentage - a.progressPercentage)[0];
  return {
    projectId,
    firstActivity: first,
    latestActivity: latest,
    activeDays: dates.length,
    elapsedCalendarDays: first && latest ? diffDays(first, latest) + 1 : 0,
    reportingWeeks: new Set(dates.map((d) => weekStartFor(d, weekStartDay))).size,
    tasks: list.length,
    completed: stats.completed,
    inProgress: stats.inProgress,
    pending: stats.pending,
    blocked: stats.blocked,
    overdue: stats.overdue,
    employees: new Set(list.map((t) => t.employeeId)).size,
    duration: recordedDuration(list),
    latestStatus: latestTask?.status ?? null,
    latestProgress: latestTask?.progressPercentage ?? null,
  };
}

export function projectBreakdown(
  reports: Pick<DailyReportDoc, 'workDate' | 'tasks'>[],
  projectNames: Map<string, string>,
): ProjectBreakdown[] {
  const map = new Map<string, ProjectBreakdown & { dates: Set<string> }>();
  for (const r of reports) {
    for (const t of r.tasks) {
      const key = t.projectId ?? '__none__';
      let b = map.get(key);
      if (!b) {
        b = {
          projectId: t.projectId,
          projectName: t.projectId ? (projectNames.get(t.projectId) ?? 'Unknown project') : 'No project',
          tasks: 0,
          completed: 0,
          inProgress: 0,
          pending: 0,
          blocked: 0,
          activeDays: 0,
          dates: new Set(),
        };
        map.set(key, b);
      }
      b.tasks++;
      if (t.status === 'COMPLETED') b.completed++;
      if (t.status === 'IN_PROGRESS') b.inProgress++;
      if (t.status === 'PLANNED') b.pending++;
      if (t.status === 'BLOCKED') b.blocked++;
      b.dates.add(r.workDate);
    }
  }
  return [...map.values()]
    .map(({ dates, ...b }) => ({ ...b, activeDays: dates.size }))
    .sort((a, b) => b.tasks - a.tasks);
}

/**
 * Tasks are recorded per day, so ongoing work appears once per day it was reported. For
 * "outstanding work" metrics (overdue, blocked, open) only the latest record of each work item counts,
 * where a work item is identified by employee + project + normalized title.
 */
export function latestTaskStates<T extends Pick<TaskRecord, 'employeeId' | 'workDate' | 'projectId'> & { title: string }>(tasks: T[]): T[] {
  const latest = new Map<string, T>();
  for (const t of tasks) {
    const key = `${t.employeeId}|${t.projectId ?? ''}|${t.title.trim().toLowerCase().replace(/\s+/g, ' ')}`;
    const cur = latest.get(key);
    if (!cur || t.workDate > cur.workDate) latest.set(key, t);
  }
  return [...latest.values()];
}
