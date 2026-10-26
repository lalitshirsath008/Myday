import type { Role, UserDoc } from './types';

/**
 * Role-permission matrix. This is the single source of truth: the backend checks it on every
 * operation and the web app uses it only to decide what navigation to show.
 */
export const PERMISSIONS = {
  'reviews.team': ['REPORTING_MANAGER'],
  'team.view': ['REPORTING_MANAGER'],
  'reports.viewAll': ['MANAGEMENT', 'SUPER_ADMIN'],
  'analytics.company': ['MANAGEMENT', 'SUPER_ADMIN'],
  'directory.full': ['MANAGEMENT', 'SUPER_ADMIN'],
  'export.company': ['MANAGEMENT', 'SUPER_ADMIN'],
  'export.team': ['REPORTING_MANAGER'],
  'admin.users': ['SUPER_ADMIN'],
  'admin.departments': ['SUPER_ADMIN'],
  'admin.projects': ['SUPER_ADMIN'],
  'admin.calendar': ['SUPER_ADMIN'],
  'admin.settings': ['SUPER_ADMIN'],
  'admin.reports.correct': ['SUPER_ADMIN'],
  'admin.audit': ['SUPER_ADMIN'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export const PERMISSION_LABELS: Record<Permission, string> = {
  'reviews.team': 'Review, approve and return reports of assigned employees',
  'team.view': 'View assigned employees and their reports',
  'reports.viewAll': 'View all reports company-wide (read-only)',
  'analytics.company': 'Company-wide analytics and dashboards',
  'directory.full': 'Full employee directory and profiles',
  'export.company': 'Export company-wide reports',
  'export.team': 'Export reports of assigned employees',
  'admin.users': 'Create, edit, deactivate users; assign roles and managers',
  'admin.departments': 'Manage departments',
  'admin.projects': 'Manage projects and workstreams',
  'admin.calendar': 'Configure work calendar and holidays',
  'admin.settings': 'Configure system settings',
  'admin.reports.correct': 'Make audited corrections to submitted reports',
  'admin.audit': 'View audit logs',
};

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export function isAssignedReviewer(actor: Pick<UserDoc, 'id' | 'role'>, employee: Pick<UserDoc, 'id' | 'primaryReportingManagerId' | 'secondaryReviewerId'>): boolean {
  return (
    actor.role === 'REPORTING_MANAGER' &&
    actor.id !== employee.id &&
    (employee.primaryReportingManagerId === actor.id || employee.secondaryReviewerId === actor.id)
  );
}

/** May `actor` read the reports and work history of `employee`? */
export function canViewEmployee(actor: Pick<UserDoc, 'id' | 'role'>, employee: Pick<UserDoc, 'id' | 'primaryReportingManagerId' | 'secondaryReviewerId'>): boolean {
  if (actor.id === employee.id) return true;
  if (can(actor.role, 'reports.viewAll')) return true;
  return isAssignedReviewer(actor, employee);
}

/** Roles a reporting manager / reviewer slot may hold. */
export const REVIEWER_ROLES: Role[] = ['REPORTING_MANAGER'];
