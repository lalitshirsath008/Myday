import type { OpOutput } from '@rgk/core';
import { addDays } from '@rgk/core';
import { keepPreviousData } from '@tanstack/react-query';
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock, FileEdit, FolderKanban, Lock, Plus, RotateCcw, Users } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { PriorityBadge, StatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { ErrorState, Progress, Sheet } from '@/components/ui/misc';
import { PillSwitch } from '@/components/ui/pill-switch';
import { useOp } from '@/lib/api';
import { useMe } from '@/lib/session';
import { cn, fmtDate, fmtTime, plural } from '@/lib/utils';

type Data = OpOutput<'calendar.events'>;
type TaskRow = Data['tasks'][number];
type RoutineRow = Data['routine'][number];
type View = 'day' | '3day' | 'week' | 'month';
type Tone = 'info' | 'brand' | 'success' | 'danger' | 'neutral';
interface Filters {
  priority: boolean;
  other: boolean;
  routine: boolean;
}
interface CalEvent {
  key: string;
  date: string;
  start: number | null; // minutes from midnight
  end: number | null;
  title: string;
  label: string;
  tone: Tone;
  done: boolean;
  task?: TaskRow;
  routine?: RoutineRow;
}

const HOUR_PX = 48;
const MIN_PX = HOUR_PX / 60;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TONE: Record<Tone, string> = {
  info: 'bg-info-soft border-info',
  brand: 'bg-brand-soft border-brand',
  success: 'bg-success-soft border-success',
  danger: 'bg-danger-soft border-danger',
  neutral: 'bg-neutral-soft border-neutral',
};
const DOT: Record<Tone, string> = { info: 'bg-info', brand: 'bg-brand', success: 'bg-success', danger: 'bg-danger', neutral: 'bg-neutral' };
const STATUS_TONE: Record<string, Tone> = { PLANNED: 'info', IN_PROGRESS: 'brand', COMPLETED: 'success', BLOCKED: 'danger' };
const LEGEND: [Tone, string][] = [
  ['info', 'Planned'],
  ['brand', 'In progress'],
  ['success', 'Done'],
  ['danger', 'Blocked'],
  ['neutral', 'My day'],
];
const GRID_LINES = {
  backgroundImage:
    'repeating-linear-gradient(to bottom, var(--color-border) 0 1px, transparent 1px 48px), repeating-linear-gradient(to bottom, transparent 0 24px, color-mix(in oklab, var(--color-border) 45%, transparent) 24px 25px, transparent 25px 48px)',
};

const toMin = (t: string | null) => {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const toHHMM = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const shortTime = (min: number) => fmtTime(toHHMM(min)).replace(':00', '').replace(' ', '');
const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const mondayOf = (d: string) => addDays(d, -((dow(d) + 6) % 7));
const firstOfMonth = (d: string) => `${d.slice(0, 7)}-01`;
const shiftMonth = (d: string, n: number) => {
  const [y, m] = d.split('-').map(Number);
  return new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1 + n, 1)).toISOString().slice(0, 10);
};
const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', ...o }).format(new Date(`${d}T00:00:00Z`));
const nowMinutes = () => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  return toMin(p) ?? 0;
};

function visibleDays(view: View, anchor: string): string[] {
  const start = view === 'week' ? mondayOf(anchor) : view === 'month' ? mondayOf(firstOfMonth(anchor)) : anchor;
  const n = view === 'day' ? 1 : view === '3day' ? 3 : view === 'week' ? 7 : 42;
  return Array.from({ length: n }, (_, i) => addDays(start, i));
}

function rangeTitle(view: View, anchor: string, days: string[]): string {
  if (view === 'month') return fmt(anchor, { month: 'long', year: 'numeric' });
  if (view === 'day') return fmt(anchor, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const a = days[0]!;
  const b = days[days.length - 1]!;
  return a.slice(0, 7) === b.slice(0, 7)
    ? `${fmt(a, { day: 'numeric' })} – ${fmt(b, { day: 'numeric', month: 'short', year: 'numeric' })}`
    : `${fmt(a, { day: 'numeric', month: 'short' })} – ${fmt(b, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function buildEvents(data: Data | undefined, show: Filters): CalEvent[] {
  if (!data) return [];
  const out: CalEvent[] = [];
  for (const t of data.tasks) {
    if (t.isPrimary ? !show.priority : !show.other) continue;
    const start = toMin(t.plannedStartTime ?? t.actualStartTime);
    let end = toMin(t.plannedStartTime ? t.plannedEndTime : t.actualEndTime);
    // No end → one hour; an end before the start (overnight) → till midnight.
    if (start !== null) end = end === null ? start + 60 : end <= start ? 24 * 60 : end;
    out.push({
      key: `t-${t.reportId}-${t.slot}`,
      date: t.workDate,
      start,
      end: start === null ? null : end,
      title: t.title,
      label: t.isPrimary ? `Task ${t.slot}` : 'Extra task',
      tone: STATUS_TONE[t.status] ?? 'info',
      done: t.status === 'COMPLETED',
      task: t,
    });
  }
  if (show.routine) {
    for (const r of data.routine) {
      const start = toMin(r.time);
      out.push({ key: `r-${r.date}-${r.id}`, date: r.date, start, end: start === null ? null : start + 30, title: r.text, label: 'My day', tone: 'neutral', done: r.done, routine: r });
    }
  }
  return out.sort((a, b) => (a.start ?? -1) - (b.start ?? -1) || a.title.localeCompare(b.title));
}

/** Side-by-side columns for overlapping events, like Outlook. */
function layoutColumns(events: CalEvent[]): Map<string, { col: number; cols: number }> {
  const out = new Map<string, { col: number; cols: number }>();
  const timed = events.filter((e) => e.start !== null).sort((a, b) => a.start! - b.start! || b.end! - b.start! - (a.end! - a.start!));
  let cluster: CalEvent[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    for (const e of cluster) out.get(e.key)!.cols = colEnds.length;
    cluster = [];
    colEnds = [];
    clusterEnd = -1;
  };
  for (const e of timed) {
    const end = Math.max(e.end!, e.start! + 30);
    if (cluster.length && e.start! >= clusterEnd) flush();
    let col = colEnds.findIndex((x) => x <= e.start!);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(end);
    } else colEnds[col] = end;
    out.set(e.key, { col, cols: 1 });
    cluster.push(e);
    clusterEnd = Math.max(clusterEnd, end);
  }
  flush();
  return out;
}

function useNarrow() {
  const query = '(max-width: 767px)';
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

function ReportMark({ report }: { report: Data['reports'][number] | undefined }) {
  if (!report) return null;
  if (report.reviewStatus === 'RETURNED') return <RotateCcw className="size-3 text-danger" aria-label="Report needs changes" />;
  if (report.submissionStatus === 'SUBMITTED') return <CheckCircle2 className="size-3 text-success" aria-label="Report submitted" />;
  return <FileEdit className="size-3 text-muted-foreground" aria-label="Report draft" />;
}

function EventChip({ e, onOpen }: { e: CalEvent; onOpen: (e: CalEvent) => void }) {
  return (
    <button
      type="button"
      onClick={(ev) => {
        ev.stopPropagation();
        onOpen(e);
      }}
      title={e.title}
      className="flex w-full min-w-0 cursor-pointer items-center gap-1 rounded-md px-1 py-[3px] text-left text-[11px] leading-tight hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      <span className={cn('size-2 shrink-0 rounded-full', DOT[e.tone])} aria-hidden />
      {e.start !== null && <span className="shrink-0 tabular-nums text-muted-foreground">{shortTime(e.start)}</span>}
      <span className={cn('truncate', e.done && 'text-muted-foreground line-through')}>{e.title}</span>
    </button>
  );
}

function TimeGrid({ days, data, events, today, onOpen, onPickDay }: { days: string[]; data: Data | undefined; events: CalEvent[]; today: string; onOpen: (e: CalEvent) => void; onPickDay: (d: string) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(nowMinutes);
  useEffect(() => {
    const t = setInterval(() => setNow(nowMinutes()), 60_000);
    return () => clearInterval(t);
  }, []);
  const byDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of events) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    return m;
  }, [events]);
  const info = (d: string) => data?.days.find((x) => x.date === d);
  const reportOn = (d: string) => data?.reports.find((r) => r.workDate === d);
  const allDay = (d: string) => (byDay.get(d) ?? []).filter((e) => e.start === null);
  const hasAllDay = days.some((d) => allDay(d).length > 0);
  const cols = `52px repeat(${days.length}, minmax(0, 1fr))`;

  // Open on the working morning, or earlier if something starts before 8 am.
  const rangeKey = days.join();
  const firstStart = Math.min(8 * 60, ...events.filter((e) => e.start !== null && days.includes(e.date)).map((e) => e.start!));
  useLayoutEffect(() => {
    scroller.current?.scrollTo({ top: Math.max(0, (firstStart - 30) * MIN_PX) });
    // Only when the visible range changes, not on every refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid border-b" style={{ gridTemplateColumns: cols }}>
        <div />
        {days.map((d) => {
          const di = info(d);
          return (
            <button
              key={d}
              type="button"
              onClick={() => onPickDay(d)}
              aria-label={`Open ${fmt(d, { weekday: 'long', day: 'numeric', month: 'long' })}`}
              className={cn('flex min-w-0 cursor-pointer flex-col items-center gap-0.5 border-l px-1 py-1.5 hover:bg-muted/60', di && !di.isWorkingDay && 'bg-muted/50')}
            >
              <span className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {fmt(d, { weekday: 'short' })}
                <ReportMark report={reportOn(d)} />
              </span>
              <span className={cn('flex size-8 items-center justify-center rounded-full text-[15px] font-semibold', d === today ? 'bg-primary text-primary-foreground' : 'text-foreground')}>{Number(d.slice(8))}</span>
              {di && (!di.isWorkingDay || di.exceptionName) && (
                <span title={di.exceptionName ?? di.reason} className={cn('max-w-full truncate px-1 text-[10px] font-medium', di.isWorkingDay ? 'text-info' : 'text-warning')}>{di.exceptionName ?? 'Off'}</span>
              )}
            </button>
          );
        })}
      </div>
      {hasAllDay && (
        <div className="grid border-b" style={{ gridTemplateColumns: cols }}>
          <div className="py-1.5 pr-2 text-right text-[10px] text-muted-foreground">All day</div>
          {days.map((d) => (
            <div key={d} className="min-w-0 space-y-0.5 border-l p-0.5">
              {allDay(d).map((e) => (
                <EventChip key={e.key} e={e} onOpen={onOpen} />
              ))}
            </div>
          ))}
        </div>
      )}
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
        <div className="grid" style={{ gridTemplateColumns: cols, height: 24 * HOUR_PX }}>
          <div className="relative" aria-hidden>
            {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
              <span key={h} className="absolute right-2 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground" style={{ top: h * HOUR_PX }}>
                {shortTime(h * 60)}
              </span>
            ))}
          </div>
          {days.map((d) => {
            const di = info(d);
            const timed = (byDay.get(d) ?? []).filter((e) => e.start !== null);
            const cols = layoutColumns(timed);
            return (
              <div key={d} className={cn('relative border-l', di && !di.isWorkingDay && 'bg-muted/40')} style={GRID_LINES}>
                {timed.map((e) => {
                  const pos = cols.get(e.key) ?? { col: 0, cols: 1 };
                  const height = Math.max(22, (e.end! - e.start!) * MIN_PX - 2);
                  return (
                    <button
                      key={e.key}
                      type="button"
                      onClick={() => onOpen(e)}
                      aria-label={`${e.label}: ${e.title}, ${fmtTime(toHHMM(e.start!))} to ${fmtTime(toHHMM(e.end!))}${e.done ? ', done' : ''}`}
                      className={cn(
                        'absolute z-10 cursor-pointer overflow-hidden rounded-md border-l-[3px] px-1.5 py-1 text-left text-[11px] leading-tight shadow-[0_1px_2px_rgba(0,0,0,0.08)] transition-[filter] hover:brightness-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                        TONE[e.tone],
                      )}
                      style={{ top: e.start! * MIN_PX + 1, height, left: `calc(${(pos.col / pos.cols) * 100}% + 2px)`, width: `calc(${100 / pos.cols}% - 4px)` }}
                    >
                      <span className={cn('block truncate font-semibold text-foreground', e.done && 'text-muted-foreground line-through')}>
                        {e.done && <CheckCircle2 className="mr-0.5 inline size-3 -translate-y-px text-success" aria-hidden />}
                        {e.title}
                      </span>
                      {height > 34 && (
                        <span className="block truncate text-muted-foreground">
                          {shortTime(e.start!)} – {shortTime(e.end!)} · {e.label}
                        </span>
                      )}
                    </button>
                  );
                })}
                {d === today && (
                  <div className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-danger" style={{ top: now * MIN_PX }} aria-hidden>
                    <span className="absolute -left-1 -top-[3px] size-2 rounded-full bg-danger" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MonthGrid({
  days,
  anchor,
  data,
  events,
  today,
  narrow,
  selected,
  onSelect,
  onOpen,
  onPickDay,
}: {
  days: string[];
  anchor: string;
  data: Data | undefined;
  events: CalEvent[];
  today: string;
  narrow: boolean;
  selected: string;
  onSelect: (d: string) => void;
  onOpen: (e: CalEvent) => void;
  onPickDay: (d: string) => void;
}) {
  const month = anchor.slice(0, 7);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-7 border-b text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground" aria-hidden>
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-2">
            {narrow ? w[0] : w}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {days.map((d) => {
          const di = data?.days.find((x) => x.date === d);
          const evs = events.filter((e) => e.date === d);
          const inMonth = d.startsWith(month);
          const label = `${fmt(d, { weekday: 'long', day: 'numeric', month: 'long' })}${di && !di.isWorkingDay ? `, ${di.exceptionName ?? 'off'}` : ''}, ${plural(evs.length, 'item')}`;
          return (
            <div
              key={d}
              className={cn(
                'min-w-0 overflow-hidden border-b border-l p-1',
                !inMonth && 'bg-muted/25',
                di && !di.isWorkingDay && 'bg-muted/50',
                narrow && 'cursor-pointer',
                narrow && selected === d && 'bg-brand-soft/60',
              )}
              onClick={narrow ? () => onSelect(d) : undefined}
            >
              <div className="flex items-center justify-between gap-1">
                <button
                  type="button"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    if (narrow) onSelect(d);
                    else onPickDay(d);
                  }}
                  aria-label={label}
                  className={cn(
                    'flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-[12px] font-semibold hover:bg-muted',
                    d === today && 'bg-primary text-primary-foreground hover:bg-primary',
                    !inMonth && d !== today && 'text-muted-foreground',
                  )}
                >
                  {Number(d.slice(8))}
                </button>
                {!narrow && di?.exceptionName && <span title={di.exceptionName} className={cn('truncate text-[10px] font-medium', di.isWorkingDay ? 'text-info' : 'text-warning')}>{di.exceptionName}</span>}
              </div>
              {narrow ? (
                <div className="mt-1 flex flex-wrap justify-center gap-0.5" aria-hidden>
                  {evs.slice(0, 4).map((e) => (
                    <span key={e.key} className={cn('size-1.5 rounded-full', DOT[e.tone])} />
                  ))}
                </div>
              ) : (
                <div className="mt-0.5 space-y-px">
                  {evs.slice(0, 3).map((e) => (
                    <EventChip key={e.key} e={e} onOpen={onOpen} />
                  ))}
                  {evs.length > 3 && (
                    <button type="button" onClick={() => onPickDay(d)} className="cursor-pointer px-1 text-[11px] font-medium text-muted-foreground hover:text-foreground">
                      +{evs.length - 3} more
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MiniMonth({ anchor, today, range, onPick }: { anchor: string; today: string; range: string[]; onPick: (d: string) => void }) {
  const [month, setMonth] = useState(firstOfMonth(anchor));
  useEffect(() => setMonth(firstOfMonth(anchor)), [anchor]);
  const days = visibleDays('month', month);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <p className="text-[13px] font-semibold">{fmt(month, { month: 'long', year: 'numeric' })}</p>
        <div className="flex">
          <Button variant="ghost" size="icon" className="size-7" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="size-7" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-7 text-center text-[10px] font-medium text-muted-foreground" aria-hidden>
        {WEEKDAYS.map((w) => (
          <span key={w} className="py-1">
            {w[0]}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {days.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => onPick(d)}
            aria-label={fmt(d, { weekday: 'long', day: 'numeric', month: 'long' })}
            className={cn(
              'mx-auto flex size-7 cursor-pointer items-center justify-center rounded-full text-[12px] tabular-nums hover:bg-muted',
              !d.startsWith(month.slice(0, 7)) && 'text-muted-foreground/60',
              range.includes(d) && 'bg-brand-soft font-semibold text-foreground',
              d === today && 'bg-primary font-semibold text-primary-foreground hover:bg-primary',
            )}
          >
            {Number(d.slice(8))}
          </button>
        ))}
      </div>
    </div>
  );
}

function EventSheet({ e, data, onClose }: { e: CalEvent; data: Data | undefined; onClose: () => void }) {
  const t = e.task;
  const isSelf = data?.isSelf ?? true;
  const link = t ? (isSelf ? `/daily/${e.date}` : `/reviews/daily/${t.reportId}`) : null;
  const time = e.start !== null ? `${fmtTime(toHHMM(e.start))} – ${fmtTime(toHHMM(e.end!))}` : 'All day';
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={e.title}
      footer={
        link && (
          <Button asChild className="w-full">
            <Link to={link}>{isSelf ? 'Open daily report' : 'Open report'}</Link>
          </Button>
        )
      }
    >
      <div className="space-y-3.5 text-[14px]">
        <p className="flex items-center gap-2 text-muted-foreground">
          <CalendarDays className="size-4 shrink-0" aria-hidden />
          {fmtDate(e.date, { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
        <p className="flex items-center gap-2 text-muted-foreground">
          <Clock className="size-4 shrink-0" aria-hidden />
          {time}
        </p>
        {t && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-muted px-2.5 py-1 text-[12px] font-medium">{e.label}</span>
              <StatusBadge status={t.status} />
              <PriorityBadge priority={t.priority} />
            </div>
            <div>
              <div className="mb-1 flex justify-between text-[12px]">
                <span className="text-muted-foreground">Progress</span>
                <span className="font-semibold tabular-nums">{t.progressPercentage}%</span>
              </div>
              <Progress value={t.progressPercentage} label="Task progress" />
            </div>
            {t.projectName && (
              <p className="flex items-center gap-2">
                <FolderKanban className="size-4 shrink-0 text-muted-foreground" aria-hidden /> {t.projectName}
              </p>
            )}
            {t.collaborators > 0 && (
              <p className="flex items-center gap-2">
                <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden /> {plural(t.collaborators, 'collaborator')}
              </p>
            )}
            {t.actualStartTime && (t.actualStartTime !== t.plannedStartTime || t.actualEndTime !== t.plannedEndTime) && (
              <p className="text-[13px] text-muted-foreground">
                Actual: {fmtTime(t.actualStartTime)}
                {t.actualEndTime ? ` – ${fmtTime(t.actualEndTime)}` : ''}
              </p>
            )}
            {t.description && <p className="whitespace-pre-wrap rounded-xl bg-muted/60 p-3 text-[13px] leading-relaxed">{t.description}</p>}
          </>
        )}
        {e.routine && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-neutral-soft px-2.5 py-1 text-[12px] font-medium text-neutral">My day</span>
              <StatusBadge status={e.routine.done ? 'COMPLETED' : 'PLANNED'} label={e.routine.done ? 'Done' : 'Not done yet'} />
            </div>
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Lock className="size-3.5" aria-hidden /> From your My day list. Only you can see it.
            </p>
          </>
        )}
      </div>
    </Sheet>
  );
}

/** Outlook-style work calendar: day / week / month views with daily-report tasks, My day items and holidays. */
export function WorkCalendarPage() {
  const me = useMe();
  const narrow = useNarrow();
  const [view, setView] = useState<View>(() => (window.matchMedia('(max-width: 767px)').matches ? 'day' : 'week'));
  const [anchor, setAnchor] = useState(me.today);
  const [selected, setSelected] = useState(me.today);
  const [personId, setPersonId] = useState<string | null>(null);
  const [open, setOpen] = useState<CalEvent | null>(null);
  const [show, setShow] = useState<Filters>({ priority: true, other: true, routine: true });
  const effectiveView: View = narrow && view === 'week' ? '3day' : !narrow && view === '3day' ? 'week' : view;
  const days = useMemo(() => visibleDays(effectiveView, anchor), [effectiveView, anchor]);
  const q = useOp('calendar.events', { from: days[0]!, to: days[days.length - 1]!, employeeId: personId }, { placeholderData: keepPreviousData });
  const canPickPerson = me.role !== 'EMPLOYEE';
  const people = useOp('directory.list', { query: '', departmentId: null, role: null, status: null, managerId: null, limit: 200, offset: 0 }, { enabled: canPickPerson, staleTime: 5 * 60_000 });
  const today = q.data?.today ?? me.today;
  const events = useMemo(() => buildEvents(q.data, show), [q.data, show]);
  const isSelf = q.data?.isSelf ?? personId === null;

  const step = (n: number) => {
    if (effectiveView === 'month') setAnchor(shiftMonth(anchor, n));
    else setAnchor(addDays(anchor, n * (effectiveView === 'day' ? 1 : effectiveView === '3day' ? 3 : 7)));
  };
  const unit = effectiveView === 'day' ? 'day' : effectiveView === '3day' ? '3 days' : effectiveView === 'week' ? 'week' : 'month';
  const pickDay = (d: string) => {
    setAnchor(d);
    setSelected(d);
    setView('day');
  };
  const viewOptions: { value: View; label: string }[] = narrow
    ? [
        { value: 'day', label: 'Day' },
        { value: '3day', label: '3 days' },
        { value: 'month', label: 'Month' },
      ]
    : [
        { value: 'day', label: 'Day' },
        { value: 'week', label: 'Week' },
        { value: 'month', label: 'Month' },
      ];
  const team = (people.data?.items ?? []).filter((p) => p.id !== me.user.id && p.accountStatus === 'ACTIVE').sort((a, b) => a.fullName.localeCompare(b.fullName));
  const personSelect = canPickPerson && (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-muted-foreground">Calendar of</span>
      <select
        value={personId ?? ''}
        onChange={(e) => setPersonId(e.target.value || null)}
        className="h-10 w-full rounded-xl border border-input bg-card px-3 text-[14px] focus-visible:border-brand focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/15"
      >
        <option value="">My calendar</option>
        {team.map((p) => (
          <option key={p.id} value={p.id}>
            {p.fullName} · {p.employeeCode}
          </option>
        ))}
      </select>
    </label>
  );
  const legend = (
    <ul className="flex flex-wrap gap-x-3 gap-y-1.5 text-[12px] text-muted-foreground lg:flex-col">
      {LEGEND.filter(([tone]) => tone !== 'neutral' || isSelf).map(([tone, label]) => (
        <li key={tone} className="flex items-center gap-1.5">
          <span className={cn('size-2.5 rounded-sm', DOT[tone])} aria-hidden /> {label}
        </li>
      ))}
    </ul>
  );
  const agendaDay = effectiveView === 'month' ? selected : anchor;
  const agenda = events.filter((e) => e.date === agendaDay);

  return (
    <div className="mx-auto flex max-w-[1400px] gap-6">
      <aside className="hidden w-60 shrink-0 space-y-6 lg:block">
        {isSelf && me.isReporter && (
          <Button asChild className="w-full">
            <Link to="/daily/today">
              <Plus /> New task
            </Link>
          </Button>
        )}
        <MiniMonth anchor={anchor} today={today} range={effectiveView === 'month' ? [] : days} onPick={(d) => (setAnchor(d), setSelected(d))} />
        {personSelect}
        <fieldset>
          <legend className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Show</legend>
          <div className="space-y-2 text-[14px]">
            {(
              [
                ['priority', 'Priority tasks (1–3)'],
                ['other', 'Extra tasks'],
                ...(isSelf ? [['routine', 'My day']] : []),
              ] as [keyof Filters, string][]
            ).map(([k, label]) => (
              <label key={k} className="flex cursor-pointer items-center gap-2.5">
                <input type="checkbox" checked={show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} className="size-4 accent-[var(--color-primary)]" />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Colours</p>
          {legend}
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <h1 className="sr-only">Work calendar</h1>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => (setAnchor(today), setSelected(today))}>
            Today
          </Button>
          <div className="flex">
            <Button variant="ghost" size="icon" onClick={() => step(-1)} aria-label={`Go to previous ${unit}`}>
              <ChevronLeft />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => step(1)} aria-label={`Go to next ${unit}`}>
              <ChevronRight />
            </Button>
          </div>
          <h2 className="min-w-0 flex-1 truncate text-[17px] font-semibold tracking-tight sm:text-[20px]" aria-live="polite">
            {rangeTitle(effectiveView, anchor, days)}
          </h2>
          <PillSwitch label="Calendar view" value={effectiveView} onChange={setView} options={viewOptions} className="w-full sm:w-[260px]" />
        </div>
        {!isSelf && q.data && (
          <p className="mb-3 flex items-center gap-2 rounded-xl bg-info-soft px-3 py-2 text-[13px] text-info">
            <Users className="size-4 shrink-0" aria-hidden /> Viewing {q.data.person.fullName}’s calendar · submitted reports only
          </p>
        )}
        {canPickPerson && <div className="mb-3 lg:hidden">{personSelect}</div>}
        {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}

        <div
          className={cn(
            'relative flex flex-col overflow-hidden rounded-[var(--radius-card)] border bg-card shadow-[var(--shadow-card)]',
            effectiveView === 'month' && narrow ? 'h-[360px]' : 'h-[calc(100dvh-15rem)] min-h-[480px] lg:h-[calc(100dvh-11rem)]',
          )}
        >
          {q.isFetching && <div className="absolute inset-x-0 top-0 z-30 h-0.5 animate-pulse bg-brand" aria-hidden />}
          {effectiveView === 'month' ? (
            <MonthGrid days={days} anchor={anchor} data={q.data} events={events} today={today} narrow={narrow} selected={selected} onSelect={setSelected} onOpen={setOpen} onPickDay={pickDay} />
          ) : (
            <TimeGrid days={days} data={q.data} events={events} today={today} onOpen={setOpen} onPickDay={pickDay} />
          )}
        </div>

        {narrow && effectiveView === 'month' && (
          <section className="mt-4" aria-label={`Agenda for ${fmtDate(agendaDay)}`}>
            <p className="mb-2 text-[13px] font-semibold">{fmt(agendaDay, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            {agenda.length === 0 ? (
              <p className="rounded-2xl border border-dashed px-3 py-4 text-center text-[13px] text-muted-foreground">Nothing on this day</p>
            ) : (
              <ul className="space-y-2">
                {agenda.map((e) => (
                  <li key={e.key}>
                    <button type="button" onClick={() => setOpen(e)} className={cn('flex w-full cursor-pointer items-center gap-3 rounded-2xl border-l-4 p-3 text-left', TONE[e.tone])}>
                      <span className="w-14 shrink-0 text-[12px] tabular-nums text-muted-foreground">{e.start !== null ? shortTime(e.start) : 'All day'}</span>
                      <span className="min-w-0 flex-1">
                        <span className={cn('block truncate text-[14px] font-medium', e.done && 'text-muted-foreground line-through')}>{e.title}</span>
                        <span className="block text-[12px] text-muted-foreground">{e.label}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        <div className="mt-3 lg:hidden">{legend}</div>
      </div>

      {open && <EventSheet e={open} data={q.data} onClose={() => setOpen(null)} />}
    </div>
  );
}
