import type { DateStr, TimeStr } from './dates';

export const ROLES = ['SUPER_ADMIN', 'REPORTING_MANAGER', 'EMPLOYEE', 'MANAGEMENT'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin',
  REPORTING_MANAGER: 'Reporting Manager',
  EMPLOYEE: 'Employee',
  MANAGEMENT: 'Management',
};

export const ACCOUNT_STATUSES = ['PENDING_ACTIVATION', 'ACTIVE', 'DEACTIVATED', 'ARCHIVED'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Execution status of a task. Deliberately separate from the report's review status. */
export const TASK_STATUSES = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const SUBMISSION_STATUSES = ['DRAFT', 'SUBMITTED'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const REVIEW_STATUSES = ['NOT_SUBMITTED', 'PENDING_REVIEW', 'VIEWED', 'REVIEWED', 'APPROVED', 'RETURNED'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_ACTIONS = ['VIEWED', 'REVIEWED', 'COMMENTED', 'APPROVED', 'RETURNED'] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export const PROJECT_STATUSES = ['PROPOSED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export type ReportType = 'DAILY' | 'WEEKLY';

export interface UserDoc {
  id: string;
  employeeCode: string;
  fullName: string;
  normalizedName: string;
  searchTokens: string[];
  phoneNumber: string;
  officialEmail: string | null;
  authEmail: string;
  departmentId: string;
  designation: string;
  role: Role;
  primaryReportingManagerId: string | null;
  secondaryReviewerId: string | null;
  accountStatus: AccountStatus;
  /** Set when an admin chose the password; the user is asked to pick their own at next sign-in. */
  mustChangePassword?: boolean;
  joinedAt: DateStr | null;
  activatedAt: string | null;
  deactivatedAt: string | null;
  alternatePhone: string;
  location: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

export interface DepartmentDoc {
  id: string;
  name: string;
  code: string;
  description: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Milestone {
  title: string;
  dueDate: DateStr | null;
  done: boolean;
}

export interface ProjectDoc {
  id: string;
  name: string;
  normalizedName: string;
  code: string;
  description: string;
  departmentId: string | null;
  /** Project lead: reports progress on the project. */
  ownerId: string | null;
  /** Reviews the project's progress (a Reporting Manager, Management or Super Admin). */
  reviewerId: string | null;
  participantIds: string[];
  startDate: DateStr | null;
  targetEndDate: DateStr | null;
  status: ProjectStatus;
  priority: Priority;
  milestones: Milestone[];
  requestedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskEntry {
  slot: number;
  isPrimary: boolean;
  title: string;
  description: string;
  priority: Priority;
  plannedStartTime: TimeStr | null;
  plannedEndTime: TimeStr | null;
  actualStartTime: TimeStr | null;
  actualEndTime: TimeStr | null;
  overnight: boolean;
  dueDate: DateStr | null;
  departmentId: string;
  projectId: string | null;
  category: string | null;
  collaboratorIds: string[];
  progressPercentage: number;
  status: TaskStatus;
  notes: string;
}

export interface WorkingDayInfo {
  isWorkingDay: boolean;
  reason: string;
  source: 'DEPARTMENT_EXCEPTION' | 'COMPANY_EXCEPTION' | 'WEEKLY_POLICY';
  exceptionName: string | null;
}

interface ReviewFields {
  submissionStatus: SubmissionStatus;
  reviewStatus: ReviewStatus;
  /** True while submitted and waiting for a reviewer decision (PENDING_REVIEW, VIEWED, REVIEWED). */
  awaitingReview: boolean;
  /** Edit counter used for optimistic concurrency. */
  revision: number;
  /** Submission version; 0 until first submitted, incremented on each (re)submission or admin correction. */
  version: number;
  primaryReviewerId: string | null;
  secondaryReviewerId: string | null;
  submittedAt: string | null;
  firstSubmittedAt: string | null;
  submittedLate: boolean;
  viewedAt: string | null;
  viewedBy: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  returnedAt: string | null;
  returnedBy: string | null;
  lastReviewComment: string | null;
  lastAdminCorrectionAt: string | null;
  needsReReview: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DailyReportDoc extends ReviewFields {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  departmentId: string;
  workDate: DateStr;
  timezone: string;
  workingDay: WorkingDayInfo;
  isHolidayWork: boolean;
  tasks: TaskEntry[];
  projectIds: string[];
  employeeNotes: string;
}

/** Denormalized per-task index used for project / workload analytics queries. */
export interface TaskDoc extends TaskEntry {
  id: string;
  reportId: string;
  employeeId: string;
  workDate: DateStr;
  reportVersion: number;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectBreakdown {
  projectId: string | null;
  projectName: string;
  tasks: number;
  completed: number;
  inProgress: number;
  pending: number;
  blocked: number;
  activeDays: number;
}

export interface WeeklySummary {
  workingDays: number;
  workingDates: DateStr[];
  dailyReportsSubmitted: number;
  holidayWorkReports: number;
  missingReportDates: DateStr[];
  tasksPlanned: number;
  tasksCompleted: number;
  tasksInProgress: number;
  tasksPending: number;
  tasksBlocked: number;
  tasksOverdue: number;
  averageProgress: number | null;
  projects: ProjectBreakdown[];
  collaborators: { id: string; name: string; tasks: number }[];
  calculatedAt: string;
}

export interface WeeklyNarrative {
  majorAccomplishments: string;
  projectProgress: string;
  keyDeliverables: string;
  blockers: string;
  decisionsRequired: string;
  collaborationSummary: string;
  nextWeekPlan: string;
  employeeComments: string;
}

export interface WeeklyReportDoc extends ReviewFields {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  departmentId: string;
  periodStart: DateStr;
  periodEnd: DateStr;
  dailyReportIds: string[];
  calculatedSummary: WeeklySummary;
  narrative: WeeklyNarrative;
}

export interface ReviewDoc {
  id: string;
  reportType: ReportType;
  reportId: string;
  employeeId: string;
  reviewerId: string;
  reviewerName: string;
  action: ReviewAction;
  comment: string;
  reportVersion: number;
  createdAt: string;
}

export interface ReportVersionDoc {
  id: string;
  reportType: ReportType;
  reportId: string;
  employeeId: string;
  version: number;
  source: 'EMPLOYEE_SUBMISSION' | 'ADMIN_CORRECTION';
  actorId: string;
  actorName: string;
  reason: string;
  snapshot: Record<string, unknown>;
  createdAt: string;
}

export interface CalendarPolicy {
  effectiveFrom: DateStr;
  workingWeekdays: number[];
  note: string;
  createdAt: string;
  createdBy: string;
}

export interface CalendarExceptionDoc {
  id: string;
  date: DateStr;
  type: 'HOLIDAY' | 'WORKING_DAY';
  name: string;
  description: string;
  departmentId: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

export interface SystemSettings {
  companyName: string;
  timezone: string;
  weekStartDay: number;
  calendarPolicies: CalendarPolicy[];
  dailyDeadlineDayOffset: number;
  dailyDeadlineTime: TimeStr;
  dailyGraceMinutes: number;
  weeklyDeadlineDayOffset: number;
  weeklyDeadlineTime: TimeStr;
  /** Times of day (company time) for the "complete your 3 priority tasks" reminders. Sorted. */
  reminderTimes: TimeStr[];
  primaryTaskSlots: number;
  minTasksForSubmission: number;
  allowAdditionalTasks: boolean;
  maxAdditionalTasks: number;
  allowOvernightTasks: boolean;
  maxBackdateDays: number;
  reReviewOnAdminCorrection: boolean;
  allowSelfRegistration: boolean;
  allowProjectRequests: boolean;
  reportingRoles: Role[];
  taskCategories: string[];
  notificationTypesEnabled: Record<NotificationType, boolean>;
  updatedAt: string;
  updatedBy: string | null;
}

export const NOTIFICATION_TYPES = [
  'DAILY_SUBMITTED',
  'WEEKLY_SUBMITTED',
  'REPORT_APPROVED',
  'REPORT_RETURNED',
  'FEEDBACK_RECEIVED',
  'REVIEW_REQUESTED',
  'TASK_OVERDUE',
  'DEADLINE_UPCOMING',
  'ACCOUNT_ACTIVATED',
  'MANAGER_REASSIGNED',
  'PROJECT_ASSIGNED',
  'COLLABORATOR_ADDED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationDoc {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

export interface AuditLogDoc {
  id: string;
  actorId: string | null;
  actorName: string;
  actorRole: Role | 'SYSTEM' | 'PUBLIC';
  action: string;
  entityType: string;
  entityId: string;
  timestamp: string;
  reason: string;
  beforeSnapshot: Record<string, unknown> | null;
  afterSnapshot: Record<string, unknown> | null;
  requestCorrelationId: string;
}

export interface ActivationTokenDoc {
  id: string; // SHA-256 hash of the token; the raw token is never stored
  userId: string;
  purpose: 'ACTIVATION' | 'PASSWORD_SET';
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
  createdBy: string;
}

export interface RegistrationRequestDoc {
  id: string;
  fullName: string;
  employeeCode: string;
  phoneNumber: string;
  officialEmail: string | null;
  departmentId: string | null;
  designation: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string;
  createdUserId: string | null;
  createdAt: string;
}

export interface UniqueKeyDoc {
  id: string;
  ownerId: string;
  createdAt: string;
}

/** Collection names in one place so stores, rules and indexes stay consistent. */
export const COL = {
  users: 'users',
  departments: 'departments',
  projects: 'projects',
  dailyReports: 'dailyReports',
  tasks: 'tasks',
  weeklyReports: 'weeklyReports',
  reportReviews: 'reportReviews',
  reportVersions: 'reportVersions',
  workCalendar: 'workCalendar',
  notifications: 'notifications',
  auditLogs: 'auditLogs',
  systemSettings: 'systemSettings',
  activationTokens: 'activationTokens',
  registrationRequests: 'registrationRequests',
  uniqueKeys: 'uniqueKeys',
  dailyRoutines: 'dailyRoutines',
} as const;
export type CollectionName = (typeof COL)[keyof typeof COL];
