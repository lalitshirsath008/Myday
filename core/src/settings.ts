import { DEFAULT_TIMEZONE } from './dates';
import { NOTIFICATION_TYPES, type NotificationType, type SystemSettings } from './types';

/** Wednesday is the usual holiday; this is only the starting policy and is editable by Super Admin. */
export const DEFAULT_WORKING_WEEKDAYS = [0, 1, 2, 4, 5, 6];

export function defaultSettings(nowIso: string): SystemSettings {
  return {
    companyName: 'RGK Group of Industries',
    timezone: DEFAULT_TIMEZONE,
    weekStartDay: 1,
    calendarPolicies: [
      {
        effectiveFrom: '2000-01-01',
        workingWeekdays: DEFAULT_WORKING_WEEKDAYS,
        note: 'Default policy: Wednesday weekly holiday',
        createdAt: nowIso,
        createdBy: 'SYSTEM',
      },
    ],
    dailyDeadlineDayOffset: 0,
    dailyDeadlineTime: '23:59',
    dailyGraceMinutes: 0,
    weeklyDeadlineDayOffset: 1,
    weeklyDeadlineTime: '18:00',
    reminderTime: '18:00',
    primaryTaskSlots: 3,
    minTasksForSubmission: 1,
    allowAdditionalTasks: false,
    maxAdditionalTasks: 2,
    allowOvernightTasks: false,
    maxBackdateDays: 7,
    reReviewOnAdminCorrection: true,
    allowSelfRegistration: true,
    allowProjectRequests: true,
    reportingRoles: ['EMPLOYEE', 'REPORTING_MANAGER'],
    taskCategories: ['Development', 'Analysis', 'Meeting', 'Documentation', 'Testing', 'Support', 'Production', 'Maintenance', 'Training', 'Other'],
    notificationTypesEnabled: Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t, true])) as Record<NotificationType, boolean>,
    updatedAt: nowIso,
    updatedBy: null,
  };
}

/** Fill any fields missing from an older stored settings document. */
export function withSettingsDefaults(stored: Partial<SystemSettings> | null, nowIso: string): SystemSettings {
  const base = defaultSettings(nowIso);
  if (!stored) return base;
  return {
    ...base,
    ...stored,
    notificationTypesEnabled: { ...base.notificationTypesEnabled, ...(stored.notificationTypesEnabled ?? {}) },
  };
}

export function maxTasksPerReport(s: SystemSettings): number {
  return s.primaryTaskSlots + (s.allowAdditionalTasks ? s.maxAdditionalTasks : 0);
}
