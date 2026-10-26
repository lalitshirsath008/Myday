import { deny, notFound, precondition } from '../errors';
import { isAssignedReviewer } from '../permissions';
import type { Tx } from '../store';
import {
  COL,
  type DailyReportDoc,
  type ReportType,
  type ReportVersionDoc,
  type ReviewStatus,
  type UserDoc,
  type WeeklyReportDoc,
} from '../types';
import { nowIso, type AuthedCtx, type Ctx } from './context';
import { getUser } from './helpers';

export const AWAITING: ReviewStatus[] = ['PENDING_REVIEW', 'VIEWED', 'REVIEWED'];

export function initialReviewFields(nowIsoStr: string, employee: UserDoc) {
  return {
    submissionStatus: 'DRAFT' as const,
    reviewStatus: 'NOT_SUBMITTED' as const,
    awaitingReview: false,
    revision: 0,
    version: 0,
    primaryReviewerId: employee.primaryReportingManagerId,
    secondaryReviewerId: employee.secondaryReviewerId,
    submittedAt: null,
    firstSubmittedAt: null,
    submittedLate: false,
    viewedAt: null,
    viewedBy: null,
    reviewedAt: null,
    reviewedBy: null,
    approvedAt: null,
    approvedBy: null,
    returnedAt: null,
    returnedBy: null,
    lastReviewComment: null,
    lastAdminCorrectionAt: null,
    needsReReview: false,
    createdAt: nowIsoStr,
    updatedAt: nowIsoStr,
  };
}

/** Employees may edit only drafts and reports returned for correction. */
export function editBlockReason(r: Pick<DailyReportDoc, 'submissionStatus' | 'reviewStatus'>): string | null {
  if (r.submissionStatus === 'DRAFT') return null;
  if (r.reviewStatus === 'RETURNED') return null;
  if (r.reviewStatus === 'APPROVED') return 'This report is approved and locked. Corrections go through your administrator.';
  return 'This report has been submitted and is locked until your manager returns it for correction.';
}

export function submissionPatch(ctx: Ctx, report: { version: number; firstSubmittedAt: string | null }, employee: UserDoc, late: boolean) {
  const now = nowIso(ctx);
  return {
    submissionStatus: 'SUBMITTED' as const,
    reviewStatus: 'PENDING_REVIEW' as const,
    awaitingReview: true,
    version: report.version + 1,
    submittedAt: now,
    firstSubmittedAt: report.firstSubmittedAt ?? now,
    submittedLate: late,
    primaryReviewerId: employee.primaryReportingManagerId,
    secondaryReviewerId: employee.secondaryReviewerId,
    viewedAt: null,
    viewedBy: null,
    reviewedAt: null,
    reviewedBy: null,
    approvedAt: null,
    approvedBy: null,
    needsReReview: false,
  };
}

const CONTENT_FIELDS: Record<ReportType, string[]> = {
  DAILY: ['workDate', 'tasks', 'employeeNotes', 'isHolidayWork', 'workingDay', 'projectIds'],
  WEEKLY: ['periodStart', 'periodEnd', 'narrative', 'calculatedSummary', 'dailyReportIds'],
};

export function contentSnapshot(type: ReportType, report: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(CONTENT_FIELDS[type].map((k) => [k, report[k]]));
}

export function writeVersion(
  tx: Tx,
  ctx: AuthedCtx,
  type: ReportType,
  report: { id: string; employeeId: string } & Record<string, unknown>,
  version: number,
  source: ReportVersionDoc['source'],
  reason: string,
): void {
  const id = `${type}_${report.id}_v${version}`;
  const doc: ReportVersionDoc = {
    id,
    reportType: type,
    reportId: report.id,
    employeeId: report.employeeId,
    version,
    source,
    actorId: ctx.actor.id,
    actorName: ctx.actor.fullName,
    reason,
    snapshot: contentSnapshot(type, report),
    createdAt: nowIso(ctx),
  };
  tx.create(COL.reportVersions, id, doc as unknown as ReportVersionDoc & { id: string });
}

export const reportCol = (t: ReportType) => (t === 'DAILY' ? COL.dailyReports : COL.weeklyReports);

export async function loadReport(ctx: Ctx, type: ReportType, id: string): Promise<DailyReportDoc | WeeklyReportDoc> {
  const r = await ctx.store.get<(DailyReportDoc | WeeklyReportDoc) & { id: string }>(reportCol(type), id);
  if (!r) throw notFound('Report');
  return r;
}

/** Load the report's employee and require the actor to be their current reviewer. */
export async function requireReviewer(ctx: AuthedCtx, employeeId: string): Promise<UserDoc> {
  const employee = await getUser(ctx, employeeId);
  if (!isAssignedReviewer(ctx.actor, employee)) throw deny('Only the assigned Reporting Manager or reviewer can review this report.');
  return employee;
}

export async function listVersions(ctx: Ctx, type: ReportType, reportId: string) {
  const versions = await ctx.store.query<ReportVersionDoc & { id: string }>(COL.reportVersions, {
    where: [
      ['reportId', '==', reportId],
      ['reportType', '==', type],
    ],
    orderBy: [['version', 'asc']],
  });
  return versions.map(({ snapshot: _s, ...meta }) => meta);
}

export async function getVersion(ctx: Ctx, type: ReportType, reportId: string, version: number) {
  const v = await ctx.store.get<ReportVersionDoc & { id: string }>(COL.reportVersions, `${type}_${reportId}_v${version}`);
  if (!v) throw notFound('Report version');
  return v;
}

export function requireSubmitted(r: { submissionStatus: string }): void {
  if (r.submissionStatus !== 'SUBMITTED') throw precondition('This report has not been submitted yet.');
}
