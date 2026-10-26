import {
  addDays,
  dateRange,
  WEEKDAY_NAMES,
  weekday,
  weekStartFor,
  zonedDateTimeToInstant,
  type DateStr,
} from './dates';
import { DEFAULT_WORKING_WEEKDAYS } from './settings';
import type { CalendarExceptionDoc, CalendarPolicy, SystemSettings, UserDoc, WorkingDayInfo } from './types';

/** The policy in force on `date`: the latest one whose effectiveFrom is on or before it. */
export function policyFor(date: DateStr, policies: CalendarPolicy[]): number[] {
  let best: CalendarPolicy | undefined;
  for (const p of policies) {
    if (p.effectiveFrom <= date && (!best || p.effectiveFrom > best.effectiveFrom)) best = p;
  }
  return best ? best.workingWeekdays : DEFAULT_WORKING_WEEKDAYS;
}

/**
 * Precedence: department-specific exception > company-wide exception > weekly policy.
 */
export function resolveWorkingDay(
  date: DateStr,
  policies: CalendarPolicy[],
  exceptions: CalendarExceptionDoc[],
  departmentId: string | null,
): WorkingDayInfo {
  const forDate = exceptions.filter((e) => e.date === date);
  const dept = departmentId ? forDate.find((e) => e.departmentId === departmentId) : undefined;
  const company = forDate.find((e) => e.departmentId === null);
  const exception = dept ?? company;
  if (exception) {
    const isWorkingDay = exception.type === 'WORKING_DAY';
    return {
      isWorkingDay,
      reason: isWorkingDay
        ? `Declared working day: ${exception.name}`
        : `Holiday: ${exception.name}`,
      source: dept ? 'DEPARTMENT_EXCEPTION' : 'COMPANY_EXCEPTION',
      exceptionName: exception.name,
    };
  }
  const isWorkingDay = policyFor(date, policies).includes(weekday(date));
  const dayName = WEEKDAY_NAMES[weekday(date)];
  return {
    isWorkingDay,
    reason: isWorkingDay ? `Regular working day (${dayName})` : `Weekly holiday (${dayName})`,
    source: 'WEEKLY_POLICY',
    exceptionName: null,
  };
}

export function workingDatesInRange(
  from: DateStr,
  to: DateStr,
  policies: CalendarPolicy[],
  exceptions: CalendarExceptionDoc[],
  departmentId: string | null,
): DateStr[] {
  return dateRange(from, to).filter((d) => resolveWorkingDay(d, policies, exceptions, departmentId).isWorkingDay);
}

export function dailyDeadline(workDate: DateStr, s: SystemSettings): Date {
  const base = zonedDateTimeToInstant(addDays(workDate, s.dailyDeadlineDayOffset), s.dailyDeadlineTime, s.timezone);
  return new Date(base.getTime() + s.dailyGraceMinutes * 60_000);
}

export function weeklyDeadline(periodEnd: DateStr, s: SystemSettings): Date {
  return zonedDateTimeToInstant(addDays(periodEnd, s.weeklyDeadlineDayOffset), s.weeklyDeadlineTime, s.timezone);
}

export function weekPeriod(date: DateStr, s: SystemSettings): { periodStart: DateStr; periodEnd: DateStr } {
  const periodStart = weekStartFor(date, s.weekStartDay);
  return { periodStart, periodEnd: addDays(periodStart, 6) };
}

/** First date the employee is expected to report, or null if not expected at all. */
export function reportingStartDate(u: UserDoc): DateStr | null {
  if (u.accountStatus === 'PENDING_ACTIVATION') return null;
  return u.joinedAt ?? (u.activatedAt ?? u.createdAt).slice(0, 10);
}

/** Whether a daily report is expected from this user on `date` (ignores the calendar). */
export function isExpectedReporter(u: UserDoc, date: DateStr, s: SystemSettings): boolean {
  if (!s.reportingRoles.includes(u.role)) return false;
  const start = reportingStartDate(u);
  if (!start || date < start) return false;
  if (u.accountStatus === 'ARCHIVED') return false;
  if (u.accountStatus === 'DEACTIVATED') {
    return u.deactivatedAt !== null && date < u.deactivatedAt.slice(0, 10);
  }
  return true;
}
