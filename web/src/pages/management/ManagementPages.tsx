import { ACCOUNT_STATUSES, ROLE_LABELS, ROLES } from '@rgk/core';
import { AlertTriangle, Ban, CalendarCheck, CheckCircle2, Hourglass, Loader, TimerOff, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { BarList, Meter, TrendChart } from '@/components/common/charts';
import { DataTable, type Column } from '@/components/common/DataTable';
import { ExportMenu } from '@/components/common/ExportMenu';
import { DateRangeFilter, FilterBar, FilterSelect, rangeFor, useDepartments, type RangePreset } from '@/components/common/filters';
import { DefinitionList, PageHeader, SectionTitle, StatCard, StatGrid } from '@/components/common/layout';
import { PriorityBadge, StatusBadge, statusLabel } from '@/components/common/StatusBadge';
import { EmployeeLink } from '@/components/reports/ReportParts';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/form';
import { Avatar, Disclosure, EmptyState, ErrorState, Notice, PageSkeleton, Segmented, TabPanel, Tabs } from '@/components/ui/misc';
import { useOp } from '@/lib/api';
import { useMe } from '@/lib/session';
import { fmtDate, fmtShortDate, pct } from '@/lib/utils';
import { DurationText, ProjectCard, ProjectHistoryLegend } from '../employee/PersonalPages';

function useRange(initial: RangePreset = 'thisMonth') {
  const me = useMe();
  return useState<{ preset: RangePreset; from: string; to: string }>({ preset: initial, ...rangeFor(initial, me.today) });
}

const METRIC_DEFS: [string, string][] = [
  ['Daily reporting compliance', 'Submitted ÷ expected daily reports. A working day is expected once its deadline passes. Holidays, days before joining and non-reporting roles are excluded.'],
  ['Tasks planned', 'All tasks recorded in submitted daily reports in the period (one record per task per day).'],
  ['Completed / In progress / Pending', 'Task records by status. Pending = planned, not yet started.'],
  ['Overdue', 'Open work items whose explicit due date has passed (latest record of each item, last 30 days). Tasks without due dates are never overdue.'],
  ['Blocked', 'Open work items whose latest status is Blocked.'],
  ['Reviews pending', 'Submitted daily and weekly reports awaiting a Reporting Manager decision.'],
];

export function ManagementOverviewPage() {
  const me = useMe();
  const departments = useDepartments();
  const [range, setRange] = useRange('thisWeek');
  const [dept, setDept] = useState('');
  const q = useOp('company.overview', { from: range.from, to: range.to, departmentId: dept || null });
  const pending = useOp('company.pendingWork', { departmentId: dept || null });
  const d = q.data;
  const employees = d ? [...d.employees].sort((a, b) => (a.compliance.rate ?? 101) - (b.compliance.rate ?? 101)) : [];
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Company overview" actions={<ExportMenu request={{ kind: 'compliance', filters: { from: range.from, to: range.to, departmentId: dept || null } }} filename={`company-compliance-${range.from}-to-${range.to}`} compact />} />
      <div className="no-print flex flex-col gap-2.5 sm:flex-row sm:items-start">
        <Select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department" className="h-10 sm:w-56">
          <option value="">All departments</option>
          {departments.items.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </Select>
        <DateRangeFilter {...range} today={me.today} presets={['thisWeek', 'lastWeek', 'thisMonth', 'lastMonth', 'custom']} onChange={setRange} />
      </div>
      {q.isLoading && !d ? (
        <PageSkeleton />
      ) : q.error || !d ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <StatGrid>
            <StatCard label="Active employees" value={d.kpis.activeEmployees} icon={Users} to="/directory" />
            <StatCard label="Reports today" value={d.kpis.reportingToday} icon={CalendarCheck} hint={`${pct(d.kpis.compliance.rate)} on time this period`} />
            <StatCard label="Tasks completed" value={d.kpis.tasks.completed} icon={CheckCircle2} tone="success" hint={`of ${d.kpis.tasks.planned}`} />
            <StatCard label="Overdue tasks" value={d.kpis.outstanding.overdue} icon={TimerOff} tone={d.kpis.outstanding.overdue ? 'danger' : 'default'} to="/pending-work" />
          </StatGrid>

          <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
            {dept ? (
              <Card>
                <CardHeader title={`${departments.name(dept)} team`} actions={<Link to={`/departments?dept=${dept}`} className="text-[13px] font-medium text-primary">Details</Link>} />
                <EmployeeStatusList employees={employees} />
              </Card>
            ) : (
              <BarList
                title="Departments"
                description="Reports submitted on time"
                data={d.departments.filter((x) => x.employees > 0).map((x) => ({ name: x.name, rate: x.compliance.rate ?? 0 }))}
                labelKey="name"
                series={[{ key: 'rate', label: 'On-time %' }]}
                max={100}
                valueFormat={(v) => `${v}%`}
              />
            )}
            <Card className="p-4 sm:p-5">
              <SectionTitle action={<Link to="/pending-work" className="text-[13px] font-medium text-primary">Open</Link>}>Pending work</SectionTitle>
              <ul className="divide-y text-[14px]">
                {[
                  { label: 'Overdue tasks', value: pending.data?.overdue.length, tone: 'text-danger', icon: TimerOff },
                  { label: 'Blocked tasks', value: pending.data?.blocked.length, tone: 'text-danger', icon: Ban },
                  { label: 'In progress', value: pending.data?.inProgress.length, tone: 'text-info', icon: Loader },
                  { label: 'Reviews waiting', value: pending.data?.pendingReviews.length, tone: 'text-warning', icon: Hourglass },
                ].map((x) => (
                  <li key={x.label} className="flex items-center gap-3 py-2.5">
                    <x.icon className={`size-4 ${x.tone}`} aria-hidden />
                    <span className="flex-1 text-foreground/80">{x.label}</span>
                    <span className="font-semibold tabular-nums">{x.value ?? '…'}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          {!dept && (
            <Card>
              <CardHeader title="Needs attention" description="Lowest on-time reporting first" actions={<Link to="/compliance" className="text-[13px] font-medium text-primary">Who submitted</Link>} />
              <EmployeeStatusList employees={employees.slice(0, 8)} />
            </Card>
          )}

          <Disclosure title="More metrics">
            <div className="space-y-4">
              <StatGrid>
                <StatCard label="In progress" value={d.kpis.tasks.inProgress} />
                <StatCard label="Not started" value={d.kpis.tasks.pending} />
                <StatCard label="Weekly reports" value={`${d.kpis.weeklySubmitted}/${d.kpis.weeklyExpected}`} />
                <StatCard label="Weekly awaiting approval" value={d.kpis.weeklyAwaitingApproval} />
              </StatGrid>
              <TrendChart title="Daily reports: expected vs submitted" data={d.series} xKey="date" labelFormat={fmtShortDate} series={[{ key: 'expected', label: 'Expected' }, { key: 'submitted', label: 'Submitted' }]} height={220} />
              <dl className="space-y-2 text-[13px]">
                {METRIC_DEFS.map(([k, v]) => (
                  <div key={k}>
                    <dt className="font-medium">{k}</dt>
                    <dd className="text-muted-foreground">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </Disclosure>
        </>
      )}
    </div>
  );
}

type OverviewEmployee = NonNullable<ReturnType<typeof useOp<'company.overview'>>['data']>['employees'][number];

function EmployeeStatusList({ employees }: { employees: OverviewEmployee[] }) {
  if (!employees.length) return <EmptyState title="No employees" />;
  return (
    <ul className="divide-y">
      {employees.map((e) => (
        <li key={e.user.id}>
          <Link to={`/employees/${e.user.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 sm:px-5">
            <Avatar name={e.user.fullName} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium">{e.user.fullName}</span>
              <span className="block truncate text-[12px] text-muted-foreground">
                {e.tasks.completed}/{e.tasks.planned} done{e.outstanding.overdue ? ` · ${e.outstanding.overdue} overdue` : ''}
              </span>
            </span>
            <span className="w-20 shrink-0">
              <Meter value={e.compliance.rate} label="On time" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function DirectoryPage() {
  const navigate = useNavigate();
  const me = useMe();
  const departments = useDepartments();
  const [query, setQuery] = useState('');
  const [dept, setDept] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [page, setPage] = useState(0);
  const q = useOp('directory.list', { query, departmentId: dept || null, role: (role || null) as never, status: (status || null) as never, managerId: null, limit: 50, offset: page * 50 }, { placeholderData: (p) => p });
  type Row = NonNullable<typeof q.data>['items'][number];
  const columns: Column<Row>[] = [
    { key: 'n', header: 'Employee', cell: (r) => <EmployeeLink id={r.id} name={r.fullName} code={r.employeeCode} /> },
    { key: 'd', header: 'Department', cell: (r) => r.departmentName },
    { key: 'g', header: 'Designation', cell: (r) => r.designation, hideOnMobile: true },
    { key: 'm', header: 'Reporting Manager', cell: (r) => r.managerName ?? '—', hideOnMobile: true },
    { key: 'r', header: 'Role', cell: (r) => ROLE_LABELS[r.role], hideOnMobile: true },
    { key: 's', header: 'Status', cell: (r) => <StatusBadge status={r.accountStatus} /> },
  ];
  return (
    <div>
      <PageHeader title="People" actions={me.can('export.company') && <ExportMenu request={{ kind: 'employees', filters: { departmentId: dept || null } }} filename="employee-directory" printable={false} />} />
      <FilterBar onReset={() => { setQuery(''); setDept(''); setRole(''); setStatus('ACTIVE'); setPage(0); }}>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Search
          <Input value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder="Name, code, designation…" className="w-64" />
        </label>
        <FilterSelect label="Department" value={dept} onChange={(v) => { setDept(v); setPage(0); }} options={departments.items.map((d) => ({ value: d.id, label: d.name }))} />
        <FilterSelect label="Role" value={role} onChange={(v) => { setRole(v); setPage(0); }} options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
        <FilterSelect label="Account status" value={status} onChange={(v) => { setStatus(v); setPage(0); }} options={ACCOUNT_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))} />
      </FilterBar>
      {q.error ? <ErrorState error={q.error} /> : (
        <Card>
          <DataTable caption="Employees" columns={columns} rows={q.data?.items ?? []} rowKey={(r) => r.id} loading={q.isLoading} onRowClick={(r) => navigate(`/employees/${r.id}`)} pageSize={50} server={{ page, total: q.data?.total ?? 0, onPageChange: setPage }} />
        </Card>
      )}
    </div>
  );
}

export function DepartmentAnalyticsPage() {
  const me = useMe();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const departments = useDepartments();
  const dept = params.get('dept') ?? '';
  const [range, setRange] = useRange();
  const q = useOp('company.overview', { from: range.from, to: range.to, departmentId: dept || null });
  const all = useOp('company.overview', { from: range.from, to: range.to, departmentId: null }, { enabled: !!dept });
  const current = q.data?.departments.find((d) => d.id === dept);
  type Emp = NonNullable<typeof q.data>['employees'][number];
  return (
    <div className="space-y-5">
      <PageHeader title="Departments" />
      <FilterBar>
        <DateRangeFilter {...range} today={me.today} onChange={setRange} />
        <FilterSelect label="Department" value={dept} onChange={(v) => setParams(v ? { dept: v } : {})} options={departments.items.map((d) => ({ value: d.id, label: d.name }))} allLabel="All departments" />
      </FilterBar>
      {q.isLoading && !q.data ? <PageSkeleton /> : q.error || !q.data ? <ErrorState error={q.error} /> : (
        <>
          {current && (
            <StatGrid className="xl:grid-cols-6">
              <StatCard label="Employees" value={current.employees} icon={Users} />
              <StatCard label="Reporting compliance" value={pct(current.compliance.rate)} hint={`${current.compliance.submitted}/${current.compliance.expected}`} />
              <StatCard label="Tasks planned / completed" value={`${current.tasks.planned} / ${current.tasks.completed}`} />
              <StatCard label="In progress / pending" value={`${current.tasks.inProgress} / ${current.tasks.pending}`} />
              <StatCard label="Open overdue" value={current.outstanding.overdue} tone={current.outstanding.overdue ? 'danger' : 'default'} />
              <StatCard label="Weekly completion" value={`${current.weekly.submitted}/${current.weekly.expected}`} hint={`${current.pendingReviews} reviews pending`} />
            </StatGrid>
          )}
          <BarList
            title="Department comparison"
            description="Reporting compliance % in the selected period (company-wide)"
            data={(dept ? all.data?.departments ?? [] : q.data.departments).filter((d) => d.employees > 0).map((d) => ({ name: d.name, compliance: d.compliance.rate ?? 0, completion: d.tasks.planned ? Math.round((d.tasks.completed / d.tasks.planned) * 100) : 0 }))}
            labelKey="name"
            series={[{ key: 'compliance', label: 'Compliance %' }, { key: 'completion', label: 'Task completion %' }]}
            max={100}
            valueFormat={(v) => `${v}%`}
          />
          <Card>
            <CardHeader title={current ? `${current.name} employees` : 'All employees'} />
            <DataTable<Emp>
              caption="Employees"
              rows={q.data.employees}
              rowKey={(e) => e.user.id}
              onRowClick={(e) => navigate(`/employees/${e.user.id}`)}
              columns={[
                { key: 'n', header: 'Employee', sort: (e) => e.user.fullName, cell: (e) => <EmployeeLink id={e.user.id} name={e.user.fullName} code={e.user.employeeCode} /> },
                { key: 'd', header: 'Department', cell: (e) => departments.name(e.user.departmentId), hideOnMobile: true },
                { key: 'c', header: 'Compliance', sort: (e) => e.compliance.rate ?? -1, cell: (e) => pct(e.compliance.rate) },
                { key: 't', header: 'Tasks', sort: (e) => e.tasks.planned, cell: (e) => e.tasks.planned },
                { key: 'x', header: 'Completed', sort: (e) => e.tasks.completed, cell: (e) => e.tasks.completed },
                { key: 'o', header: 'Overdue', sort: (e) => e.outstanding.overdue, cell: (e) => e.outstanding.overdue },
                { key: 'w', header: 'Weekly', cell: (e) => `${e.weekly.submitted}/${e.weekly.expected}` },
              ]}
              initialSort={{ key: 'n', dir: 'asc' }}
            />
          </Card>
        </>
      )}
    </div>
  );
}

export function ProjectAnalyticsPage() {
  const me = useMe();
  const [filter, setFilter] = useState<'all' | 'repeated' | 'unresolved' | 'stale'>('all');
  const q = useOp('projects.analytics', { staleAfterDays: 14 });
  const all = q.data?.projects ?? [];
  const pred = { all: () => true, repeated: (p: (typeof all)[number]) => p.history.reportingWeeks >= 2, unresolved: (p: (typeof all)[number]) => p.unresolvedTasks > 0, stale: (p: (typeof all)[number]) => p.stale };
  const rows = all.filter(pred[filter]).sort((a, b) => (b.history.latestActivity ?? '').localeCompare(a.history.latestActivity ?? ''));
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title={<span className="flex items-center gap-1.5">Projects <ProjectHistoryLegend /></span>} />
      <Segmented
        label="Show"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'All', count: all.length },
          { value: 'repeated', label: 'Active 2+ weeks', count: all.filter(pred.repeated).length },
          { value: 'unresolved', label: 'Open tasks', count: all.filter(pred.unresolved).length },
          { value: 'stale', label: 'No recent updates', count: all.filter(pred.stale).length },
        ]}
      />
      {q.error ? (
        <ErrorState error={q.error} />
      ) : q.isLoading ? (
        <PageSkeleton />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState title="No projects here" />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((p) => (
            <div key={p.project.id} className="relative">
              <ProjectCard name={p.project.name} code={`${p.project.code} · ${p.history.employees} people · ${p.unresolvedTasks} open`} h={p.history} today={me.today} to={`/projects/${p.project.id}`} />
              {p.stale && <span className="absolute right-3 top-12 rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-medium text-danger">No recent updates</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProjectDetailPage() {
  const { id = '' } = useParams();
  const me = useMe();
  const q = useOp('projects.detail', { projectId: id });
  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { project: p, overall: h } = q.data;
  return (
    <div className="space-y-5">
      <PageHeader back={{ to: '/projects', label: 'Projects' }} title={p.name} description={`${p.code} · ${p.description}`} actions={<StatusBadge status={p.status} />} />
      <ProjectHistoryLegend />
      <StatGrid className="xl:grid-cols-6">
        <StatCard label="First / latest activity" value={<span className="text-base">{fmtShortDate(h.firstActivity)} → {fmtShortDate(h.latestActivity)}</span>} />
        <StatCard label="Active reporting days" value={h.activeDays} hint={`${h.elapsedCalendarDays} elapsed calendar days`} />
        <StatCard label="Tasks recorded" value={h.tasks} hint={`${h.reportingWeeks} reporting weeks`} />
        <StatCard label="Completed" value={h.completed} tone="success" />
        <StatCard label="In progress / not started" value={`${h.inProgress} / ${h.pending}`} />
        <StatCard label="Blocked" value={h.blocked} tone={h.blocked ? 'danger' : 'default'} />
      </StatGrid>
      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardHeader title="Project details" />
          <CardBody>
            <DefinitionList items={[['Project lead', q.data.ownerName ?? '—'], ['Reviewer', q.data.reviewerName ?? '—'], ['Priority', <PriorityBadge key="p" priority={p.priority} />], ['Start date', fmtDate(p.startDate)], ['Target end', fmtDate(p.targetEndDate)], ['Employees involved', h.employees], ['Recorded duration', <DurationText key="d" h={h} />]]} />
            {p.milestones.length > 0 && (
              <ul className="mt-4 space-y-1 text-sm">
                {p.milestones.map((m, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <StatusBadge status={m.done ? 'COMPLETED' : 'PLANNED'} /> {m.title} <span className="text-xs text-muted-foreground">{fmtDate(m.dueDate)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <TrendChart title="Weekly activity" data={q.data.weekly} xKey="week" xLabel="Week starting" labelFormat={fmtShortDate} series={[{ key: 'tasks', label: 'Tasks' }, { key: 'completed', label: 'Completed' }, { key: 'employees', label: 'Employees' }]} />
      </div>
      <Card>
        <CardHeader title="Involvement by employee" />
        <DataTable
          caption="Employees on project"
          rows={q.data.byEmployee}
          rowKey={(e) => e.employee?.id ?? 'x'}
          columns={[
            { key: 'n', header: 'Employee', cell: (e) => (e.employee ? <EmployeeLink id={e.employee.id} name={e.employee.fullName} code={e.employee.employeeCode} base={me.can('directory.full') ? '/employees' : '/team'} /> : 'Unknown') },
            { key: 'f', header: 'First activity', sort: (e) => e.history.firstActivity, cell: (e) => fmtDate(e.history.firstActivity) },
            { key: 'l', header: 'Latest activity', sort: (e) => e.history.latestActivity, cell: (e) => fmtDate(e.history.latestActivity) },
            { key: 'a', header: 'Active days', sort: (e) => e.history.activeDays, cell: (e) => e.history.activeDays },
            { key: 't', header: 'Tasks', sort: (e) => e.history.tasks, cell: (e) => e.history.tasks },
            { key: 'c', header: 'Done / open / blocked', cell: (e) => `${e.history.completed} / ${e.history.inProgress + e.history.pending} / ${e.history.blocked}` },
            { key: 's', header: 'Latest status', cell: (e) => (e.history.latestStatus ? <StatusBadge status={e.history.latestStatus} /> : '—') },
          ]}
        />
      </Card>
      <Card>
        <CardHeader title="Recent tasks" />
        <ul className="divide-y">
          {q.data.recentTasks.map((t, i) => (
            <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm sm:px-5">
              <span className="min-w-0">
                <span className="font-medium">{t.title}</span> <span className="text-xs text-muted-foreground">· {t.employeeName} · {fmtDate(t.workDate)}</span>
              </span>
              <span className="flex items-center gap-2 text-xs">{t.progressPercentage}% <StatusBadge status={t.status} /></span>
            </li>
          ))}
        </ul>
        {q.data.recentTasks.length === 0 && <EmptyState title="No tasks recorded for this project yet" />}
      </Card>
    </div>
  );
}

/** Reporting compliance grid (Management: company / department; Manager: own team). */
export function CompliancePage({ scope }: { scope: 'team' | 'company' }) {
  const me = useMe();
  const departments = useDepartments();
  const [range, setRange] = useRange('thisWeek');
  const [dept, setDept] = useState('');
  const q = useOp('company.compliance', { from: range.from, to: range.to, departmentId: dept || null });
  const base = scope === 'team' ? '/team' : '/employees';
  return (
    <div className="space-y-5">
      <PageHeader title="Who submitted" description="Holidays and not-yet-due days never count as missing" actions={<ExportMenu request={{ kind: 'compliance', filters: { from: range.from, to: range.to, departmentId: dept || null } }} filename={`compliance-${range.from}-to-${range.to}`} />} />
      <FilterBar>
        <DateRangeFilter {...range} today={me.today} onChange={setRange} maxDays={31} />
        {scope === 'company' && <FilterSelect label="Department" value={dept} onChange={setDept} options={departments.items.map((d) => ({ value: d.id, label: d.name }))} />}
      </FilterBar>
      {q.isLoading && !q.data ? <PageSkeleton /> : q.error || !q.data ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <>
          <StatGrid>
            <StatCard label="Compliance" value={pct(q.data.totals.rate)} hint={`${q.data.totals.submitted}/${q.data.totals.expected} expected reports`} />
            <StatCard label="On time" value={q.data.totals.onTime} tone="success" />
            <StatCard label="Late" value={q.data.totals.late} tone={q.data.totals.late ? 'warning' : 'default'} />
            <StatCard label="Missing" value={q.data.totals.missing} tone={q.data.totals.missing ? 'danger' : 'default'} icon={AlertTriangle} />
          </StatGrid>
          {q.data.dates.length > 31 ? <Notice tone="info">Choose a range of up to 31 days to see the day-by-day grid.</Notice> : (
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <caption className="sr-only">Daily report status by employee and date</caption>
                  <thead>
                    <tr className="border-b bg-muted/60">
                      <th scope="col" className="sticky left-0 z-10 bg-muted px-3 py-2 text-left font-semibold">Employee</th>
                      <th scope="col" className="px-2 py-2 text-right font-semibold">Rate</th>
                      {q.data.dates.map((d) => (
                        <th key={d} scope="col" className="px-1 py-2 text-center font-medium text-muted-foreground">
                          {fmtDate(d, { weekday: 'narrow', day: 'numeric' })}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.employees.map((e) => (
                      <tr key={e.user.id} className="border-b last:border-0">
                        <th scope="row" className="sticky left-0 z-10 whitespace-nowrap bg-card px-3 py-1.5 text-left font-normal">
                          <EmployeeLink id={e.user.id} name={e.user.fullName} base={base} />
                        </th>
                        <td className="px-2 text-right font-semibold tabular-nums">{pct(e.compliance.rate)}</td>
                        {e.days?.map((d) => (
                          <td key={d.date} className="px-0.5 py-1 text-center" title={`${fmtDate(d.date)}: ${statusLabel(d.status)} — ${d.reason}`}>
                            <DayCell status={d.status} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap gap-3 border-t px-4 py-3 text-xs text-muted-foreground">
                {['SUBMITTED_ON_TIME', 'SUBMITTED_LATE', 'MISSING', 'NOT_DUE', 'HOLIDAY', 'HOLIDAY_WORK', 'NOT_EXPECTED'].map((s) => (
                  <span key={s} className="flex items-center gap-1"><DayCell status={s} /> {statusLabel(s)}</span>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

const DAY_SYMBOL: Record<string, [string, string]> = {
  SUBMITTED_ON_TIME: ['✓', 'bg-success-soft text-success'],
  SUBMITTED_LATE: ['L', 'bg-warning-soft text-warning'],
  MISSING: ['✕', 'bg-danger-soft text-danger'],
  NOT_DUE: ['·', 'bg-muted text-muted-foreground'],
  HOLIDAY: ['H', 'bg-muted text-muted-foreground'],
  HOLIDAY_WORK: ['H✓', 'bg-info-soft text-info'],
  NOT_EXPECTED: ['–', 'text-muted-foreground'],
};

function DayCell({ status }: { status: string }) {
  const [sym, cls] = DAY_SYMBOL[status] ?? ['?', ''];
  return (
    <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded px-1 text-[11px] font-semibold ${cls}`} aria-label={statusLabel(status)}>
      {sym}
    </span>
  );
}

export function PendingWorkPage({ scope }: { scope: 'team' | 'company' }) {
  const departments = useDepartments();
  const [dept, setDept] = useState('');
  const [tab, setTab] = useState('overdue');
  const q = useOp('company.pendingWork', { departmentId: dept || null });
  const base = scope === 'team' ? '/team' : '/employees';
  const reportBase = scope === 'team' ? '/reviews/daily' : '/reports/daily';
  type T = NonNullable<typeof q.data>['overdue'][number];
  const cols: Column<T>[] = [
    { key: 'e', header: 'Employee', sort: (t) => t.employee.fullName, cell: (t) => <EmployeeLink id={t.employee.id} name={t.employee.fullName} code={t.employee.employeeCode} base={base} /> },
    { key: 't', header: 'Task', cell: (t) => <Link to={`${reportBase}/${t.reportId}`} className="hover:underline">{t.title}</Link> },
    { key: 'p', header: 'Project', cell: (t) => t.projectName ?? '—', hideOnMobile: true },
    { key: 's', header: 'Status', cell: (t) => <StatusBadge status={t.status} /> },
    { key: 'r', header: 'Progress', sort: (t) => t.progressPercentage, cell: (t) => `${t.progressPercentage}%` },
    { key: 'd', header: 'Due', sort: (t) => t.dueDate ?? '', cell: (t) => (t.dueDate ? <span className={t.daysOverdue ? 'font-medium text-danger' : ''}>{fmtDate(t.dueDate)}{t.daysOverdue ? ` (${t.daysOverdue}d late)` : ''}</span> : '—') },
    { key: 'l', header: 'Last reported', sort: (t) => t.workDate, cell: (t) => fmtShortDate(t.workDate), hideOnMobile: true },
  ];
  return (
    <div className="space-y-5">
      <PageHeader title="Pending work" description="Open work from the last 30 days" />
      {scope === 'company' && (
        <FilterBar>
          <FilterSelect label="Department" value={dept} onChange={setDept} options={departments.items.map((d) => ({ value: d.id, label: d.name }))} />
        </FilterBar>
      )}
      {q.isLoading ? <PageSkeleton /> : q.error || !q.data ? <ErrorState error={q.error} /> : (
        <Tabs
          value={tab}
          onValueChange={setTab}
          tabs={[
            { value: 'overdue', label: `Overdue (${q.data.overdue.length})` },
            { value: 'blocked', label: `Blocked (${q.data.blocked.length})` },
            { value: 'progress', label: `In progress (${q.data.inProgress.length})` },
            { value: 'planned', label: `Not started (${q.data.notStarted.length})` },
            { value: 'reviews', label: `Reviews pending (${q.data.pendingReviews.length})` },
          ]}
        >
          {(['overdue', 'blocked', 'progress', 'planned'] as const).map((k) => (
            <TabPanel key={k} value={k}>
              <Card>
                <DataTable caption={k} columns={cols} rows={k === 'overdue' ? q.data.overdue : k === 'blocked' ? q.data.blocked : k === 'progress' ? q.data.inProgress : q.data.notStarted} rowKey={(t) => `${t.reportId}-${t.title}`} empty="Nothing here" />
              </Card>
            </TabPanel>
          ))}
          <TabPanel value="reviews">
            <Card>
              <DataTable
                caption="Pending reviews"
                rows={q.data.pendingReviews}
                rowKey={(r) => r.id}
                columns={[
                  { key: 'e', header: 'Employee', cell: (r) => <EmployeeLink id={r.employeeId} name={r.employeeName} code={r.employeeCode} base={base} /> },
                  { key: 'd', header: 'Work date', sort: (r) => r.workDate, cell: (r) => fmtDate(r.workDate) },
                  { key: 's', header: 'Status', cell: (r) => <StatusBadge status={r.reviewStatus} /> },
                  { key: 'a', header: 'Waiting', sort: (r) => r.ageDays, cell: (r) => <span className={r.ageDays > 2 ? 'font-medium text-danger' : ''}>{r.ageDays} day(s)</span> },
                ]}
                empty="No reports awaiting review"
              />
            </Card>
          </TabPanel>
        </Tabs>
      )}
    </div>
  );
}

export function ExportsPage() {
  const me = useMe();
  const departments = useDepartments();
  const [range, setRange] = useRange();
  const [dept, setDept] = useState('');
  const d = dept || null;
  const exports = [
    { title: 'Daily tasks', desc: 'One row per task: dates, employee, project, times, status, review status.', request: { kind: 'dailyTasks' as const, filters: { from: range.from, to: range.to, employeeId: null, departmentId: d, reviewStatus: null, projectId: null, taskStatus: null, includeDrafts: false, limit: 200, offset: 0 } } },
    { title: 'Weekly reports', desc: 'Calculated summary and narrative for each submitted weekly report.', request: { kind: 'weeklyReports' as const, filters: { from: range.from, to: range.to, employeeId: null, departmentId: d, reviewStatus: null, limit: 200, offset: 0 } } },
    { title: 'Reporting compliance', desc: 'Expected, on-time, late and missing reports per employee.', request: { kind: 'compliance' as const, filters: { from: range.from, to: range.to, departmentId: d } } },
    ...(me.can('directory.full') ? [{ title: 'Employee directory', desc: 'Employees with department, role, manager and status.', request: { kind: 'employees' as const, filters: { departmentId: d } } }] : []),
  ];
  return (
    <div className="space-y-5">
      <PageHeader title="Exports" description="Recorded in the audit log" />
      <FilterBar>
        <DateRangeFilter {...range} today={me.today} onChange={setRange} />
        <FilterSelect label="Department" value={dept} onChange={setDept} options={departments.items.map((x) => ({ value: x.id, label: x.name }))} />
      </FilterBar>
      <div className="grid gap-4 md:grid-cols-2">
        {exports.map((x) => (
          <Card key={x.title}>
            <CardHeader title={x.title} description={x.desc} actions={<ExportMenu request={x.request} filename={`${x.title.toLowerCase().replace(/\s+/g, '-')}-${range.from}-to-${range.to}`} printable={false} />} />
            <CardBody className="text-xs text-muted-foreground">
              {fmtDate(range.from)} – {fmtDate(range.to)} · {dept ? departments.name(dept) : 'All departments'}
            </CardBody>
          </Card>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">CSV opens in Excel and Google Sheets. Excel (.xls) keeps column formatting. For PDFs, open a report page and use Print / Save as PDF.</p>
      <Button variant="link" asChild>
        <Link to="/compliance">Open compliance grid</Link>
      </Button>
    </div>
  );
}
