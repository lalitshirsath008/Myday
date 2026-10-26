import { describe, expect, it } from 'vitest';
import { dailyDeadline, resolveWorkingDay, workingDatesInRange } from '../src/calendar';
import { addDays, greetingForHour, todayIn, weekStartFor, zonedDateTimeToInstant, zonedParts } from '../src/dates';
import { latestTaskStates, mergedMinutes, projectHistory, recordedDuration, taskStats, type TaskRecord } from '../src/metrics';
import { taskIssues } from '../src/ops/daily';
import { defaultSettings } from '../src/settings';
import { phoneNumber } from '../src/schemas';
import type { CalendarExceptionDoc } from '../src/types';
import { task } from './helpers';

const s = defaultSettings('2025-01-01T00:00:00.000Z');
const ex = (date: string, type: 'HOLIDAY' | 'WORKING_DAY', departmentId: string | null = null): CalendarExceptionDoc => ({
  id: `${date}_${departmentId ?? 'ALL'}`,
  date,
  type,
  name: type === 'HOLIDAY' ? 'Test holiday' : 'Test working day',
  description: '',
  departmentId,
  createdAt: '',
  createdBy: '',
  updatedAt: '',
});

describe('dates (Asia/Kolkata)', () => {
  it('computes the business date in IST, not UTC', () => {
    // 2025-10-24 20:00 UTC is 2025-10-25 01:30 IST
    expect(todayIn('Asia/Kolkata', new Date('2025-10-24T20:00:00Z'))).toBe('2025-10-25');
  });
  it('converts wall-clock IST to instants', () => {
    expect(zonedDateTimeToInstant('2025-10-25', '10:00', 'Asia/Kolkata').toISOString()).toBe('2025-10-25T04:30:00.000Z');
    expect(zonedParts(new Date('2025-10-25T04:30:00Z'), 'Asia/Kolkata').time).toBe('10:00');
  });
  it('greets by local hour', () => {
    expect(greetingForHour(8)).toBe('Good Morning');
    expect(greetingForHour(13)).toBe('Good Afternoon');
    expect(greetingForHour(19)).toBe('Good Evening');
  });
  it('finds the configured week start', () => {
    expect(weekStartFor('2025-10-25', 1)).toBe('2025-10-20'); // Monday
    expect(weekStartFor('2025-10-20', 1)).toBe('2025-10-20');
  });
});

describe('work calendar', () => {
  it('treats Wednesday as a holiday under the default policy', () => {
    const d = resolveWorkingDay('2025-10-22', s.calendarPolicies, [], null);
    expect(d.isWorkingDay).toBe(false);
    expect(d.reason).toContain('Wednesday');
  });
  it('lets a date exception make a Wednesday a working day', () => {
    expect(resolveWorkingDay('2025-10-22', s.calendarPolicies, [ex('2025-10-22', 'WORKING_DAY')], null).isWorkingDay).toBe(true);
  });
  it('lets a company holiday override a normal working day', () => {
    expect(resolveWorkingDay('2025-10-21', s.calendarPolicies, [ex('2025-10-21', 'HOLIDAY')], null).isWorkingDay).toBe(false);
  });
  it('gives department exceptions precedence over company exceptions', () => {
    const list = [ex('2025-10-21', 'HOLIDAY'), ex('2025-10-21', 'WORKING_DAY', 'dept_prod')];
    expect(resolveWorkingDay('2025-10-21', s.calendarPolicies, list, 'dept_prod').isWorkingDay).toBe(true);
    expect(resolveWorkingDay('2025-10-21', s.calendarPolicies, list, 'dept_hr').isWorkingDay).toBe(false);
  });
  it('supports seven-day weeks via a dated policy without changing history', () => {
    const policies = [...s.calendarPolicies, { effectiveFrom: '2025-11-01', workingWeekdays: [0, 1, 2, 3, 4, 5, 6], note: '', createdAt: '', createdBy: '' }];
    expect(resolveWorkingDay('2025-10-29', policies, [], null).isWorkingDay).toBe(false); // old policy
    expect(resolveWorkingDay('2025-11-05', policies, [], null).isWorkingDay).toBe(true); // new policy
  });
  it('counts working days in a week', () => {
    expect(workingDatesInRange('2025-10-20', '2025-10-26', s.calendarPolicies, [], null)).toHaveLength(6);
  });
  it('computes the daily deadline with grace minutes', () => {
    const d = dailyDeadline('2025-10-25', { ...s, dailyDeadlineTime: '20:00', dailyGraceMinutes: 30 });
    expect(zonedParts(d, 'Asia/Kolkata')).toMatchObject({ date: '2025-10-25', time: '20:30' });
  });
});

describe('task validation', () => {
  it('requires end time after start time', () => {
    expect(taskIssues(task({ plannedStartTime: '11:00', plannedEndTime: '09:00' }), s)[0]?.field).toBe('plannedEndTime');
    expect(taskIssues(task({ plannedStartTime: '09:00', plannedEndTime: '09:00' }), s)).toHaveLength(1);
    expect(taskIssues(task(), s)).toHaveLength(0);
  });
  it('allows overnight work only when configured', () => {
    const t = task({ plannedStartTime: '22:00', plannedEndTime: '02:00', overnight: true });
    expect(taskIssues(t, s).length).toBeGreaterThan(0);
    expect(taskIssues(t, { ...s, allowOvernightTasks: true })).toHaveLength(0);
  });
  it('requires both start and end of a pair', () => {
    expect(taskIssues(task({ actualStartTime: '09:00', actualEndTime: null }), s)[0]?.field).toBe('actualEndTime');
  });
  it('keeps completion state consistent with progress', () => {
    expect(taskIssues(task({ status: 'COMPLETED', progressPercentage: 80 }), s)[0]?.field).toBe('progressPercentage');
    expect(taskIssues(task({ status: 'COMPLETED', progressPercentage: 100 }), s)).toHaveLength(0);
  });
  it('normalises Indian mobile numbers', () => {
    expect(phoneNumber.parse('+91 98765-43210')).toBe('9876543210');
    expect(phoneNumber.safeParse('12345').success).toBe(false);
  });
});

describe('metrics', () => {
  const rec = (o: Partial<TaskRecord & { title: string }> & { workDate: string }): TaskRecord & { title: string } => ({
    employeeId: 'e1',
    projectId: 'erp',
    status: 'IN_PROGRESS',
    dueDate: null,
    progressPercentage: 50,
    actualStartTime: null,
    actualEndTime: null,
    overnight: false,
    title: 'ERP module',
    ...o,
  });

  it('never counts tasks without a due date as overdue', () => {
    const stats = taskStats([rec({ workDate: '2025-10-01' }), rec({ workDate: '2025-10-02', dueDate: '2025-10-10' })], '2025-10-25');
    expect(stats.overdue).toBe(1);
    expect(stats.pending).toBe(0);
  });

  it('merges overlapping intervals instead of double counting', () => {
    expect(mergedMinutes([[540, 660], [600, 720], [800, 860]])).toBe(180 + 60);
    const d = recordedDuration([
      rec({ workDate: '2025-10-01', actualStartTime: '09:00', actualEndTime: '11:00' }),
      rec({ workDate: '2025-10-01', actualStartTime: '10:00', actualEndTime: '12:00', title: 'other' }),
      rec({ workDate: '2025-10-02' }),
    ]);
    expect(d.minutes).toBe(180);
    expect(d.reliability).toBe('PARTIAL');
  });

  it('distinguishes active days, elapsed days and task counts (Scenario I)', () => {
    const tasks = [
      rec({ workDate: '2025-10-05', status: 'COMPLETED', progressPercentage: 100 }),
      rec({ workDate: '2025-10-05', title: 'ERP API' }),
      rec({ workDate: '2025-10-12' }),
      rec({ workDate: '2025-10-25', status: 'BLOCKED' }),
    ];
    const h = projectHistory('erp', tasks, 1, '2025-10-25');
    expect(h.tasks).toBe(4);
    expect(h.activeDays).toBe(3);
    expect(h.elapsedCalendarDays).toBe(21);
    expect(h.firstActivity).toBe('2025-10-05');
    expect(h.latestActivity).toBe('2025-10-25');
    expect(h.reportingWeeks).toBe(3);
    expect(h.completed).toBe(1);
    expect(h.blocked).toBe(1);
    expect(h.duration.reliability).toBe('UNAVAILABLE');
  });

  it('uses only the latest record of a repeated work item for outstanding work', () => {
    const latest = latestTaskStates([
      rec({ workDate: '2025-10-01', dueDate: '2025-10-02' }),
      rec({ workDate: '2025-10-03', status: 'COMPLETED', progressPercentage: 100, dueDate: '2025-10-02' }),
    ]);
    expect(latest).toHaveLength(1);
    expect(taskStats(latest, '2025-10-25').overdue).toBe(0);
  });

  it('adds days correctly across month ends', () => {
    expect(addDays('2025-10-31', 1)).toBe('2025-11-01');
  });
});
