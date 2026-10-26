import { ROLE_LABELS } from '@rgk/core';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { TrendChart } from '@/components/common/charts';
import { DateRangeFilter, rangeFor, type RangePreset } from '@/components/common/filters';
import { DefinitionList, PageHeader, StatCard, StatGrid } from '@/components/common/layout';
import { StatusBadge } from '@/components/common/StatusBadge';
import { ExportMenu } from '@/components/common/ExportMenu';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, InfoTip, PageSkeleton, TabPanel, Tabs } from '@/components/ui/misc';
import { useOp } from '@/lib/api';
import { useMe } from '@/lib/session';
import { fmtDate, fmtDateTime, fmtShortDate, pct } from '@/lib/utils';
import { ComplianceCalendar, DurationText, ProjectHistoryLegend } from '../employee/PersonalPages';

/** Employee performance detail (Management, Super Admin, or the employee's own reviewer). */
export function EmployeeDetailPage({ context }: { context: 'team' | 'company' }) {
  const { id = '' } = useParams();
  const me = useMe();
  const [range, setRange] = useState<{ preset: RangePreset; from: string; to: string }>({ preset: 'thisMonth', ...rangeFor('thisMonth', me.today) });
  const [tab, setTab] = useState('overview');
  const q = useOp('employees.profile', { employeeId: id, from: range.from, to: range.to });
  const reviewBase = context === 'team' ? '/reviews' : me.role === 'SUPER_ADMIN' ? '/admin/reports' : '/reports';

  if (q.isLoading && !q.data) return <PageSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const s = d.stats;
  const p = d.profile;
  const full = 'phoneNumber' in p ? (p as typeof p & { phoneNumber: string; joinedAt: string | null }) : null;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader
        back={context === 'team' ? { to: '/manager', label: 'My team' } : { to: '/directory', label: 'People' }}
        title={p.fullName}
        description={`${p.employeeCode} · ${p.designation} · ${d.departmentName}`}
        actions={<ExportMenu compact request={{ kind: 'dailyTasks', filters: { from: range.from, to: range.to, employeeId: id, departmentId: null, reviewStatus: null, projectId: null, taskStatus: null, includeDrafts: false, limit: 200, offset: 0 } }} filename={`${p.employeeCode}-tasks-${range.from}-to-${range.to}`} />}
      />
      <div className="flex items-start gap-2">
        <DateRangeFilter {...range} today={me.today} onChange={setRange} />
        <InfoTip>Counts describe reporting activity and task outcomes. They are not a complete measure of performance or work quality.</InfoTip>
      </div>

      <StatGrid>
        <StatCard label="Reports on time" value={pct(s.compliance.rate)} hint={`${s.compliance.submitted}/${s.compliance.expected} · ${s.compliance.missing} missing`} tone={s.compliance.rate !== null && s.compliance.rate < 80 ? 'warning' : 'default'} />
        <StatCard label="Tasks completed" value={`${s.tasks.completed}/${s.tasks.planned}`} tone="success" hint={`${s.tasks.inProgress} in progress · ${s.tasks.pending} not started`} />
        <StatCard label="Overdue" value={s.outstanding.overdue} tone={s.outstanding.overdue ? 'danger' : 'default'} hint={`${s.outstanding.blocked} blocked`} />
        <StatCard label="Weekly reports" value={`${s.weekly.submitted}/${s.weekly.expected}`} hint={`${s.weekly.approved} approved`} />
      </StatGrid>

      <Tabs
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'reports', label: 'Daily reports' },
          { value: 'weekly', label: 'Weekly reports' },
          { value: 'projects', label: 'Projects' },
          { value: 'compliance', label: 'Day by day' },
        ]}
      >
        <TabPanel value="overview" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
            <Card>
              <CardHeader title="Profile" />
              <CardBody>
                <DefinitionList
                  items={[
                    ['Role', ROLE_LABELS[p.role]],
                    ['Account status', <StatusBadge key="s" status={p.accountStatus} />],
                    ['Reporting Manager', d.primaryManager ?? 'Not assigned'],
                    ['Secondary reviewer', d.secondaryReviewer ?? '—'],
                    ['Last submission', fmtDateTime(s.lastSubmissionAt)],
                    ['Reports awaiting review', s.pendingReviews],
                    ...(full ? ([['Mobile', full.phoneNumber], ['Joined', fmtDate(full.joinedAt)]] as [string, string][]) : []),
                  ]}
                />
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {d.reviewStatus.filter((r) => r.count > 0).map((r) => (
                    <StatusBadge key={r.status} status={r.status} label={`${r.count} ${r.status.toLowerCase().replace('_', ' ')}`} />
                  ))}
                </div>
              </CardBody>
            </Card>
            <TrendChart title="Daily activity" data={d.series} xKey="date" labelFormat={fmtShortDate} series={[{ key: 'tasksPlanned', label: 'Tasks recorded' }, { key: 'tasksCompleted', label: 'Completed' }]} />
          </div>
          <Card>
            <CardHeader title="Recent work" description="Latest task descriptions from submitted reports" />
            {d.recentWork.length === 0 ? (
              <EmptyState title="No submitted work in this period" />
            ) : (
              <ul className="divide-y">
                {d.recentWork.map((t, i) => (
                  <li key={i}>
                    <Link to={`${reviewBase}/daily/${t.reportId}`} className="block px-4 py-3 hover:bg-muted/50 sm:px-5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium">{t.title}</p>
                        <span className="flex items-center gap-2 text-xs text-muted-foreground">
                          {fmtDate(t.workDate)} <StatusBadge status={t.status} />
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{t.description}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </TabPanel>

        <TabPanel value="reports">
          <Card>
            {d.recentReports.length === 0 ? (
              <EmptyState title="No submitted reports in this period" />
            ) : (
              <ul className="divide-y">
                {d.recentReports.map((r) => (
                  <li key={r.id}>
                    <Link to={`${reviewBase}/daily/${r.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/50 sm:px-5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{fmtDate(r.workDate)}</p>
                        <p className="truncate text-xs text-muted-foreground">{r.titles.join(' · ')}</p>
                      </div>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-xs tabular-nums text-muted-foreground">{r.completed}/{r.taskCount} done</span>
                        <StatusBadge status={r.reviewStatus} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </TabPanel>

        <TabPanel value="weekly">
          <Card>
            {d.weeklyReports.length === 0 ? (
              <EmptyState title="No weekly reports yet" />
            ) : (
              <ul className="divide-y">
                {d.weeklyReports.map((w) => (
                  <li key={w.id}>
                    <Link to={`${reviewBase}/weekly/${w.id}`} className="block px-4 py-3 hover:bg-muted/50 sm:px-5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium">
                          {fmtShortDate(w.periodStart)} – {fmtDate(w.periodEnd)}
                        </p>
                        <StatusBadge status={w.reviewStatus} />
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{w.majorAccomplishments}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </TabPanel>

        <TabPanel value="projects" className="space-y-4">
          <ProjectHistoryLegend />
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b bg-muted/60 text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2.5 font-semibold">Project</th>
                    <th className="px-3 py-2.5 font-semibold">First / latest</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Active days</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Elapsed days</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Tasks</th>
                    <th className="px-3 py-2.5 font-semibold">Done / open / blocked</th>
                    <th className="px-3 py-2.5 font-semibold">Duration</th>
                    <th className="px-3 py-2.5 font-semibold">Latest status</th>
                  </tr>
                </thead>
                <tbody>
                  {d.projects.map(({ project, history: h }) => (
                    <tr key={project?.id ?? 'none'} className="border-b last:border-0">
                      <td className="px-3 py-2.5 font-medium">{project ? (me.can('analytics.company') ? <Link className="hover:underline" to={`/projects/${project.id}`}>{project.name}</Link> : project.name) : 'No project'}</td>
                      <td className="px-3 py-2.5 text-xs">{fmtShortDate(h.firstActivity)} → {fmtShortDate(h.latestActivity)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{h.activeDays}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{h.elapsedCalendarDays}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{h.tasks}</td>
                      <td className="px-3 py-2.5 tabular-nums">{h.completed} / {h.inProgress + h.pending} / {h.blocked}</td>
                      <td className="px-3 py-2.5 text-xs"><DurationText h={h} /></td>
                      <td className="px-3 py-2.5">{h.latestStatus ? <StatusBadge status={h.latestStatus} /> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {d.projects.length === 0 && <EmptyState title="No project activity" />}
            </div>
          </Card>
        </TabPanel>

        <TabPanel value="compliance">
          <ComplianceCalendar days={s.days ?? []} />
        </TabPanel>
      </Tabs>
    </div>
  );
}
