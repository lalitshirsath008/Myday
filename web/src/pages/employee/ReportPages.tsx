import { addDays, REVIEW_STATUSES, type DailySummaryRow, type WeeklySummaryRow } from '@rgk/core';
import { ChevronLeft, ChevronRight, Edit3, Plus, Printer, ShieldAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ExportMenu } from '@/components/common/ExportMenu';
import { DateRangeFilter, FilterSelect, FilterSheetButton, rangeFor, useDepartments, useProjects, type RangePreset } from '@/components/common/filters';
import { DefinitionList, ListCard, PageHeader } from '@/components/common/layout';
import { StatusBadge, statusLabel } from '@/components/common/StatusBadge';
import { ReviewPanel, ReviewTimeline, TaskCardView, VersionHistory } from '@/components/reports/ReportParts';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Disclosure, EmptyState, ErrorState, Notice, PageSkeleton, Segmented, Skeleton } from '@/components/ui/misc';
import { PillSwitch } from '@/components/ui/pill-switch';
import { useOp, useOpMutation } from '@/lib/api';
import { useMe } from '@/lib/session';
import { fmtDate, fmtDateTime, fmtShortDate } from '@/lib/utils';

type Mode = 'own' | 'team' | 'admin';

const HUB_TITLE: Record<Mode, string> = { own: 'Report history', team: 'Team reports', admin: 'Reports' };

/** Daily | Weekly switch: the two report lists read as one page with two tabs. */
function ReportTabs({ mode, current }: { mode: Mode; current: 'daily' | 'weekly' }) {
  const navigate = useNavigate();
  const base = mode === 'team' ? '/reviews' : mode === 'admin' ? '/admin/reports' : '/reports';
  return (
    <PillSwitch
      label="Report type"
      value={current}
      onChange={(v) => navigate(`${base}/${v}`, { replace: true })}
      options={[
        { value: 'daily', label: 'Daily' },
        { value: 'weekly', label: 'Weekly' },
      ]}
      className="no-print mb-4 w-full sm:w-[260px]"
    />
  );
}
type StatusChip = '' | 'PENDING_REVIEW' | 'APPROVED' | 'RETURNED';
const STATUS_CHIPS: { value: StatusChip; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'PENDING_REVIEW', label: 'Waiting' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'RETURNED', label: 'Needs changes' },
];

function Pager({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  if (total <= pageSize) return null;
  const pages = Math.ceil(total / pageSize);
  return (
    <div className="mt-4 flex items-center justify-center gap-3 text-[13px] text-muted-foreground">
      <Button variant="outline" size="icon" onClick={() => onPage(page - 1)} disabled={page === 0} aria-label="Previous page">
        <ChevronLeft />
      </Button>
      Page {page + 1} of {pages}
      <Button variant="outline" size="icon" onClick={() => onPage(page + 1)} disabled={page >= pages - 1} aria-label="Next page">
        <ChevronRight />
      </Button>
    </div>
  );
}

export function ReportCard({ r, to, showEmployee }: { r: DailySummaryRow; to: string; showEmployee?: boolean }) {
  const projects = useProjects(true);
  const projectName = r.projectIds[0] ? projects.name(r.projectIds[0]) : null;
  return (
    <ListCard to={to}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {showEmployee && <p className="truncate text-[12px] font-medium text-brand">{r.employeeName}</p>}
          <p className="text-[15px] font-semibold">{fmtDate(r.workDate, { weekday: 'long', day: 'numeric', month: 'short' })}</p>
        </div>
        <StatusBadge status={r.version > 0 ? r.reviewStatus : 'DRAFT'} />
      </div>
      <p className="mt-1 truncate text-[13px] text-muted-foreground">
        {[projectName, `${r.taskCount} task${r.taskCount === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
        <span className="font-medium text-foreground/80">
          {r.completed} of {r.taskCount} completed
        </span>
        {r.submittedAt && <span>Sent {fmtDateTime(r.submittedAt).split(',').slice(-1)[0]?.trim()}</span>}
        {r.submittedLate && <span className="text-warning">Late</span>}
        {r.isHolidayWork && <span className="text-info">Holiday work</span>}
        {r.needsReReview && <span className="text-warning">Re-review</span>}
      </div>
    </ListCard>
  );
}

/**
 * Daily report list. The server applies the real scope (own reports, assigned team, or company-wide)
 * regardless of what the UI asks for.
 */
export function DailyReportListPage({ mode }: { mode: Mode }) {
  const me = useMe();
  const departments = useDepartments();
  const projects = useProjects(mode !== 'own');
  const [range, setRange] = useState<{ preset: RangePreset; from: string; to: string }>({ preset: 'last30', ...rangeFor('last30', me.today) });
  const [reviewStatus, setReviewStatus] = useState<StatusChip>('');
  const [departmentId, setDepartmentId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [taskStatus, setTaskStatus] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 30;
  const filters = {
    from: range.from,
    to: range.to,
    employeeId: mode === 'own' ? me.user.id : null,
    departmentId: departmentId || null,
    reviewStatus: (reviewStatus || null) as (typeof REVIEW_STATUSES)[number] | null,
    projectId: projectId || null,
    taskStatus: (taskStatus || null) as 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'BLOCKED' | null,
    includeDrafts: mode === 'own',
    limit: pageSize,
    offset: page * pageSize,
  };
  const q = useOp('daily.list', filters, { placeholderData: (p) => p });
  const sheetCount = [departmentId, projectId, taskStatus].filter(Boolean).length;
  const detailBase = mode === 'team' ? '/reviews/daily' : mode === 'admin' ? '/admin/reports/daily' : '/reports/daily';

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={HUB_TITLE[mode]}
        actions={
          <>
            {mode === 'own' && (
              <Button asChild size="sm">
                <Link to="/daily/today">
                  <Plus /> Today
                </Link>
              </Button>
            )}
            <ExportMenu request={{ kind: 'dailyTasks', filters: { ...filters, includeDrafts: false, offset: 0, limit: 200 } }} filename={`daily-reports-${range.from}-to-${range.to}`} compact />
          </>
        }
      />
      <ReportTabs mode={mode} current="daily" />
      <div className="no-print mb-4 space-y-2.5">
        <DateRangeFilter {...range} today={me.today} presets={['last7', 'last30', 'thisMonth', 'lastMonth', 'custom']} onChange={(v) => { setRange(v); setPage(0); }} />
        <div className="flex items-center gap-2">
          <Segmented label="Review status" className="flex-1" value={reviewStatus} onChange={(v) => { setReviewStatus(v); setPage(0); }} options={STATUS_CHIPS} />
          <FilterSheetButton activeCount={sheetCount} onReset={() => { setDepartmentId(''); setProjectId(''); setTaskStatus(''); setPage(0); }}>
            <FilterSelect label="Task status" value={taskStatus} onChange={(v) => { setTaskStatus(v); setPage(0); }} options={['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED'].map((s) => ({ value: s, label: statusLabel(s) }))} />
            <FilterSelect label="Project" value={projectId} onChange={(v) => { setProjectId(v); setPage(0); }} options={projects.items.map((p) => ({ value: p.id, label: p.name }))} />
            {mode !== 'own' && <FilterSelect label="Department" value={departmentId} onChange={(v) => { setDepartmentId(v); setPage(0); }} options={departments.items.map((d) => ({ value: d.id, label: d.name }))} />}
          </FilterSheetButton>
        </div>
      </div>
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <div className="space-y-2.5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : q.data?.items.length === 0 ? (
        <Card>
          <EmptyState title="No reports here" description="Try another date range or status." />
        </Card>
      ) : (
        <>
          <p className="mb-2 text-[12px] text-muted-foreground">{q.data?.total} report{q.data?.total === 1 ? '' : 's'}</p>
          <div className="space-y-2.5">
            {q.data?.items.map((r) => (
              <ReportCard key={r.id} r={r} to={r.version > 0 ? `${detailBase}/${r.id}` : `/daily/${r.workDate}`} showEmployee={mode !== 'own'} />
            ))}
          </div>
          <Pager page={page} total={q.data?.total ?? 0} pageSize={pageSize} onPage={setPage} />
        </>
      )}
    </div>
  );
}

export function DailyReportDetailPage({ mode }: { mode: 'own' | 'review' | 'admin' }) {
  const { id = '' } = useParams();
  const me = useMe();
  const q = useOp('daily.get', { reportId: id });
  const markViewed = useOpMutation('review.markViewed', { invalidate: ['daily.get', 'review.pending', 'manager.dashboard'], silent: true });
  const viewedFor = useRef<string | null>(null);

  useEffect(() => {
    const d = q.data;
    if (d?.canReview && d.report.submissionStatus === 'SUBMITTED' && viewedFor.current !== `${id}-${d.report.version}`) {
      viewedFor.current = `${id}-${d.report.version}`;
      markViewed.mutate({ reportType: 'DAILY', reportId: id });
    }
  }, [q.data, id, markViewed]);

  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { report, employee } = q.data;
  const back = mode === 'review' ? { to: '/reviews/pending', label: 'To review' } : mode === 'admin' ? { to: '/admin/reports/daily', label: 'Reports' } : { to: '/reports/daily', label: 'Report history' };
  const done = report.tasks.filter((t) => t.status === 'COMPLETED').length;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        back={back}
        title={fmtDate(report.workDate, { weekday: 'long', day: 'numeric', month: 'short' })}
        description={q.data.isOwner ? `${done} of ${report.tasks.length} tasks completed` : `${employee.fullName} · ${done} of ${report.tasks.length} completed`}
        actions={
          <>
            {q.data.isOwner && (report.submissionStatus === 'DRAFT' || report.reviewStatus === 'RETURNED') && (
              <Button asChild size="sm">
                <Link to={`/daily/${report.workDate}`}>
                  <Edit3 /> {report.reviewStatus === 'RETURNED' ? 'Make changes' : 'Edit draft'}
                </Link>
              </Button>
            )}
            {q.data.canCorrect && report.submissionStatus === 'SUBMITTED' && (
              <Button asChild variant="outline" size="sm">
                <Link to={`/admin/reports/daily/${report.id}/correct`}>
                  <ShieldAlert /> Administrative correction
                </Link>
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={() => window.print()} aria-label="Print or save as PDF">
              <Printer />
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={report.submissionStatus === 'DRAFT' ? 'DRAFT' : report.reviewStatus} />
        {report.isHolidayWork && <StatusBadge status="HOLIDAY_WORK" />}
        {report.submittedLate && <StatusBadge status="SUBMITTED_LATE" />}
        {report.version > 1 && <span className="text-[12px] text-muted-foreground">Version {report.version}</span>}
      </div>

      {report.reviewStatus === 'RETURNED' && q.data.isOwner && <Notice tone="danger" title="Your manager asked for changes">{report.lastReviewComment}</Notice>}
      {report.needsReReview && <Notice tone="warning">Corrected by an administrator after approval — back in review.</Notice>}
      {report.lastAdminCorrectionAt && <Notice tone="info">Includes an administrator correction ({fmtDateTime(report.lastAdminCorrectionAt)}). The original is kept in the version history.</Notice>}

      <section className="space-y-3 print-area" aria-label="Tasks">
        {report.tasks.map((t) => (
          <TaskCardView key={t.slot} task={t} people={q.data.people} projects={q.data.projects} today={me.today} />
        ))}
      </section>

      {report.employeeNotes && (
        <Card>
          <CardBody>
            <p className="text-[12px] text-muted-foreground">Note for the manager</p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm">{report.employeeNotes}</p>
          </CardBody>
        </Card>
      )}

      <Disclosure title="Report details">
        <DefinitionList
          items={[
            ['Employee', `${employee.fullName} · ${employee.employeeCode}`],
            ['Manager', q.data.primaryManager ?? 'Not assigned'],
            ['Day', report.workingDay.reason],
            ['Submitted', report.submittedAt ? fmtDateTime(report.submittedAt) : 'Not submitted'],
          ]}
        />
      </Disclosure>
      <Disclosure title="Review history" defaultOpen={report.reviewStatus === 'RETURNED'}>
        <ReviewTimeline reviews={q.data.reviews} submittedAt={report.submittedAt} version={report.version} bare />
      </Disclosure>
      {q.data.versions.length > 1 && <VersionHistory type="DAILY" reportId={report.id} versions={q.data.versions} />}

      {q.data.canReview && report.submissionStatus === 'SUBMITTED' && <ReviewPanel type="DAILY" reportId={report.id} version={report.version} reviewStatus={report.reviewStatus} />}
    </div>
  );
}

function WeeklyCard({ r, to, showEmployee }: { r: WeeklySummaryRow; to: string; showEmployee?: boolean }) {
  return (
    <ListCard to={to}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {showEmployee && <p className="truncate text-[12px] font-medium text-brand">{r.employeeName}</p>}
          <p className="text-[15px] font-semibold">
            {fmtShortDate(r.periodStart)} – {fmtShortDate(r.periodEnd)}
          </p>
        </div>
        <StatusBadge status={r.version > 0 ? r.reviewStatus : 'DRAFT'} />
      </div>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {r.tasksCompleted} of {r.tasksPlanned} tasks done · {r.dailyReportsSubmitted}/{r.workingDays} daily reports
      </p>
    </ListCard>
  );
}

export function WeeklyReportListPage({ mode }: { mode: Mode }) {
  const me = useMe();
  const departments = useDepartments();
  const [reviewStatus, setReviewStatus] = useState<StatusChip>('');
  const [departmentId, setDepartmentId] = useState('');
  const from = addDays(me.today, -180);
  const filters = { from, to: me.today, employeeId: mode === 'own' ? me.user.id : null, departmentId: departmentId || null, reviewStatus: (reviewStatus || null) as (typeof REVIEW_STATUSES)[number] | null, limit: 200, offset: 0 };
  const q = useOp('weekly.list', filters);
  const base = mode === 'team' ? '/reviews/weekly' : mode === 'admin' ? '/admin/reports/weekly' : '/reports/weekly';
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={HUB_TITLE[mode]}
        description="Weekly reports · last 6 months"
        actions={
          <>
            {mode === 'own' && (
              <Button asChild size="sm">
                <Link to="/weekly">
                  <Plus /> This week
                </Link>
              </Button>
            )}
            <ExportMenu request={{ kind: 'weeklyReports', filters }} filename={`weekly-reports-${from}-to-${me.today}`} compact />
          </>
        }
      />
      <ReportTabs mode={mode} current="weekly" />
      <div className="no-print mb-4 flex items-center gap-2">
        <Segmented label="Review status" className="flex-1" value={reviewStatus} onChange={setReviewStatus} options={STATUS_CHIPS} />
        {mode !== 'own' && (
          <FilterSheetButton activeCount={departmentId ? 1 : 0} onReset={() => setDepartmentId('')}>
            <FilterSelect label="Department" value={departmentId} onChange={setDepartmentId} options={departments.items.map((d) => ({ value: d.id, label: d.name }))} />
          </FilterSheetButton>
        )}
      </div>
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <div className="space-y-2.5">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
      ) : q.data?.items.length === 0 ? (
        <Card>
          <EmptyState title="No weekly reports yet" />
        </Card>
      ) : (
        <div className="space-y-2.5">
          {q.data?.items.map((r) => (
            <WeeklyCard key={r.id} r={r} to={r.version > 0 ? `${base}/${r.id}` : `/weekly?period=${r.periodStart}`} showEmployee={mode !== 'own'} />
          ))}
        </div>
      )}
    </div>
  );
}
