import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Pill switch with a sliding white thumb on an orange track (iOS / food-delivery app style).
 * Use for 2–4 short, mutually exclusive options.
 */
export function PillSwitch<V extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: V;
  onChange: (v: V) => void;
  options: { value: V; label: ReactNode; badge?: number }[];
  label: string;
  className?: string;
}) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('relative grid rounded-full bg-primary p-1 shadow-[inset_0_1px_2px_rgba(0,0,0,0.15)]', className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden
        className="absolute inset-y-1 left-1 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.18)] transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none"
        style={{ width: `calc((100% - 0.5rem) / ${options.length})`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'relative z-10 inline-flex min-w-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70',
              active ? 'text-primary' : 'text-white/85 hover:text-white',
            )}
          >
            <span className="truncate">{o.label}</span>
            {!!o.badge && (
              <span className={cn('rounded-full px-1.5 text-[10px] font-bold tabular-nums leading-4', active ? 'bg-primary text-white' : 'bg-white/25 text-white')}>
                {o.badge > 99 ? '99+' : o.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
