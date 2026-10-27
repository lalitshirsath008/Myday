import type { RoutineItem } from '@rgk/core';
import { AlarmClock, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useOp } from '@/lib/api';
import { playChime } from '@/lib/notifySound';
import { useMe } from '@/lib/session';
import { cn, fmtTime } from '@/lib/utils';

export interface StartAlert {
  key: string;
  title: string;
  time: string; // HH:mm, company time
  label: string; // "My day" or "Priority task 1"
}

const SHOW_MS = 5000;
/** A start time is announced if the app is open within this many minutes after it (e.g. laptop just woke). */
const WINDOW_MIN = 5;

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const nowMinutes = (timeZone: string) => toMin(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()));

function readFired(key: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]') as string[];
  } catch {
    return [];
  }
}

/**
 * Calls `onAlert` when a timed My day item or a priority task reaches its start time today.
 * Each one fires once per day on this device (remembered across reloads); done items are skipped.
 */
export function useTaskStartAlerts(routine: RoutineItem[], onAlert: (a: StartAlert) => void) {
  const me = useMe();
  const daily = useOp('daily.getForDate', { workDate: me.today }, { enabled: me.isReporter, staleTime: 5 * 60_000, refetchInterval: 10 * 60_000, refetchIntervalInBackground: true });
  const tasks = daily.data?.report?.tasks;
  const candidates = useMemo(() => {
    const list: StartAlert[] = [];
    for (const r of routine) if (r.time && !r.done) list.push({ key: `r:${r.id}:${r.time}`, title: r.text, time: r.time, label: 'My day' });
    for (const t of tasks ?? []) {
      if (t.isPrimary && t.title.trim() && t.plannedStartTime && t.status !== 'COMPLETED') {
        list.push({ key: `p:${t.slot}:${t.plannedStartTime}:${t.title}`, title: t.title, time: t.plannedStartTime, label: `Priority task ${t.slot}` });
      }
    }
    return list;
  }, [routine, tasks]);

  const latest = useRef(onAlert);
  useEffect(() => {
    latest.current = onAlert;
  });

  const timeZone = me.settings.timezone;
  const storeKey = `rgk-start-alerts:${me.user.id}:${me.today}`;
  useEffect(() => {
    const tick = () => {
      const now = nowMinutes(timeZone);
      const fired = readFired(storeKey);
      const due = candidates.filter((c) => !fired.includes(c.key) && now >= toMin(c.time) && now - toMin(c.time) < WINDOW_MIN);
      if (!due.length) return;
      try {
        localStorage.setItem(storeKey, JSON.stringify([...fired, ...due.map((c) => c.key)]));
      } catch {
        // Without storage an alert may repeat after a reload; still better than none.
      }
      due.sort((a, b) => a.time.localeCompare(b.time)).forEach((c) => latest.current(c));
    };
    tick();
    const t = setInterval(tick, 15_000);
    return () => clearInterval(t);
  }, [candidates, storeKey, timeZone]);
}

/**
 * The big orange strip that slides out of the My day tab for 5 seconds: "11:39 am · Time to start".
 * One at a time, exactly 5 seconds each; the arrow pushes it back early, a tap opens My day.
 */
export function TaskStartStrip({ alerts, onOpen, onDone }: { alerts: StartAlert[]; onOpen: () => void; onDone: () => void }) {
  const current = alerts[0];
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const hide = () => {
    clearTimeout(timer.current);
    setLeaving(true);
    timer.current = setTimeout(() => {
      setLeaving(false);
      onDone();
    }, 320);
  };
  const hideRef = useRef(hide);
  useEffect(() => {
    hideRef.current = hide;
  });

  useEffect(() => {
    if (current) playChime();
  }, [current]);
  // Always 5 seconds (it often appears right under the pointer, so no pause on hover).
  useEffect(() => {
    if (!current) return;
    timer.current = setTimeout(() => hideRef.current(), SHOW_MS);
    return () => clearTimeout(timer.current);
  }, [current]);

  if (!current) return null;
  return (
    <div
      role="alert"
      aria-label={`${fmtTime(current.time)}, time to start: ${current.title}`}
      className={cn(
        'no-print fixed right-0 top-[calc(42%-10px)] z-[60] w-[min(560px,calc(100vw-12px))] overflow-hidden rounded-l-[28px] bg-gradient-to-r from-[#B84A08] via-[#D45A0A] to-[#F07418] text-white shadow-[0_18px_50px_rgba(200,83,10,0.45)]',
        leaving ? 'animate-[strip-out_0.32s_ease-in_both]' : 'animate-[strip-in_0.55s_cubic-bezier(0.2,0.9,0.25,1.1)_both]',
      )}
    >
      <div className="flex items-center gap-4 py-4 pl-5 pr-3">
        <button type="button" onClick={() => (hide(), onOpen())} className="flex min-w-0 flex-1 cursor-pointer items-center gap-4 text-left focus-visible:outline-none">
          <span className="flex size-14 shrink-0 animate-[icon-pop_0.5s_0.25s_cubic-bezier(0.34,1.56,0.64,1)_both] items-center justify-center rounded-2xl bg-white text-primary shadow-[0_4px_14px_rgba(0,0,0,0.18)]">
            <AlarmClock className="size-7" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11.5px] font-semibold uppercase tracking-[0.08em] text-white/80">{fmtTime(current.time)} · Time to start</span>
            <span className="mt-0.5 line-clamp-2 block text-[20px] font-semibold leading-tight">{current.title}</span>
            <span className="mt-1.5 inline-block rounded-full bg-white/20 px-2.5 py-0.5 text-[11.5px] font-medium">{current.label}</span>
          </span>
        </button>
        <button type="button" onClick={hide} aria-label="Hide" className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-white/20 transition-colors hover:bg-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
          <ChevronRight className="size-6" aria-hidden />
        </button>
      </div>
      {/* 5-second countdown */}
      <div className="h-1 bg-white/15" aria-hidden>
        <div key={current.key} className="h-full origin-left animate-[strip-countdown_5s_linear_both] bg-white/70" />
      </div>
    </div>
  );
}
