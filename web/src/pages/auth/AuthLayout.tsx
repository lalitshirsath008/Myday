import { BadgeCheck, Cog, type LucideIcon, Truck, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const QUOTE_WORDS = ['Your', 'actions', 'speak', 'louder', 'than', 'words.'];
const HIGHLIGHT = 3;

const FLOATERS: { icon: LucideIcon; className: string; duration: string; delay: string }[] = [
  { icon: Truck, className: 'left-[6%] top-[22%] lg:left-[10%] lg:top-[18%]', duration: '7s', delay: '0s' },
  { icon: Cog, className: 'right-[7%] top-[16%] lg:right-[12%] lg:top-[24%]', duration: '8s', delay: '1.2s' },
  { icon: BadgeCheck, className: 'bottom-[18%] left-[10%] lg:bottom-[22%] lg:left-[14%]', duration: '6.5s', delay: '0.6s' },
  { icon: Wrench, className: 'bottom-[24%] right-[8%] lg:bottom-[16%] lg:right-[16%]', duration: '7.5s', delay: '1.8s' },
];

/** Bold orange hero with the company quote: words pop in, then the quote floats; a wave line draws itself. */
function AuthHero() {
  return (
    <section className="relative isolate overflow-hidden rounded-b-[36px] bg-gradient-to-br from-[#A33E05] via-[#C24E06] to-[#DB620B] px-6 pb-16 pt-[max(2rem,env(safe-area-inset-top))] text-white lg:flex lg:min-h-dvh lg:flex-col lg:rounded-none lg:px-14 lg:py-12">
      {/* Soft glow */}
      <div aria-hidden className="absolute -right-24 -top-24 -z-10 size-72 rounded-full bg-white/10 blur-3xl" />
      <div aria-hidden className="absolute -bottom-32 -left-20 -z-10 size-80 rounded-full bg-[#FFB36B]/25 blur-3xl" />

      {/* Flowing line that draws itself, then drifts */}
      <svg aria-hidden viewBox="0 0 1000 400" preserveAspectRatio="none" className="absolute inset-x-0 top-[38%] -z-10 h-[46%] w-full animate-[float_9s_ease-in-out_infinite] lg:top-[40%]">
        <path
          d="M0 330 C 120 280, 200 250, 330 240 S 560 260, 640 255 S 780 200, 850 120 S 950 30, 1000 25"
          fill="none"
          stroke="rgba(255,255,255,0.28)"
          strokeWidth="6"
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray="1"
          className="animate-[draw-line_2.4s_cubic-bezier(0.65,0,0.35,1)_0.3s_both]"
        />
      </svg>

      {/* Floating manufacturing icons */}
      {FLOATERS.map(({ icon: Icon, className, duration, delay }) => (
        <span
          key={className}
          aria-hidden
          className={cn('absolute -z-10 flex size-11 items-center justify-center rounded-2xl bg-white/12 ring-1 ring-white/20 backdrop-blur-sm lg:size-14', className)}
          style={{ animation: `float ${duration} ease-in-out ${delay} infinite` }}
        >
          <Icon className="size-5 text-white/85 lg:size-6" />
        </span>
      ))}

      {/* Brand */}
      <div className="flex items-center justify-center gap-2.5 lg:justify-start">
        <span className="flex size-10 items-center justify-center rounded-xl bg-white shadow-[0_6px_20px_rgba(0,0,0,0.15)]">
          <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
            <path d="M6 12.5l3.8 3.8L18 8" fill="none" stroke="#E8700F" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="leading-tight">
          <span className="block text-[16px] font-bold tracking-tight">RGK WorkTrack</span>
          <span className="block text-[11px] font-medium text-white/75">RGK Group of Industries</span>
        </span>
      </div>

      {/* Quote */}
      <div className="mx-auto mt-9 max-w-xl text-center lg:mx-0 lg:my-auto lg:text-left">
        <p className="animate-[float_6s_ease-in-out_1.2s_infinite] text-[34px] font-extrabold leading-[1.08] tracking-[-0.02em] sm:text-[42px] lg:text-[60px]">
          <span className="sr-only">Your actions speak louder than words.</span>
          <span aria-hidden>
            {QUOTE_WORDS.map((w, i) =>
              i === HIGHLIGHT ? (
                <span key={w}>
                  <span
                    className="mx-0.5 inline-block -rotate-3 animate-[word-in_0.6s_cubic-bezier(0.34,1.56,0.64,1)_both] rounded-2xl bg-white px-3 pb-1 text-[#C8530A] shadow-[0_10px_30px_rgba(0,0,0,0.18)]"
                    style={{ animationDelay: `${150 + i * 90}ms` }}
                  >
                    {w}
                  </span>{' '}
                </span>
              ) : (
                <span key={w} className="inline-block animate-[word-in_0.6s_cubic-bezier(0.2,0.8,0.2,1)_both]" style={{ animationDelay: `${150 + i * 90}ms` }}>
                  {w}
                  {i < QUOTE_WORDS.length - 1 ? ' ' : ''}
                </span>
              ),
            )}
          </span>
        </p>
        <p className="mt-4 animate-[word-in_0.6s_ease-out_0.9s_both] text-[15px] font-semibold text-white lg:text-[17px]">Plan · Report · Deliver — every working day.</p>
      </div>
      <p className="hidden text-[12px] text-white/60 lg:block">© {new Date().getFullYear()} RGK Group of Industries · Internal use only</p>
    </section>
  );
}

/** Sign-in family layout: hero + form card (stacked on phones, side by side on desktop). */
export function AuthLayout({ title, subtitle, children, wide }: { title: string; subtitle?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[1.1fr_1fr]">
      <AuthHero />
      <section className="pb-safe relative flex flex-col items-center px-4 pb-10 lg:justify-center lg:py-10">
        <div className={cn('-mt-10 w-full animate-[tile-in_0.6s_cubic-bezier(0.2,0.8,0.2,1)_0.25s_both] lg:mt-0', wide ? 'max-w-[480px]' : 'max-w-[400px]')}>
          <div className="rounded-[28px] border bg-card p-6 shadow-[var(--shadow-raised)] sm:p-7">
            <h1 className="text-[22px] font-bold tracking-tight">{title}</h1>
            {subtitle && <p className="mt-1 text-[13px] text-muted-foreground">{subtitle}</p>}
            <div className="mt-5">{children}</div>
          </div>
          <p className="mt-6 text-center text-[11px] text-muted-foreground lg:hidden">RGK Group of Industries · Internal use only</p>
        </div>
      </section>
    </div>
  );
}
