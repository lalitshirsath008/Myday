import { z } from 'zod';
import { invalid, precondition, conflict } from '../errors';
import { reviewInput } from '../schemas';
import { queryIn } from '../store';
import { COL, type DailyReportDoc, type ReviewAction, type ReviewDoc, type WeeklyReportDoc } from '../types';
import { nowIso, op, requirePermission, type AuthedCtx } from './context';
import { assignedEmployees, audit, getSettings, notify } from './helpers';
import { summarizeDaily } from './daily';
import { AWAITING, reportCol, requireReviewer, requireSubmitted } from './reportCommon';
import { summarizeWeekly } from './weekly';

function reviewDoc(ctx: AuthedCtx, r: { id: string; employeeId: string; version: number }, type: 'DAILY' | 'WEEKLY', action: ReviewAction, comment: string): ReviewDoc {
  return {
    id: '',
    reportType: type,
    reportId: r.id,
    employeeId: r.employeeId,
    reviewerId: ctx.actor.id,
    reviewerName: ctx.actor.fullName,
    action,
    comment,
    reportVersion: r.version,
    createdAt: nowIso(ctx),
  };
}

const label = (type: 'DAILY' | 'WEEKLY', r: Partial<DailyReportDoc & WeeklyReportDoc>) =>
  type === 'DAILY' ? `daily report for ${r.workDate}` : `weekly report for ${r.periodStart} – ${r.periodEnd}`;

export const reviewOps = {
  /** Record that the reviewer opened the report. Opening never approves anything. */
  'review.markViewed': op({
    input: z.object({ reportType: z.enum(['DAILY', 'WEEKLY']), reportId: z.string().min(1) }),
    run: async (ctx, { reportType, reportId }) => {
      const col = reportCol(reportType);
      const pre = await ctx.store.get<(DailyReportDoc | WeeklyReportDoc) & { id: string }>(col, reportId);
      if (!pre) return { changed: false };
      await requireReviewer(ctx, pre.employeeId);
      if (pre.submissionStatus !== 'SUBMITTED') return { changed: false };
      return ctx.store.transaction(async (tx) => {
        const r = await tx.get<(DailyReportDoc | WeeklyReportDoc) & { id: string }>(col, reportId);
        const viewId = `${reportType}_${reportId}_v${r?.version}_viewed_${ctx.actor.id}`;
        const already = await tx.get(COL.reportReviews, viewId);
        if (!r || already) return { changed: false };
        if (r.reviewStatus === 'PENDING_REVIEW') {
          tx.update(col, reportId, { reviewStatus: 'VIEWED', viewedAt: nowIso(ctx), viewedBy: ctx.actor.id });
        }
        tx.create(COL.reportReviews, viewId, { ...reviewDoc(ctx, r, reportType, 'VIEWED', ''), id: viewId });
        return { changed: true };
      });
    },
  }),

  'review.act': op({
    input: reviewInput,
    run: async (ctx, input) => {
      const col = reportCol(input.reportType);
      const pre = await ctx.store.get<(DailyReportDoc | WeeklyReportDoc) & { id: string }>(col, input.reportId);
      if (!pre) throw invalid('Report not found.');
      await requireReviewer(ctx, pre.employeeId);
      const comment = input.comment.trim();
      if ((input.action === 'RETURNED' || input.action === 'COMMENTED') && comment.length < 3) {
        throw invalid(input.action === 'RETURNED' ? 'A reason is required when returning a report for correction.' : 'Write a comment first.');
      }
      const settings = await getSettings(ctx);
      return ctx.store.transaction(async (tx) => {
        const r = await tx.get<(DailyReportDoc | WeeklyReportDoc) & { id: string }>(col, input.reportId);
        if (!r) throw invalid('Report not found.');
        requireSubmitted(r);
        if (r.version !== input.reportVersion) throw conflict('The employee has changed this report since you opened it. Reload to review the latest version.');
        const decided = r.reviewStatus === 'APPROVED' || r.reviewStatus === 'RETURNED';
        if (input.action !== 'COMMENTED' && decided) {
          throw precondition(`This report is already ${r.reviewStatus === 'APPROVED' ? 'approved' : 'returned for correction'}.`);
        }
        const now = nowIso(ctx);
        const patch: Record<string, unknown> = { updatedAt: now };
        if (comment) patch.lastReviewComment = comment;
        if (input.action === 'REVIEWED') Object.assign(patch, { reviewStatus: 'REVIEWED', reviewedAt: now, reviewedBy: ctx.actor.id });
        if (input.action === 'APPROVED') Object.assign(patch, { reviewStatus: 'APPROVED', awaitingReview: false, approvedAt: now, approvedBy: ctx.actor.id, needsReReview: false });
        if (input.action === 'RETURNED') Object.assign(patch, { reviewStatus: 'RETURNED', awaitingReview: false, returnedAt: now, returnedBy: ctx.actor.id });
        if (input.action === 'COMMENTED' && r.reviewStatus === 'PENDING_REVIEW') Object.assign(patch, { reviewStatus: 'VIEWED', viewedAt: now, viewedBy: ctx.actor.id });
        tx.update(col, r.id, patch);
        const id = globalThis.crypto.randomUUID();
        tx.create(COL.reportReviews, id, { ...reviewDoc(ctx, r, input.reportType, input.action, comment), id });
        if (input.action === 'APPROVED' || input.action === 'RETURNED') {
          audit(tx, ctx, {
            action: `${input.reportType}_REPORT_${input.action}`,
            entityType: input.reportType === 'DAILY' ? 'dailyReport' : 'weeklyReport',
            entityId: r.id,
            reason: comment,
            beforeSnapshot: { reviewStatus: r.reviewStatus, version: r.version },
            afterSnapshot: { reviewStatus: patch.reviewStatus, version: r.version },
          });
        }
        const what = label(input.reportType, r as Partial<DailyReportDoc & WeeklyReportDoc>);
        const link = input.reportType === 'DAILY' ? `/reports/daily/${r.id}` : `/reports/weekly/${r.id}`;
        if (input.action === 'APPROVED') {
          notify(tx, ctx, settings, { userId: r.employeeId, type: 'REPORT_APPROVED', title: 'Report approved', body: `${ctx.actor.fullName} approved your ${what}.`, link, key: `${r.id}_v${r.version}` });
        } else if (input.action === 'RETURNED') {
          notify(tx, ctx, settings, { userId: r.employeeId, type: 'REPORT_RETURNED', title: 'Report returned for correction', body: `${ctx.actor.fullName}: ${comment}`, link, key: `${r.id}_v${r.version}` });
        } else if (comment) {
          notify(tx, ctx, settings, { userId: r.employeeId, type: 'FEEDBACK_RECEIVED', title: 'New feedback from your manager', body: `${ctx.actor.fullName} on your ${what}: ${comment}`, link });
        }
        return { reviewStatus: (patch.reviewStatus as string | undefined) ?? r.reviewStatus };
      });
    },
  }),

  /** Reports waiting for this reviewer's decision. */
  'review.pending': op({
    input: z.object({}).default({}),
    run: async (ctx) => {
      requirePermission(ctx, 'reviews.team');
      const team = await assignedEmployees(ctx, ctx.actor.id);
      const ids = team.map((u) => u.id);
      const where: [string, '==', boolean][] = [['awaitingReview', '==', true]];
      const [daily, weekly] = await Promise.all([
        queryIn<DailyReportDoc & { id: string }>(ctx.store, COL.dailyReports, 'employeeId', ids, { where }),
        queryIn<WeeklyReportDoc & { id: string }>(ctx.store, COL.weeklyReports, 'employeeId', ids, { where }),
      ]);
      const bySubmitted = (a: { submittedAt: string | null }, b: { submittedAt: string | null }) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? '');
      return {
        daily: daily.sort(bySubmitted).map(summarizeDaily),
        weekly: weekly.sort(bySubmitted).map(summarizeWeekly),
        statuses: AWAITING,
      };
    },
  }),
};
