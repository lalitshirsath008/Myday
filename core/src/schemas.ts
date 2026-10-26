import { z } from 'zod';
import { isDateStr, isTimeStr } from './dates';
import { ACCOUNT_STATUSES, PRIORITIES, PROJECT_STATUSES, ROLES, TASK_STATUSES } from './types';

export const dateStr = z.string().refine(isDateStr, 'Use a valid date (YYYY-MM-DD)');
export const timeStr = z.string().refine(isTimeStr, 'Use a valid time (HH:mm)');
const optTime = timeStr.nullable();
const id = z.string().min(1).max(128);
const text = (max: number) => z.string().trim().max(max);

/** Indian mobile numbers: 10 digits starting 6-9, optional +91 / 0 prefix. Normalised to 10 digits. */
export const phoneNumber = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, '').replace(/^(\+91|0)/, ''))
  .refine((v) => /^[6-9]\d{9}$/.test(v), 'Enter a valid 10-digit mobile number');

export const employeeCode = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => /^[A-Z0-9][A-Z0-9-]{1,19}$/.test(v), 'Employee code: 2–20 letters, digits or hyphens');

export const password = z
  .string()
  .min(8, 'At least 8 characters')
  .max(128)
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Use letters and at least one number');

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .refine((v) => v === null || z.email().safeParse(v).success, 'Enter a valid email');

/** One task card in the daily report form. Cross-field time rules are checked in `validateTaskTimes`. */
export const taskInput = z.object({
  title: text(200).min(1, 'Task title is required'),
  description: text(4000).min(1, 'Task description is required'),
  priority: z.enum(PRIORITIES),
  plannedStartTime: optTime,
  plannedEndTime: optTime,
  actualStartTime: optTime,
  actualEndTime: optTime,
  overnight: z.boolean().default(false),
  dueDate: dateStr.nullable(),
  projectId: id.nullable(),
  category: text(60).nullable(),
  collaboratorIds: z.array(id).max(20).default([]),
  progressPercentage: z.number().int().min(0).max(100),
  status: z.enum(TASK_STATUSES),
  notes: text(2000).default(''),
});
export type TaskInput = z.infer<typeof taskInput>;

export const dailySaveInput = z.object({
  workDate: dateStr,
  tasks: z.array(taskInput).max(10),
  employeeNotes: text(4000).default(''),
  submit: z.boolean().default(false),
  expectedRevision: z.number().int().min(0).nullable(),
});

export const narrativeInput = z.object({
  majorAccomplishments: text(6000).default(''),
  projectProgress: text(6000).default(''),
  keyDeliverables: text(6000).default(''),
  blockers: text(6000).default(''),
  decisionsRequired: text(6000).default(''),
  collaborationSummary: text(6000).default(''),
  nextWeekPlan: text(6000).default(''),
  employeeComments: text(6000).default(''),
});

export const weeklySaveInput = z.object({
  periodStart: dateStr,
  narrative: narrativeInput,
  submit: z.boolean().default(false),
  expectedRevision: z.number().int().min(0).nullable(),
});

export const reviewInput = z.object({
  reportType: z.enum(['DAILY', 'WEEKLY']),
  reportId: id,
  action: z.enum(['REVIEWED', 'COMMENTED', 'APPROVED', 'RETURNED']),
  comment: text(4000).default(''),
  reportVersion: z.number().int().min(1),
});

export const employeeFields = z.object({
  fullName: text(120).min(2, 'Full name is required'),
  employeeCode,
  phoneNumber,
  officialEmail: optionalEmail,
  departmentId: id,
  designation: text(120).min(1, 'Designation is required'),
  role: z.enum(ROLES),
  primaryReportingManagerId: id.nullable(),
  secondaryReviewerId: id.nullable(),
  joinedAt: dateStr.nullable(),
});

export const userUpdateInput = z.object({
  userId: id,
  fullName: text(120).min(2).optional(),
  employeeCode: employeeCode.optional(),
  phoneNumber: phoneNumber.optional(),
  officialEmail: optionalEmail.optional(),
  departmentId: id.optional(),
  designation: text(120).min(1).optional(),
  joinedAt: dateStr.nullable().optional(),
  reason: text(500).default(''),
});

export const registrationInput = z.object({
  fullName: text(120).min(2, 'Full name is required'),
  employeeCode,
  phoneNumber,
  officialEmail: optionalEmail,
  departmentId: id.nullable(),
  designation: text(120).default(''),
});

export const accountStatusInput = z.enum(ACCOUNT_STATUSES);

export const projectInput = z.object({
  id: id.nullable(),
  name: text(120).min(2, 'Project name is required'),
  code: z.string().trim().toUpperCase().min(2).max(20),
  description: text(4000).default(''),
  departmentId: id.nullable(),
  ownerId: id.nullable(),
  reviewerId: id.nullable().default(null),
  participantIds: z.array(id).max(200).default([]),
  startDate: dateStr.nullable(),
  targetEndDate: dateStr.nullable(),
  status: z.enum(PROJECT_STATUSES),
  priority: z.enum(PRIORITIES),
  milestones: z
    .array(z.object({ title: text(200).min(1), dueDate: dateStr.nullable(), done: z.boolean() }))
    .max(50)
    .default([]),
});

export const dateRangeInput = z
  .object({ from: dateStr, to: dateStr })
  .refine((r) => r.from <= r.to, 'Start date must be on or before end date');

export const reasonRequired = text(1000).min(3, 'A reason is required');
