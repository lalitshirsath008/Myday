import { firstName, greetingForHour, zonedParts } from '@rgk/core';
import { CalendarCheck, Check, CheckCircle2, ChevronRight, Hourglass, Loader, RotateCcw, Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import { ListCard, SectionTitle } from '@/components/common/layout';
import { MotivationQuote } from '@/components/common/MotivationQuote';
import { PriorityPrinciples } from '@/components/common/PriorityPrinciples';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { Avatar, ErrorState, PageSkeleton, Progress } from '@/components/ui/misc';
import { useOp } from '@/lib/api';
import { useMe } from '@/lib/session';
import { cn, fmtDate, fmtTime } from '@/lib/utils';

export function Greeting({ subtitle }: { subtitle?: string }) {
  const me = useMe();
  const { hour } = zonedParts(new Date(), me.settings.timezone);
  const name = firstName(me.user.fullName.replace(/\s*\(.*\)$/, ''));
  const greeting = greetingForHour(hour).replace('Good ', 'Good ').replace(/ (Morning|Afternoon|Evening)$/, (m) => m.toLowerCase());
  return (
    <div>
      <p className="text-[13px] font-medium text-muted-foreground">{fmtDate(me.today, { weekday: 'long', day: 'numeric', month: 'short' })}</p>
      <h1 className="mt-0.5 text-[24px] font-semibold leading-tight tracking-tight">
        {greeting}, {name}
      </h1>
      {subtitle ? <p className="mt-0.5 text-[14px] text-muted-foreground">{subtitle}</p> : <MotivationQuote name={name} seed={me.user.id} />}
    </div>
  );
}

function deadlineTime(iso: string, tz: string) {
  return fmtTime(zonedParts(new Date(iso), tz).time);
}

export function DashboardPage() {
  const me = useMe();
  const q = useOp('me.dashboard', {});
  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const report = d.todayReport;
  const submitted = !!report && report.version > 0;
  const returned = report?.reviewStatus === 'RETURNED';
  const slots = me.settings.primaryTaskSlots;
  const planned = d.todayTasks.planned;
  const done = d.todayTasks.completed;
  const total = Math.max(planned, slots);
  const isDone = submitted && !returned;

  const cta = !d.isReporter
    ? null
    : returned
      ? { label: 'Fix and resubmit', to: '/daily/today', icon: RotateCcw }
      : submitted
        ? { label: "View today's report", to: `/reports/daily/${report.id}`, icon: ChevronRight }
        : report
          ? { label: "Continue today's tasks", to: '/daily/today', icon: ChevronRight }
          : { label: d.workingDay.isWorkingDay ? "Add today's tasks" : 'Add holiday work', to: '/daily/today', icon: Sparkles };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Greeting />

      <PriorityPrinciples />

      <section
        aria-label="Today's work"
        className={cn(
          'relative overflow-hidden rounded-[24px] border p-5 shadow-[var(--shadow-card)] transition-colors duration-500',
          isDone ? 'border-success/25 bg-success-soft' : 'bg-card',
        )}
      >
        <div aria-hidden className={cn('pointer-events-none absolute -right-16 -top-16 size-48 rounded-full transition-colors duration-500', isDone ? 'bg-success/10' : 'bg-brand/10')} />
        <div className="relative">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[13px] font-medium text-muted-foreground">Today's work</p>
              {isDone ? (
                <p className="mt-1 flex items-center gap-2 text-[26px] font-semibold leading-none tracking-tight text-success">
                  <span className="flex size-8 animate-[icon-pop_0.5s_cubic-bezier(0.34,1.56,0.64,1)_both] items-center justify-center rounded-full bg-success text-white dark:text-black">
                    <Check className="size-5" strokeWidth={3} aria-hidden />
                  </span>
                  Done for today
                </p>
              ) : (
                <p className="mt-1 text-[28px] font-semibold leading-none tracking-tight">
                  {done}
                  <span className="text-[18px] font-medium text-muted-foreground">/{total} done</span>
                </p>
              )}
            </div>
            <StatusBadge status={!d.workingDay.isWorkingDay && !report ? 'HOLIDAY' : report ? (submitted ? report.reviewStatus : 'DRAFT') : 'NOT_SUBMITTED'} />
          </div>
          <Progress value={isDone ? 100 : total ? (done / total) * 100 : 0} className={cn('mt-4', isDone && 'bg-success/15')} label={isDone ? "Today's report submitted" : "Today's tasks completed"} />
          <p className={cn('mt-2.5 text-[13px]', isDone ? 'text-success' : 'text-muted-foreground')}>
            {!d.workingDay.isWorkingDay && !report
              ? `${d.workingDay.reason} · no report needed`
              : isDone
                ? `${planned} task${planned === 1 ? '' : 's'} submitted · ${done} completed${report.reviewStatus === 'APPROVED' ? ' · approved' : ''}`
                : returned
                  ? report.lastReviewComment ?? 'Your manager asked for changes'
                  : `Due today by ${deadlineTime(d.deadline, me.settings.timezone)}`}
          </p>
          {cta && (
            <Button asChild size="lg" variant={isDone ? 'success' : 'default'} className="mt-4 w-full text-[16px]">
              <Link to={cta.to}>
                <cta.icon /> {cta.label}
              </Link>
            </Button>
          )}
        </div>
      </section>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Completed', value: d.todayTasks.completed, icon: CheckCircle2, cls: 'bg-success-soft text-success' },
          { label: 'In progress', value: d.todayTasks.inProgress, icon: Loader, cls: 'bg-info-soft text-info' },
          { label: 'Pending', value: d.todayTasks.pending, icon: Hourglass, cls: 'bg-warning-soft text-warning' },
        ].map((c) => (
          <div key={c.label} className="rounded-2xl border bg-card p-3.5 shadow-[var(--shadow-card)]">
            <span className={`flex size-8 items-center justify-center rounded-xl ${c.cls}`}>
              <c.icon className="size-4" aria-hidden />
            </span>
            <p className="mt-2.5 text-[22px] font-semibold leading-none">{c.value}</p>
            <p className="mt-1 text-[12px] text-muted-foreground">{c.label}</p>
          </div>
        ))}
      </div>

      {(d.outstanding.overdue > 0 || d.returned.length > 1) && (
        <Link to="/reports/daily" className="tap flex items-center justify-between rounded-2xl bg-danger-soft px-4 py-3 text-[13px] font-medium text-danger">
          <span>
            {d.outstanding.overdue > 0 && `${d.outstanding.overdue} overdue task${d.outstanding.overdue > 1 ? 's' : ''}`}
            {d.outstanding.overdue > 0 && d.returned.length > 1 && ' · '}
            {d.returned.length > 1 && `${d.returned.length} reports need changes`}
          </span>
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      )}

      {d.isReporter && (
        <Link to="/weekly" className="tap flex items-center gap-3 rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)] hover:border-brand/40">
          <span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand">
            <CalendarCheck className="size-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-medium">Weekly report</span>
            <span className="block text-[12px] text-muted-foreground">This week · {d.compliance14d.submitted} of {d.compliance14d.expected} daily reports in the last 14 days</span>
          </span>
          <StatusBadge status={d.weeklyCurrent ? (d.weeklyCurrent.version > 0 ? d.weeklyCurrent.reviewStatus : 'DRAFT') : 'NOT_SUBMITTED'} />
        </Link>
      )}

      <div>
        <SectionTitle>Your manager</SectionTitle>
        <div className="flex items-center gap-3 rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
          {d.primaryManager ? (
            <>
              <Avatar name={d.primaryManager.fullName} className="size-11" />
              <div className="min-w-0">
                <p className="truncate text-[14px] font-medium">{d.primaryManager.fullName}</p>
                <p className="truncate text-[12px] text-muted-foreground">{d.primaryManager.designation}</p>
              </div>
              {d.awaitingReview > 0 && <span className="ml-auto shrink-0 text-[12px] text-muted-foreground">{d.awaitingReview} waiting for review</span>}
            </>
          ) : (
            <p className="text-[13px] text-warning">No manager assigned yet — contact your administrator.</p>
          )}
        </div>
      </div>

      {d.recentReports.length > 0 && (
        <div>
          <SectionTitle action={<Link to="/reports/daily" className="text-[13px] font-medium text-primary">See all</Link>}>Recent activity</SectionTitle>
          <div className="space-y-2.5">
            {d.recentReports.slice(0, 4).map((r) => (
              <ListCard key={r.id} to={r.version > 0 ? `/reports/daily/${r.id}` : `/daily/${r.workDate}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[14px] font-medium">{fmtDate(r.workDate, { weekday: 'short', day: 'numeric', month: 'short' })}</p>
                  <StatusBadge status={r.version > 0 ? r.reviewStatus : 'DRAFT'} />
                </div>
                <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                  {r.completed}/{r.taskCount} done · {r.titles.join(' · ') || 'No tasks'}
                </p>
              </ListCard>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
