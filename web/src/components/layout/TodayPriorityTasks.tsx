import { ArrowRight, Check, CheckCircle2, Pencil } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Skeleton } from '@/components/ui/misc';
import { useOp } from '@/lib/api';
import { useMe } from '@/lib/session';
import { cn, fmtTime } from '@/lib/utils';

const PRIORITY_SLOTS = 3;

/**
 * Opens a WorkTrack page. In the desktop app the panel is a small side window, so pages open in the
 * normal browser (desktop/main.cjs sends new windows there); in the web app it's a normal link.
 */
function PageLink({ to, onNavigate, className, children }: { to: string; onNavigate?: () => void; className?: string; children: ReactNode }) {
  if (window.rgkWidget) {
    return (
      <a href={to} target="_blank" rel="noopener" className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link to={to} onClick={onNavigate} className={className}>
      {children}
    </Link>
  );
}

/** Today's 3 priority tasks from the daily report, read-only, with a link to fill or update them. */
export function TodayPriorityTasks({ onNavigate }: { onNavigate?: () => void }) {
  const me = useMe();
  const q = useOp('daily.getForDate', { workDate: me.today }, { staleTime: 30_000, refetchOnWindowFocus: true });
  const d = q.data;
  const report = d?.report ?? null;
  const primary = (report?.tasks ?? []).filter((t) => t.isPrimary);
  const submitted = report?.submissionStatus === 'SUBMITTED';
  const returned = report?.reviewStatus === 'RETURNED';
  const filled = primary.filter((t) => t.title.trim()).length;
  const restDay = d && !d.workingDay.isWorkingDay && !report;

  return (
    <section className="px-4 pt-4" aria-labelledby="priority-heading">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 id="priority-heading" className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
          Today’s {PRIORITY_SLOTS} priority tasks
        </h3>
        {returned ? (
          <StatusBadge status="RETURNED" />
        ) : submitted ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2.5 py-1 text-[12px] font-medium leading-none text-success">
            <CheckCircle2 className="size-3.5" aria-hidden /> Submitted
          </span>
        ) : report ? (
          <span className="text-[12px] font-medium text-muted-foreground">
            {filled} of {PRIORITY_SLOTS} filled
          </span>
        ) : null}
      </div>

      {q.isPending ? (
        <div className="space-y-2" role="status" aria-label="Loading priority tasks">
          <Skeleton className="h-14 rounded-2xl" />
          <Skeleton className="h-14 rounded-2xl" />
          <Skeleton className="h-14 rounded-2xl" />
        </div>
      ) : q.isError ? (
        <p className="rounded-2xl bg-danger-soft px-3 py-2.5 text-[12px] text-danger" role="alert">
          Couldn’t load today’s tasks.{' '}
          <button type="button" className="cursor-pointer font-semibold underline" onClick={() => void q.refetch()}>
            Try again
          </button>
        </p>
      ) : restDay ? (
        <p className="rounded-2xl border border-dashed px-3 py-3 text-[13px] text-muted-foreground">
          {d.workingDay.exceptionName ?? d.workingDay.reason} — no daily report needed today.
        </p>
      ) : (
        <ol className="space-y-2">
          {Array.from({ length: PRIORITY_SLOTS }, (_, i) => {
            const t = primary[i];
            const done = t?.status === 'COMPLETED';
            if (!t?.title.trim()) {
              return (
                <li key={i} className="flex items-center gap-3 rounded-2xl border border-dashed px-3 py-2.5">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[12px] font-semibold text-muted-foreground">{i + 1}</span>
                  <span className="text-[13px] text-muted-foreground">Task {i + 1} · not filled yet</span>
                </li>
              );
            }
            const time = t.plannedStartTime ? `${fmtTime(t.plannedStartTime)}${t.plannedEndTime ? ` – ${fmtTime(t.plannedEndTime)}` : ''}` : null;
            return (
              <li key={i} className={cn('rounded-2xl border px-3 py-2.5', done ? 'border-success/30 bg-success-soft/40' : 'bg-card')}>
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold',
                      done ? 'bg-success text-white dark:text-black' : 'bg-brand-soft text-brand',
                    )}
                    aria-hidden
                  >
                    {done ? <Check className="size-4" strokeWidth={3} /> : i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="sr-only">Task {i + 1}: </span>
                    <span className="block break-words text-[14px] font-medium leading-snug">{t.title}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
                      <StatusBadge status={t.status} className="px-2 py-0.5 text-[11px]" />
                      {time && <span>{time}</span>}
                    </span>
                  </span>
                  <span className="shrink-0 pt-0.5 text-[12px] font-semibold tabular-nums text-muted-foreground">{t.progressPercentage}%</span>
                </div>
                <div className="ml-10 mt-2 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div className={cn('h-full rounded-full', done ? 'bg-success' : 'bg-brand')} style={{ width: `${t.progressPercentage}%` }} />
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {!q.isPending && !q.isError && !restDay && (
        <PageLink
          to="/daily/today"
          onNavigate={onNavigate}
          className="tap mt-2 flex items-center justify-center gap-1.5 rounded-xl py-2 text-[13px] font-semibold text-primary hover:bg-brand-soft"
        >
          {submitted && !returned ? (
            <>
              View today’s report <ArrowRight className="size-4" aria-hidden />
            </>
          ) : (
            <>
              <Pencil className="size-3.5" aria-hidden /> {returned ? 'Make the requested changes' : filled ? 'Update today’s tasks' : 'Fill today’s 3 tasks'}
            </>
          )}
        </PageLink>
      )}
    </section>
  );
}
