import { z } from 'zod';
import { dailyDeadline, policyFor, resolveWorkingDay } from '../calendar';
import { dateRange, diffDays, monthBounds, todayIn } from '../dates';
import { AppError, invalid, notFound, precondition } from '../errors';
import { dateStr } from '../schemas';
import { withSettingsDefaults } from '../settings';
import { COL, type CalendarExceptionDoc, type DailyReportDoc, type SystemSettings } from '../types';
import { nowIso, op, requirePermission } from './context';
import { audit, getExceptions, getSettings, getViewableEmployee, projectsById, SETTINGS_ID } from './helpers';
import { type RoutineDoc, routineId } from './routine';

const exceptionId = (date: string, departmentId: string | null) => `${date}_${departmentId ?? 'ALL'}`;

export const calendarOps = {
  /**
   * Outlook-style calendar for a date range (up to 6 weeks): working days, the person's daily-report
   * tasks and, on your own calendar, your private My day items. Someone else's calendar (within the
   * viewer's normal scope) shows submitted reports only and never their My day list.
   */
  'calendar.events': op({
    input: z.object({ from: dateStr, to: dateStr, employeeId: z.string().min(1).nullable().default(null) }),
    run: async (ctx, { from, to, employeeId }) => {
      if (to < from) throw invalid('The end date must be on or after the start date.');
      if (diffDays(from, to) > 41) throw invalid('Choose a range of 6 weeks or less.');
      const settings = await getSettings(ctx);
      const isSelf = !employeeId || employeeId === ctx.actor.id;
      const person = isSelf ? ctx.actor : await getViewableEmployee(ctx, employeeId);
      const dates = dateRange(from, to);
      const [exceptions, reports, routines] = await Promise.all([
        getExceptions(ctx, from, to),
        ctx.store.query<DailyReportDoc & { id: string }>(COL.dailyReports, { where: [['employeeId', '==', person.id], ['workDate', '>=', from], ['workDate', '<=', to]] }),
        isSelf ? ctx.store.getMany<RoutineDoc & { id: string }>(COL.dailyRoutines, dates.map((d) => routineId(person.id, d))) : Promise.resolve([]),
      ]);
      const visible = isSelf ? reports : reports.filter((r) => r.submissionStatus === 'SUBMITTED');
      const projects = await projectsById(ctx, visible.flatMap((r) => r.tasks.map((t) => t.projectId)));
      return {
        from,
        to,
        today: todayIn(settings.timezone, ctx.now()),
        person: { id: person.id, fullName: person.fullName, employeeCode: person.employeeCode },
        isSelf,
        days: dates.map((date) => ({ date, ...resolveWorkingDay(date, settings.calendarPolicies, exceptions, person.departmentId) })),
        reports: visible.map((r) => ({ id: r.id, workDate: r.workDate, submissionStatus: r.submissionStatus, reviewStatus: r.reviewStatus })),
        tasks: visible.flatMap((r) =>
          r.tasks
            .filter((t) => t.title.trim())
            .map((t) => ({
              reportId: r.id,
              workDate: r.workDate,
              slot: t.slot,
              isPrimary: t.isPrimary,
              title: t.title,
              description: t.description,
              status: t.status,
              priority: t.priority,
              progressPercentage: t.progressPercentage,
              plannedStartTime: t.plannedStartTime,
              plannedEndTime: t.plannedEndTime,
              actualStartTime: t.actualStartTime,
              actualEndTime: t.actualEndTime,
              overnight: t.overnight,
              projectName: t.projectId ? (projects.get(t.projectId)?.name ?? null) : null,
              collaborators: t.collaboratorIds.length,
            })),
        ),
        routine: routines.flatMap((d) => d.items.map((i) => ({ date: d.date, id: i.id, text: i.text, time: i.time, done: i.done }))),
      };
    },
  }),

  'calendar.month': op({
    input: z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), departmentId: z.string().nullable().default(null) }),
    run: async (ctx, { month, departmentId }) => {
      const settings = await getSettings(ctx);
      const dept = ctx.actor.role === 'SUPER_ADMIN' || ctx.actor.role === 'MANAGEMENT' ? departmentId : ctx.actor.departmentId;
      const { from, to } = monthBounds(month);
      const exceptions = await getExceptions(ctx, from, to);
      const visible = ctx.actor.role === 'SUPER_ADMIN' ? exceptions : exceptions.filter((e) => e.departmentId === null || e.departmentId === dept);
      return {
        month,
        today: todayIn(settings.timezone, ctx.now()),
        departmentId: dept,
        days: dateRange(from, to).map((date) => ({
          date,
          ...resolveWorkingDay(date, settings.calendarPolicies, exceptions, dept),
          deadline: dailyDeadline(date, settings).toISOString(),
          weeklyPolicy: policyFor(date, settings.calendarPolicies),
        })),
        exceptions: visible.sort((a, b) => a.date.localeCompare(b.date)),
        policies: [...settings.calendarPolicies].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)),
      };
    },
  }),

  /**
   * Add a new weekly working-day policy from a date onward. Earlier policies are kept unchanged,
   * so compliance for past dates is still computed against the rules that applied then.
   */
  'admin.calendar.setPolicy': op({
    input: z.object({
      effectiveFrom: dateStr,
      workingWeekdays: z.array(z.number().int().min(0).max(6)).max(7),
      note: z.string().trim().max(300).default(''),
    }),
    run: async (ctx, input) => {
      requirePermission(ctx, 'admin.calendar');
      const settings = await getSettings(ctx);
      const today = todayIn(settings.timezone, ctx.now());
      if (input.effectiveFrom < today) throw invalid('Policy changes can only take effect today or later, to keep past compliance accurate.');
      return ctx.store.transaction(async (tx) => {
        const stored = await tx.get<SystemSettings & { id: string }>(COL.systemSettings, SETTINGS_ID);
        const s = withSettingsDefaults(stored, nowIso(ctx));
        const policy = { effectiveFrom: input.effectiveFrom, workingWeekdays: [...new Set(input.workingWeekdays)].sort(), note: input.note, createdAt: nowIso(ctx), createdBy: ctx.actor.id };
        const replaced = s.calendarPolicies.find((p) => p.effectiveFrom === input.effectiveFrom) ?? null;
        const policies = [...s.calendarPolicies.filter((p) => p.effectiveFrom !== input.effectiveFrom), policy];
        tx.set(COL.systemSettings, SETTINGS_ID, { ...s, id: SETTINGS_ID, calendarPolicies: policies, updatedAt: nowIso(ctx), updatedBy: ctx.actor.id } as unknown as SystemSettings & { id: string });
        audit(tx, ctx, {
          action: 'CALENDAR_POLICY_SET',
          entityType: 'workCalendar',
          entityId: `policy_${input.effectiveFrom}`,
          reason: input.note,
          beforeSnapshot: replaced as unknown as Record<string, unknown>,
          afterSnapshot: policy as unknown as Record<string, unknown>,
        });
        return { policies };
      });
    },
  }),

  'admin.calendar.upsertException': op({
    input: z.object({
      date: dateStr,
      type: z.enum(['HOLIDAY', 'WORKING_DAY']),
      name: z.string().trim().min(2).max(100),
      description: z.string().trim().max(500).default(''),
      departmentId: z.string().nullable().default(null),
    }),
    run: async (ctx, input) => {
      requirePermission(ctx, 'admin.calendar');
      const settings = await getSettings(ctx);
      const today = todayIn(settings.timezone, ctx.now());
      if (input.date < today) throw precondition('Past calendar dates are locked so historical compliance stays accurate.');
      if (input.departmentId && !(await ctx.store.get(COL.departments, input.departmentId))) throw notFound('Department');
      const id = exceptionId(input.date, input.departmentId);
      return ctx.store.transaction(async (tx) => {
        const before = await tx.get<CalendarExceptionDoc & { id: string }>(COL.workCalendar, id);
        const now = nowIso(ctx);
        const doc: CalendarExceptionDoc = { id, ...input, createdAt: before?.createdAt ?? now, createdBy: before?.createdBy ?? ctx.actor.id, updatedAt: now };
        tx.set(COL.workCalendar, id, doc as unknown as CalendarExceptionDoc & { id: string });
        audit(tx, ctx, {
          action: before ? 'CALENDAR_EXCEPTION_UPDATED' : 'CALENDAR_EXCEPTION_CREATED',
          entityType: 'workCalendar',
          entityId: id,
          beforeSnapshot: before as unknown as Record<string, unknown>,
          afterSnapshot: doc as unknown as Record<string, unknown>,
        });
        return { exception: doc };
      });
    },
  }),

  'admin.calendar.deleteException': op({
    input: z.object({ id: z.string().min(1), reason: z.string().trim().max(500).default('') }),
    run: async (ctx, { id, reason }) => {
      requirePermission(ctx, 'admin.calendar');
      const settings = await getSettings(ctx);
      const today = todayIn(settings.timezone, ctx.now());
      return ctx.store.transaction(async (tx) => {
        const before = await tx.get<CalendarExceptionDoc & { id: string }>(COL.workCalendar, id);
        if (!before) throw notFound('Calendar entry');
        if (before.date < today) throw new AppError('failed-precondition', 'Past calendar dates are locked so historical compliance stays accurate.');
        tx.delete(COL.workCalendar, id);
        audit(tx, ctx, { action: 'CALENDAR_EXCEPTION_DELETED', entityType: 'workCalendar', entityId: id, reason, beforeSnapshot: before as unknown as Record<string, unknown> });
        return { ok: true as const };
      });
    },
  }),
};
