import { BadgeCheck, Cog, HeartHandshake, Lightbulb, type LucideIcon, Truck, Workflow } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/** What "priority" means at RGK — set by management. Edit this list to change the points everywhere. */
export const PRIORITY_POINTS: { title: string; line: string; icon: LucideIcon; tint: string }[] = [
  { title: 'Dispatch in time', line: 'Deliver on the committed date, every time.', icon: Truck, tint: 'from-orange-400 to-amber-500' },
  { title: 'Quality', line: 'Right first time — no rework, no defects.', icon: BadgeCheck, tint: 'from-emerald-400 to-green-600' },
  { title: 'Clarity of process', line: 'Know the steps, follow the standard, write it down.', icon: Workflow, tint: 'from-sky-400 to-blue-600' },
  { title: 'System related questions', line: 'Raise process doubts early and settle them before work starts.', icon: Cog, tint: 'from-violet-400 to-purple-600' },
  { title: 'One-Up & Customer Happiness', line: 'Go one step beyond to delight the customer.', icon: HeartHandshake, tint: 'from-pink-400 to-rose-500' },
  { title: 'Process Improvement – Value Engineering', line: 'Cut waste and cost, add value to every process.', icon: Lightbulb, tint: 'from-amber-400 to-orange-600' },
];

const SLIDE_MS = 6000;

/**
 * Slim "What is priority?" strip: one point at a time with a smooth slide, swipeable,
 * iOS-style page dots. Pauses while touched or hovered; no auto-advance with reduced motion.
 */
export function PriorityPrinciples({ className }: { className?: string }) {
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [held, setHeld] = useState(false);
  const [reduced] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const count = PRIORITY_POINTS.length;
  const current = PRIORITY_POINTS[active] ?? PRIORITY_POINTS[0]!;

  const goTo = useCallback(
    (i: number) => {
      const el = track.current;
      if (el) el.scrollTo({ left: i * el.clientWidth, behavior: reduced ? 'auto' : 'smooth' });
    },
    [reduced],
  );

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const onScroll = () => setActive(Math.min(count - 1, Math.round(el.scrollLeft / Math.max(1, el.clientWidth))));
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [count]);

  useEffect(() => {
    if (held || reduced) return;
    const t = setTimeout(() => goTo((active + 1) % count), SLIDE_MS);
    return () => clearTimeout(t);
  }, [active, held, reduced, goTo, count]);

  return (
    <section
      aria-roledescription="carousel"
      aria-label="What is priority?"
      title={current.line}
      className={cn('flex items-center gap-3 rounded-2xl border bg-card py-2 pl-2.5 pr-3 shadow-[var(--shadow-card)]', className)}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onTouchStart={() => setHeld(true)}
      onTouchEnd={() => setHeld(false)}
    >
      <span key={active} className={cn('flex size-9 shrink-0 animate-[icon-pop_0.45s_cubic-bezier(0.34,1.56,0.64,1)_both] items-center justify-center rounded-xl bg-gradient-to-br text-white', current.tint)}>
        <current.icon className="size-[18px]" aria-hidden />
      </span>

      <div ref={track} className="flex min-w-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {PRIORITY_POINTS.map((p, i) => (
          <div key={p.title} role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${count}`} className="relative w-full min-w-0 shrink-0 snap-center">
            <p className="text-[11px] font-medium leading-tight text-muted-foreground">
              What is priority? · <span className="text-brand">{i + 1}/{count}</span>
            </p>
            <p className="truncate text-[14px] font-semibold leading-snug">{p.title}</p>
            <p className="sr-only">{p.line}</p>
          </div>
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-1" role="tablist" aria-label="Priority points">
        {PRIORITY_POINTS.map((p, i) => (
          <button
            key={p.title}
            type="button"
            role="tab"
            aria-selected={i === active}
            aria-label={`Show priority ${i + 1}: ${p.title}`}
            onClick={() => goTo(i)}
            className="flex h-6 cursor-pointer items-center justify-center px-px"
          >
            <span className={cn('block h-1.5 rounded-full transition-all duration-300 ease-out', i === active ? 'w-4 bg-brand' : 'w-1.5 bg-muted-foreground/25')} />
          </button>
        ))}
      </div>
    </section>
  );
}
