import { firstName, ROLE_LABELS } from '@rgk/core';
import { AlertTriangle, CheckCircle2, ChevronRight, Hourglass, RotateCcw, Users } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { BarList, TrendChart } from '@/components/common/charts';
import { DataTable, type Column } from '@/components/common/DataTable';
import { ExportMenu } from '@/components/common/ExportMenu';
import { DateRangeFilter, FilterBar, FilterSelect, rangeFor, useDepartments, type RangePreset } from '@/components/common/filters';
import { ListCard, PageHeader, StatCard, StatGrid } from '@/components/common/layout';
import { MotivationQuote } from '@/components/common/MotivationQuote';
import { PriorityPrinciples } from '@/components/common/PriorityPrinciples';
import { StatusBadge } from '@/components/common/StatusBadge';
import { EmployeeLink } from '@/components/reports/ReportParts';
import { Card, CardHeader } from '@/components/ui/card';
import { Link } from 'react-router';
import { Input } from '@/components/ui/form';
import { Avatar, EmptyState, ErrorState, PageSkeleton, Segmented } from '@/components/ui/misc';
import { useOp, type api } from '@/lib/api';
import { useMe } from '@/lib/session';
import { cn, fmtDate, fmtDateTime, fmtRelative, fmtShortDate, pct } from '@/lib/utils';

type DashRow = Awaited<ReturnType<typeof api<'manager.dashboard'>>>['rows'][number];

type TeamFilter = 'all' | 'waiting' | 'approved' | 'changes' | 'missing';
const WAITING = ['PENDING_REVIEW', 'VIEWED', 'REVIEWED'];

function EmployeeCard({ r, onOpen }: { r: DashRow; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="tap flex w-full cursor-pointer items-center gap-3 rounded-2xl border bg-card p-3.5 text-left shadow-[var(--shadow-card)] hover:border-brand/40">
      <Avatar name={r.user.fullName} className="size-11" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[14px] font-semibold">{r.user.fullName}</span>
          {r.pendingReviewCount > 0 && <span className="shrink-0 rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning">{r.pendingReviewCount} to review</span>}
        </span>
        <span className="block truncate text-[12px] text-muted-foreground">{r.user.designation}</span>
        <span className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
          <StatusBadge status={r.todayStatus} />
          {r.tasksPlanned > 0 && (
            <span>
              {r.tasksCompleted}/{r.tasksPlanned} done
            </span>
          )}
          {r.overdue > 0 && <span className="font-medium text-danger">{r.overdue} overdue</span>}
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );
}

export function ManagerDashboardPage() {
  const me = useMe();
  const navigate = useNavigate();
  const [date, setDate] = useState(me.today);
  const [filter, setFilter] = useState<TeamFilter>('all');
  const [search, setSearch] = useState('');
  const q = useOp('manager.dashboard', { date: date === me.today ? null : date });
  if (q.isLoading && !q.data) return <PageSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const k = q.data.kpis;
  const pred: Record<TeamFilter, (r: DashRow) => boolean> = {
    all: () => true,
    waiting: (r) => WAITING.includes(r.todayStatus),
    approved: (r) => r.todayStatus === 'APPROVED',
    changes: (r) => r.todayStatus === 'RETURNED',
    missing: (r) => ['MISSING', 'NOT_SUBMITTED', 'DRAFT'].includes(r.todayStatus),
  };
  const count = (f: TeamFilter) => q.data!.rows.filter(pred[f]).length;
  const rows = q.data.rows.filter((r) => pred[filter](r) && (!search || `${r.user.fullName} ${r.user.employeeCode}`.toLowerCase().includes(search.toLowerCase())));
  const isToday = date === me.today;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight">My team</h1>
          <p className="mt-0.5 text-[14px] text-muted-foreground">{isToday ? 'Today' : fmtDate(q.data.date)} · due {fmtDateTime(q.data.deadline).split(',').slice(-1)[0]?.trim()}</p>
        </div>
        <Input type="date" value={date} max={me.today} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Team date" className="h-9 w-auto rounded-full px-3 text-[13px]" />
      </div>
      <MotivationQuote name={firstName(me.user.fullName.replace(/\s*\(.*\)$/, ''))} seed={me.user.id} />

      <PriorityPrinciples />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Team members" value={k.assignedEmployees} icon={Users} to="/team" />
        <StatCard label="To review" value={k.awaitingReview + k.weeklyAwaitingReview} icon={Hourglass} tone={k.awaitingReview + k.weeklyAwaitingReview ? 'warning' : 'default'} to="/reviews/pending" />
        <StatCard label="Approved" value={k.approved} icon={CheckCircle2} tone="success" hint={isToday ? 'today' : undefined} />
        <StatCard label="Needs changes" value={k.returned} icon={RotateCcw} tone={k.returned ? 'danger' : 'default'} hint={isToday ? 'today' : undefined} />
      </div>

      {(k.notSubmitted > 0 || k.overdue > 0) && (
        <p className="flex flex-wrap gap-x-3 text-[13px] text-muted-foreground">
          <span>
            {k.submittedToday}/{k.expectedToday} submitted
          </span>
          {k.missingAfterDeadline > 0 && <span className="font-medium text-danger">{k.missingAfterDeadline} missing</span>}
          {k.overdue > 0 && (
            <Link to="/team/pending-work" className="font-medium text-danger underline-offset-2 hover:underline">
              {k.overdue} overdue task{k.overdue === 1 ? '' : 's'}
            </Link>
          )}
        </p>
      )}

      <div className="space-y-2.5">
        <Segmented
          label="Filter team"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All', count: count('all') },
            { value: 'waiting', label: 'Waiting', count: count('waiting') },
            { value: 'approved', label: 'Approved', count: count('approved') },
            { value: 'changes', label: 'Needs changes', count: count('changes') },
            { value: 'missing', label: 'Not submitted', count: count('missing') },
          ]}
        />
        {q.data.rows.length > 6 && <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search team" aria-label="Search team" className="h-10" />}
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState title={q.data.rows.length ? 'Nobody in this filter' : 'No one reports to you yet'} description={q.data.rows.length ? undefined : 'Ask your administrator to set up reporting lines.'} />
        </Card>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => (
            <EmployeeCard key={r.user.id} r={r} onOpen={() => navigate(r.reportId ? `/reviews/daily/${r.reportId}` : `/team/${r.user.id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}

export function TeamListPage() {
  const navigate = useNavigate();
  const departments = useDepartments();
  const q = useOp('directory.list', { query: '', departmentId: null, role: null, status: null, managerId: null, limit: 200, offset: 0 });
  type Row = NonNullable<typeof q.data>['items'][number];
  const columns: Column<Row>[] = [
    { key: 'name', header: 'Employee', sort: (r) => r.fullName, cell: (r) => <EmployeeLink id={r.id} name={r.fullName} code={r.employeeCode} base="/team" /> },
    { key: 'designation', header: 'Designation', sort: (r) => r.designation, cell: (r) => r.designation },
    { key: 'dept', header: 'Department', sort: (r) => r.departmentName, cell: (r) => departments.name(r.departmentId) },
    { key: 'role', header: 'Role', cell: (r) => ROLE_LABELS[r.role], hideOnMobile: true },
    { key: 'status', header: 'Account', cell: (r) => <StatusBadge status={r.accountStatus} /> },
  ];
  return (
    <div>
      <PageHeader title="Team members" />
      {q.error ? <ErrorState error={q.error} /> : (
        <Card>
          <DataTable caption="Assigned employees" columns={columns} rows={q.data?.items ?? []} rowKey={(r) => r.id} loading={q.isLoading} onRowClick={(r) => navigate(`/team/${r.id}`)} empty="No employees assigned to you" />
        </Card>
      )}
    </div>
  );
}

export function PendingReviewsPage() {
  const [tab, setTab] = useState<'daily' | 'weekly'>('daily');
  const q = useOp('review.pending', {}, { refetchInterval: 60_000 });
  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const age = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)) : 0);
  const total = q.data.daily.length + q.data.weekly.length;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="To review" description={total ? `${total} waiting · oldest first` : undefined} />
      {total === 0 ? (
        <Card>
          <EmptyState icon={<CheckCircle2 className="size-6" />} title="All caught up" description="Nothing is waiting for your review." />
        </Card>
      ) : (
        <>
          <Segmented
            label="Report type"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'daily', label: 'Daily', count: q.data.daily.length },
              { value: 'weekly', label: 'Weekly', count: q.data.weekly.length },
            ]}
          />
          <div className="space-y-2.5">
            {tab === 'daily' &&
              q.data.daily.map((r) => (
                <ListCard key={r.id} to={`/reviews/daily/${r.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-semibold">{r.employeeName}</p>
                      <p className="text-[12px] text-muted-foreground">{fmtDate(r.workDate, { weekday: 'short', day: 'numeric', month: 'short' })}</p>
                    </div>
                    <StatusBadge status={r.needsReReview ? 'PENDING_REVIEW' : r.reviewStatus} label={r.needsReReview ? 'Re-review' : undefined} />
                  </div>
                  <p className="mt-1.5 truncate text-[13px] text-muted-foreground">
                    {r.completed}/{r.taskCount} done · {r.titles.join(' · ')}
                  </p>
                  <p className={cn('mt-1 text-[12px]', age(r.submittedAt) > 2 ? 'font-medium text-danger' : 'text-muted-foreground')}>Sent {fmtRelative(r.submittedAt)}</p>
                </ListCard>
              ))}
            {tab === 'weekly' &&
              q.data.weekly.map((r) => (
                <ListCard key={r.id} to={`/reviews/weekly/${r.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-semibold">{r.employeeName}</p>
                      <p className="text-[12px] text-muted-foreground">
                        {fmtShortDate(r.periodStart)} – {fmtShortDate(r.periodEnd)}
                      </p>
                    </div>
                    <StatusBadge status={r.reviewStatus} />
                  </div>
                  <p className="mt-1.5 text-[13px] text-muted-foreground">
                    {r.tasksCompleted}/{r.tasksPlanned} tasks done · {r.dailyReportsSubmitted}/{r.workingDays} daily reports · sent {fmtRelative(r.submittedAt)}
                  </p>
                </ListCard>
              ))}
            {tab === 'daily' && q.data.daily.length === 0 && <p className="py-6 text-center text-[13px] text-muted-foreground">No daily reports waiting.</p>}
            {tab === 'weekly' && q.data.weekly.length === 0 && <p className="py-6 text-center text-[13px] text-muted-foreground">No weekly reports waiting.</p>}
          </div>
        </>
      )}
    </div>
  );
}

/** Team (manager) or company (management) productivity analytics. */
export function TeamAnalyticsPage({ scope }: { scope: 'team' | 'company' }) {
  const me = useMe();
  const navigate = useNavigate();
  const departments = useDepartments();
  const [range, setRange] = useState<{ preset: RangePreset; from: string; to: string }>({ preset: 'thisMonth', ...rangeFor('thisMonth', me.today) });
  const [dept, setDept] = useState('');
  const q = useOp('team.analytics', { from: range.from, to: range.to, departmentId: dept || null });
  type Row = NonNullable<typeof q.data>['employees'][number];
  const columns: Column<Row>[] = [
    { key: 'name', header: 'Employee', sort: (r) => r.user.fullName, cell: (r) => <EmployeeLink id={r.user.id} name={r.user.fullName} code={r.user.employeeCode} base={scope === 'team' ? '/team' : '/employees'} /> },
    { key: 'comp', header: 'Compliance', sort: (r) => r.compliance.rate ?? -1, cell: (r) => <span className="tabular-nums">{pct(r.compliance.rate)} <span className="text-xs text-muted-foreground">({r.compliance.submitted}/{r.compliance.expected})</span></span> },
    { key: 'late', header: 'Late', sort: (r) => r.compliance.late, cell: (r) => r.compliance.late, hideOnMobile: true },
    { key: 'weekly', header: 'Weekly', sort: (r) => r.weekly.submitted, cell: (r) => `${r.weekly.submitted}/${r.weekly.expected}` },
    { key: 'tasks', header: 'Tasks', sort: (r) => r.tasks.planned, cell: (r) => r.tasks.planned },
    { key: 'done', header: 'Completed', sort: (r) => r.tasks.completed, cell: (r) => r.tasks.completed },
    { key: 'avg', header: 'Avg progress', sort: (r) => r.tasks.averageProgress ?? -1, cell: (r) => pct(r.tasks.averageProgress), hideOnMobile: true },
    { key: 'od', header: 'Open overdue', sort: (r) => r.outstanding.overdue, cell: (r) => <span className={r.outstanding.overdue ? 'font-semibold text-danger' : ''}>{r.outstanding.overdue}</span> },
    { key: 'blk', header: 'Blocked', sort: (r) => r.outstanding.blocked, cell: (r) => r.outstanding.blocked, hideOnMobile: true },
  ];
  return (
    <div className="space-y-5">
      <PageHeader
        title={scope === 'team' ? 'Team progress' : 'Productivity'}
        description="Activity counts, not a ranking or a measure of work quality"
        actions={<ExportMenu request={{ kind: 'compliance', filters: { from: range.from, to: range.to, departmentId: dept || null } }} filename={`productivity-${range.from}-to-${range.to}`} />}
      />
      <FilterBar>
        <DateRangeFilter {...range} today={me.today} onChange={setRange} />
        {scope === 'company' && <FilterSelect label="Department" value={dept} onChange={setDept} options={departments.items.map((d) => ({ value: d.id, label: d.name }))} />}
      </FilterBar>
      {q.isLoading ? <PageSkeleton /> : q.error || !q.data ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <>
          <StatGrid>
            <StatCard label="Employees" value={q.data.totals.employees} />
            <StatCard label="Daily compliance" value={pct(q.data.totals.compliance.rate)} hint={`${q.data.totals.compliance.submitted}/${q.data.totals.compliance.expected} expected reports`} />
            <StatCard label="Tasks completed" value={`${q.data.totals.tasks.completed}/${q.data.totals.tasks.planned}`} tone="success" />
            <StatCard label="Open overdue / blocked" value={`${q.data.totals.outstanding.overdue} / ${q.data.totals.outstanding.blocked}`} tone={q.data.totals.outstanding.overdue ? 'danger' : 'default'} icon={AlertTriangle} />
          </StatGrid>
          <div className="grid gap-4 lg:grid-cols-2">
            <TrendChart title="Daily reports: expected vs submitted" data={q.data.series} xKey="date" labelFormat={fmtShortDate} series={[{ key: 'expected', label: 'Expected' }, { key: 'submitted', label: 'Submitted' }]} />
            <TrendChart title="Tasks recorded vs completed" data={q.data.series} xKey="date" labelFormat={fmtShortDate} series={[{ key: 'tasksPlanned', label: 'Recorded' }, { key: 'tasksCompleted', label: 'Completed' }]} />
          </div>
          <BarList title="Compliance by employee" description="% of expected daily reports submitted" data={[...q.data.employees].sort((a, b) => (a.compliance.rate ?? 0) - (b.compliance.rate ?? 0)).slice(0, 25).map((e) => ({ name: e.user.fullName, rate: e.compliance.rate ?? 0 }))} labelKey="name" series={[{ key: 'rate', label: 'Compliance %' }]} max={100} valueFormat={(v) => `${v}%`} />
          <Card>
            <CardHeader title="Employee breakdown" />
            <DataTable caption="Employee productivity" columns={columns} rows={q.data.employees} rowKey={(r) => r.user.id} onRowClick={(r) => navigate(`${scope === 'team' ? '/team' : '/employees'}/${r.user.id}`)} initialSort={{ key: 'name', dir: 'asc' }} />
          </Card>
        </>
      )}
    </div>
  );
}
