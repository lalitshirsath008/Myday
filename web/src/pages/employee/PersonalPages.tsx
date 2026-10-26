import { password as passwordSchema, ROLE_LABELS, WEEKDAY_NAMES, type NotificationType, type ProjectHistory } from '@rgk/core';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlarmClock,
  BellRing,
  CheckCheck,
  CheckCircle2,
  ChevronLeft,
  FolderPlus,
  FolderKanban,
  ChevronRight,
  ClipboardCheck,
  KeyRound,
  LogOut,
  type LucideIcon,
  MessageSquare,
  RotateCcw,
  Send,
  UserCheck,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, NavLink, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { TrendChart } from '@/components/common/charts';
import { DateRangeFilter, rangeFor, useDepartments, type RangePreset } from '@/components/common/filters';
import { ProjectRequestSheet } from '@/components/common/ProjectRequestSheet';
import { DefinitionList, PageHeader, SectionTitle, StatCard, StatGrid } from '@/components/common/layout';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form';
import { Avatar, Disclosure, EmptyState, ErrorState, InfoTip, Notice, PageSkeleton, Progress, Segmented, Sheet } from '@/components/ui/misc';
import { backend, errorMessage, useOp, useOpMutation } from '@/lib/api';
import { navFor } from '@/lib/nav';
import { useMe, useSession } from '@/lib/session';
import { cn, fmtDate, fmtDateTime, fmtMinutes, fmtRelative, fmtShortDate, pct } from '@/lib/utils';

export function DurationText({ h }: { h: ProjectHistory }) {
  if (h.duration.reliability === 'UNAVAILABLE') return <span className="text-muted-foreground">Not recorded</span>;
  return (
    <span>
      {fmtMinutes(h.duration.minutes)}
      {h.duration.reliability === 'PARTIAL' && <span className="text-muted-foreground"> · partial</span>}
    </span>
  );
}

/** How project numbers differ — available on demand via an (i) button. */
export function ProjectHistoryLegend() {
  return (
    <InfoTip label="How project numbers work">
      <strong>Active days</strong> are distinct dates with at least one task. <strong>Elapsed days</strong> span first to latest activity and don't mean continuous work. Repeated mentions don't mean progress — check the latest status. Duration counts actual times only, overlaps once.
    </InfoTip>
  );
}

function relativeDay(date: string | null, today: string): string {
  if (!date) return '—';
  if (date === today) return 'Today';
  const d = Math.round((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${date}T00:00:00Z`).getTime()) / 86_400_000);
  if (d === 1) return 'Yesterday';
  if (d < 7) return `${d} days ago`;
  return fmtShortDate(date);
}

export function ProjectCard({ name, code, h, today, to }: { name: string; code?: string; h: ProjectHistory; today: string; to?: string }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold">{name}</p>
          {code && <p className="text-[12px] text-muted-foreground">{code}</p>}
        </div>
        {h.latestStatus && <StatusBadge status={h.latestStatus} />}
      </div>
      {h.latestProgress !== null && (
        <div className="mt-3">
          <Progress value={h.latestProgress} label={`${name} latest progress`} />
          <p className="mt-1 text-[12px] text-muted-foreground">Latest task at {h.latestProgress}%</p>
        </div>
      )}
      <p className="mt-2.5 text-[13px] text-foreground/80">
        {h.tasks} task{h.tasks === 1 ? '' : 's'} · {h.activeDays} active day{h.activeDays === 1 ? '' : 's'}
      </p>
      <p className="mt-0.5 text-[12px] text-muted-foreground">Last activity: {relativeDay(h.latestActivity, today)}</p>
    </>
  );
  const cls = 'tap block rounded-[var(--radius-card)] border bg-card p-4 shadow-[var(--shadow-card)]';
  return to ? (
    <Link to={to} className={cn(cls, 'hover:border-brand/40')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function MyProjectsPage() {
  const me = useMe();
  const q = useOp('me.projects', {});
  const mine = useOp('projects.mine', {});
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  if (q.isLoading || mine.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const meta = new Map((mine.data?.items ?? []).map((p) => [p.id, p]));
  const withHistory = q.data.projects;
  const historyIds = new Set(withHistory.map((x) => x.project?.id));
  const noTasksYet = (mine.data?.items ?? []).filter((p) => !historyIds.has(p.id));
  const selectedHistory = withHistory.find((x) => (x.project?.id ?? 'none') === openId);
  const selectedMeta = openId ? meta.get(openId) : undefined;
  const empty = withHistory.length === 0 && noTasksYet.length === 0;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={<span className="flex items-center gap-1.5">My projects <ProjectHistoryLegend /></span>}
        description="Projects you work on, lead or review"
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <FolderPlus /> New project
          </Button>
        }
      />
      {empty && (
        <Card>
          <EmptyState title="No projects yet" description="Create one, or pick a project when you add a task." action={<Button variant="secondary" onClick={() => setCreating(true)}><FolderPlus /> New project</Button>} />
        </Card>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {noTasksYet.map((p) => (
          <button key={p.id} type="button" className="tap rounded-[var(--radius-card)] border bg-card p-4 text-left shadow-[var(--shadow-card)] hover:border-brand/40" onClick={() => setOpenId(p.id)}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold">{p.name}</p>
                <p className="text-[12px] text-muted-foreground">
                  {p.code} · {p.myRole}
                </p>
              </div>
              <StatusBadge status={p.status} />
            </div>
            <p className="mt-2.5 text-[13px] text-foreground/80">{p.startDate || p.targetEndDate ? `${fmtShortDate(p.startDate)} → ${fmtShortDate(p.targetEndDate)}` : 'No dates set'}</p>
            <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
              Lead {p.ownerName ?? '—'} · Reviewer {p.reviewerName ?? '—'}
            </p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">No tasks yet</p>
          </button>
        ))}
        {withHistory.map(({ project, history: h }) => {
          const m = project ? meta.get(project.id) : undefined;
          return (
            <button key={project?.id ?? 'none'} type="button" className="text-left" onClick={() => setOpenId(project?.id ?? 'none')}>
              <ProjectCard name={project ? project.name : 'No project'} code={project ? `${project.code}${m ? ` · Lead ${m.ownerName ?? '—'}` : ''}` : undefined} h={h} today={me.today} />
            </button>
          );
        })}
      </div>
      {openId && (selectedHistory || selectedMeta) && (
        <Sheet open onOpenChange={(o) => !o && setOpenId(null)} title={selectedMeta?.name ?? selectedHistory?.project?.name ?? 'No project'}>
          <div className="space-y-4">
            {selectedMeta && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={selectedMeta.status} />
                  <span className="text-[12px] text-muted-foreground">Your role: {selectedMeta.myRole}</span>
                </div>
                {selectedMeta.description && <p className="text-sm text-foreground/85">{selectedMeta.description}</p>}
                <DefinitionList
                  items={[
                    ['Start date', fmtDate(selectedMeta.startDate)],
                    ['End date', fmtDate(selectedMeta.targetEndDate)],
                    ['Project lead', selectedMeta.ownerName ?? '—'],
                    ['Reviewer', selectedMeta.reviewerName ?? '—'],
                  ]}
                />
              </>
            )}
            {selectedHistory && (
              <DefinitionList
                items={[
                  ['First activity', fmtDate(selectedHistory.history.firstActivity)],
                  ['Latest activity', fmtDate(selectedHistory.history.latestActivity)],
                  ['Active reporting days', selectedHistory.history.activeDays],
                  ['Elapsed calendar days', selectedHistory.history.elapsedCalendarDays],
                  ['Tasks recorded', selectedHistory.history.tasks],
                  ['Completed / in progress', `${selectedHistory.history.completed} / ${selectedHistory.history.inProgress}`],
                  ['Not started / blocked', `${selectedHistory.history.pending} / ${selectedHistory.history.blocked}`],
                  ['Recorded time', <DurationText key="d" h={selectedHistory.history} />],
                ]}
              />
            )}
          </div>
        </Sheet>
      )}
      <ProjectRequestSheet open={creating} onOpenChange={setCreating} />
    </div>
  );
}

export function MyAnalyticsPage() {
  const me = useMe();
  const [range, setRange] = useState<{ preset: RangePreset; from: string; to: string }>({ preset: 'last30', ...rangeFor('last30', me.today) });
  const q = useOp('me.analytics', { from: range.from, to: range.to });
  const t = q.data?.totals;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title={
          <span className="flex items-center gap-1.5">
            Your progress
            <InfoTip>Counts show reporting activity and task outcomes. They are not a measure of the quality of your work.</InfoTip>
          </span>
        }
      />
      <DateRangeFilter {...range} today={me.today} presets={['last7', 'last30', 'custom']} onChange={setRange} />
      {q.isLoading ? (
        <PageSkeleton />
      ) : q.error || !q.data || !t ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <StatGrid>
            <StatCard label="Completed" value={t.tasks.completed} tone="success" icon={CheckCircle2} />
            <StatCard label="In progress" value={t.tasks.inProgress} tone="info" icon={RotateCcw} />
            <StatCard label="Reports on time" value={pct(t.compliance.rate)} hint={`${t.compliance.submitted} of ${t.compliance.expected}`} icon={ClipboardCheck} />
            <StatCard label="Overdue" value={t.outstanding.overdue} tone={t.outstanding.overdue ? 'danger' : 'default'} icon={AlarmClock} />
          </StatGrid>
          <TrendChart title="Task activity" data={q.data.series} xKey="date" labelFormat={fmtShortDate} series={[{ key: 'tasksPlanned', label: 'Tasks' }, { key: 'tasksCompleted', label: 'Completed' }]} height={220} />
          <Disclosure title="Day by day">
            <ComplianceCalendar days={q.data.employees[0]?.days ?? []} bare />
          </Disclosure>
        </>
      )}
    </div>
  );
}

export function ComplianceCalendar({ days, bare }: { days: { date: string; status: string; reason: string; reportId: string | null }[]; bare?: boolean }) {
  if (!days.length) return null;
  const grid = (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      {days.map((d) => (
        <li key={d.date} className="rounded-xl border px-2.5 py-2" title={d.reason}>
          <p className="text-[12px] font-medium">{fmtDate(d.date, { weekday: 'short', day: 'numeric', month: 'short' })}</p>
          <StatusBadge status={d.status} className="mt-1.5" />
        </li>
      ))}
    </ul>
  );
  if (bare) return grid;
  return (
    <Card>
      <CardBody>
        <SectionTitle>Day by day</SectionTitle>
        {grid}
      </CardBody>
    </Card>
  );
}

const NOTIF_ICON: Record<NotificationType, { icon: LucideIcon; cls: string }> = {
  DAILY_SUBMITTED: { icon: Send, cls: 'bg-info-soft text-info' },
  WEEKLY_SUBMITTED: { icon: Send, cls: 'bg-info-soft text-info' },
  REPORT_APPROVED: { icon: CheckCircle2, cls: 'bg-success-soft text-success' },
  REPORT_RETURNED: { icon: RotateCcw, cls: 'bg-danger-soft text-danger' },
  FEEDBACK_RECEIVED: { icon: MessageSquare, cls: 'bg-brand-soft text-brand' },
  REVIEW_REQUESTED: { icon: ClipboardCheck, cls: 'bg-warning-soft text-warning' },
  TASK_OVERDUE: { icon: AlarmClock, cls: 'bg-danger-soft text-danger' },
  DEADLINE_UPCOMING: { icon: BellRing, cls: 'bg-warning-soft text-warning' },
  ACCOUNT_ACTIVATED: { icon: UserCheck, cls: 'bg-success-soft text-success' },
  MANAGER_REASSIGNED: { icon: Users, cls: 'bg-brand-soft text-brand' },
  PROJECT_ASSIGNED: { icon: FolderKanban, cls: 'bg-brand-soft text-brand' },
};

export function NotificationsPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const q = useOp('notifications.list', { unreadOnly: filter === 'unread', limit: 100 });
  const mark = useOpMutation('notifications.markRead', { invalidate: ['notifications.list'] });
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Notifications"
        actions={
          <Button variant="ghost" size="sm" onClick={() => mark.mutate({ ids: null })} disabled={!q.data?.unreadCount}>
            <CheckCheck /> Mark all read
          </Button>
        }
      />
      <Segmented
        label="Show"
        className="mb-4"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'All' },
          { value: 'unread', label: 'Unread', count: q.data?.unreadCount ?? 0 },
        ]}
      />
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data?.items.length === 0 ? (
        <Card>
          <EmptyState title={filter === 'unread' ? "You're all caught up" : 'No notifications yet'} />
        </Card>
      ) : (
        <ul className="space-y-2">
          {q.data?.items.map((n) => {
            const meta = NOTIF_ICON[n.type] ?? NOTIF_ICON.FEEDBACK_RECEIVED;
            return (
              <li key={n.id}>
                <button
                  className={cn('tap flex w-full cursor-pointer items-start gap-3 rounded-2xl border bg-card p-3.5 text-left shadow-[var(--shadow-card)]', !n.read && 'border-brand/30')}
                  onClick={() => {
                    if (!n.read) mark.mutate({ ids: [n.id] });
                    if (n.link) navigate(n.link);
                  }}
                >
                  <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', meta.cls)}>
                    <meta.icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className={cn('truncate text-[14px]', n.read ? 'font-medium' : 'font-semibold')}>{n.title}</span>
                      {!n.read && <span className="size-2 shrink-0 rounded-full bg-brand" aria-label="Unread" />}
                    </span>
                    <span className="block truncate text-[13px] text-muted-foreground">{n.body}</span>
                  </span>
                  <span className="shrink-0 pt-0.5 text-[11px] text-muted-foreground" title={fmtDateTime(n.createdAt)}>
                    {fmtRelative(n.createdAt)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const pwSchema = z
  .object({ current: z.string().min(1, 'Enter your current password'), next: passwordSchema, confirm: z.string() })
  .refine((v) => v.next === v.confirm, { message: 'Passwords do not match', path: ['confirm'] })
  .refine((v) => v.next !== v.current, { message: 'Choose a different password', path: ['next'] });

/** Profile hub: identity, every secondary feature for the role, and account settings. */
export function ProfilePage() {
  const me = useMe();
  const { refresh, signOut } = useSession();
  const navigate = useNavigate();
  const departments = useDepartments();
  const [alt, setAlt] = useState(me.user.alternatePhone);
  const [loc, setLoc] = useState(me.user.location);
  const update = useOpMutation('me.updateProfile', { success: 'Profile updated' });
  const pw = useForm({ resolver: zodResolver(pwSchema), defaultValues: { current: '', next: '', confirm: '' } });
  const [pwError, setPwError] = useState<string | null>(null);
  const u = me.user;
  const sections = navFor(me.role, me.isReporter).filter((s) => s.items.some((i) => i.to !== '/profile'));
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center gap-4 rounded-[24px] border bg-card p-5 shadow-[var(--shadow-card)]">
        <Avatar name={u.fullName} className="size-14 text-base" />
        <div className="min-w-0">
          <p className="truncate text-[18px] font-semibold">{u.fullName}</p>
          <p className="truncate text-[13px] text-muted-foreground">
            {u.designation} · {departments.name(u.departmentId)}
          </p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {u.employeeCode} · {ROLE_LABELS[u.role]}
          </p>
        </div>
      </div>

      {sections.map((s) => (
        <div key={s.title}>
          <p className="mb-2 px-1 text-[12px] font-medium text-muted-foreground">{s.title}</p>
          <div className="overflow-hidden rounded-2xl border bg-card shadow-[var(--shadow-card)]">
            {s.items
              .filter((i) => i.to !== '/profile')
              .map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className="tap flex items-center gap-3 border-b px-4 py-3.5 text-[14px] last:border-0 hover:bg-muted/60">
                  <span className="flex size-8 items-center justify-center rounded-xl bg-brand-soft text-brand">
                    <item.icon className="size-4" aria-hidden />
                  </span>
                  <span className="flex-1">{item.label}</span>
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                </NavLink>
              ))}
          </div>
        </div>
      ))}

      <div>
        <p className="mb-2 px-1 text-[12px] font-medium text-muted-foreground">Account</p>
        <div className="space-y-2.5">
          <Disclosure title="My details">
            <DefinitionList
              items={[
                ['Registered mobile', u.phoneNumber],
                ['Official email', u.officialEmail ?? '—'],
                ['Joined', fmtDate(u.joinedAt)],
                ['Reporting Manager', me.primaryManager ? me.primaryManager.fullName : 'Not assigned'],
                ['Secondary reviewer', me.secondaryReviewer?.fullName ?? '—'],
              ]}
            />
            <form
              className="mt-4 grid gap-3 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                update.mutate({ alternatePhone: alt, location: loc }, { onSuccess: () => refresh() });
              }}
            >
              <Field label="Alternate phone">{(p) => <Input {...p} value={alt} onChange={(e) => setAlt(e.target.value)} inputMode="tel" />}</Field>
              <Field label="Work location">{(p) => <Input {...p} value={loc} onChange={(e) => setLoc(e.target.value)} />}</Field>
              <Button type="submit" variant="secondary" loading={update.isPending} className="sm:col-span-2">
                Save details
              </Button>
            </form>
          </Disclosure>
          <div id="password">
            <Disclosure title={<span className="flex items-center gap-2"><KeyRound className="size-4 text-muted-foreground" aria-hidden /> Change password</span>} defaultOpen={typeof window !== 'undefined' && window.location.hash === '#password'}>
              <form
                className="space-y-3"
                noValidate
                onSubmit={pw.handleSubmit(async (v) => {
                  setPwError(null);
                  try {
                    await backend().changePassword(v.current, v.next);
                    pw.reset();
                    toast.success('Password changed');
                  } catch (e) {
                    setPwError(errorMessage(e));
                  }
                })}
              >
                {pwError && <Notice tone="danger">{pwError}</Notice>}
                <Field label="Current password" required error={pw.formState.errors.current?.message}>
                  {(p) => <Input {...p} {...pw.register('current')} type="password" autoComplete="current-password" />}
                </Field>
                <Field label="New password" required error={pw.formState.errors.next?.message} hint="8+ characters with a number">
                  {(p) => <Input {...p} {...pw.register('next')} type="password" autoComplete="new-password" />}
                </Field>
                <Field label="Confirm new password" required error={pw.formState.errors.confirm?.message}>
                  {(p) => <Input {...p} {...pw.register('confirm')} type="password" autoComplete="new-password" />}
                </Field>
                <Button type="submit" loading={pw.formState.isSubmitting} className="w-full">
                  Change password
                </Button>
              </form>
            </Disclosure>
          </div>
          <Button variant="outline" className="w-full text-danger" onClick={() => void signOut().then(() => navigate('/login'))}>
            <LogOut /> Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}

type CalendarDay = { date: string; isWorkingDay: boolean; reason: string; source: string; exceptionName: string | null; deadline: string; weeklyPolicy: number[] };

/** Month view of the work calendar. Tap a date for its details. */
export function CalendarView({ admin, departmentId }: { admin?: boolean; departmentId?: string | null }) {
  const me = useMe();
  const [month, setMonth] = useState(me.today.slice(0, 7));
  const [selected, setSelected] = useState<CalendarDay | null>(null);
  const q = useOp('calendar.month', { month, departmentId: departmentId ?? null });
  const shift = (n: number) => {
    const [y, m] = month.split('-').map(Number) as [number, number];
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(d.toISOString().slice(0, 7));
  };
  const first = q.data?.days[0]?.date;
  const lead = first ? (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7 : 0;
  const exceptionsOn = (date: string) => (q.data?.exceptions ?? []).filter((e) => e.date === date);
  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[16px] font-semibold">{new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`))}</p>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={() => shift(-1)} aria-label="Previous month">
            <ChevronLeft />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => shift(1)} aria-label="Next month">
            <ChevronRight />
          </Button>
        </div>
      </div>
      {q.error && <ErrorState error={q.error} />}
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground" aria-hidden>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <div key={i} className="py-1">
            {d}
          </div>
        ))}
      </div>
      <ol className="grid grid-cols-7 gap-1">
        {Array.from({ length: lead }, (_, i) => (
          <li key={`l${i}`} aria-hidden />
        ))}
        {q.data?.days.map((d) => {
          const special = d.source !== 'WEEKLY_POLICY';
          return (
            <li key={d.date}>
              <button
                type="button"
                onClick={() => setSelected(d)}
                aria-label={`${fmtDate(d.date)}: ${d.isWorkingDay ? 'working day' : 'holiday'}${d.exceptionName ? `, ${d.exceptionName}` : ''}`}
                className={cn(
                  'tap relative flex aspect-square w-full cursor-pointer flex-col items-center justify-center rounded-xl text-[13px] font-medium',
                  d.isWorkingDay ? 'hover:bg-muted' : 'bg-muted text-muted-foreground',
                  special && (d.isWorkingDay ? 'bg-info-soft text-info' : 'bg-warning-soft text-warning'),
                  d.date === q.data.today && 'ring-2 ring-brand',
                )}
              >
                {Number(d.date.slice(8))}
                {special && <span className="absolute bottom-1.5 size-1 rounded-full bg-current" aria-hidden />}
              </button>
            </li>
          );
        })}
      </ol>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded bg-card ring-1 ring-border" /> Working</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded bg-muted" /> Holiday</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded bg-info-soft" /> Special working day</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded bg-warning-soft" /> Declared holiday</span>
      </div>
      {admin && <p className="mt-2 text-[11px] text-muted-foreground">Weekly pattern: {(q.data?.days[0]?.weeklyPolicy ?? []).map((w) => WEEKDAY_NAMES[w]?.slice(0, 3)).join(', ')}</p>}
      {selected && (
        <Sheet open onOpenChange={(o) => !o && setSelected(null)} title={fmtDate(selected.date, { weekday: 'long', day: 'numeric', month: 'long' })}>
          <div className="space-y-3 text-sm">
            <StatusBadge status={selected.isWorkingDay ? 'ACTIVE' : 'HOLIDAY'} label={selected.isWorkingDay ? 'Working day' : 'Holiday'} />
            <p>{selected.reason}</p>
            {selected.isWorkingDay && <p className="text-muted-foreground">Daily report due {fmtDateTime(selected.deadline)}</p>}
            {exceptionsOn(selected.date).map((e) => (
              <p key={e.id} className="rounded-xl bg-muted px-3 py-2 text-[13px]">
                {e.name}
                {e.departmentId ? ` · ${e.departmentId.replace('dept_', '').toUpperCase()} only` : ''}
                {e.description && <span className="block text-muted-foreground">{e.description}</span>}
              </p>
            ))}
          </div>
        </Sheet>
      )}
    </Card>
  );
}

export function CalendarPage() {
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader title="Work calendar" description="Tap a date for details" />
      <CalendarView />
    </div>
  );
}
