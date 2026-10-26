import { addDays, monthBounds, weekStartFor } from '@rgk/core';
import { SlidersHorizontal } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form';
import { Segmented, Sheet } from '@/components/ui/misc';
import { useOp } from '@/lib/api';
import { cn } from '@/lib/utils';

export type RangePreset = 'last7' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth' | 'last30' | 'custom';

export function rangeFor(preset: RangePreset, today: string, weekStartDay = 1): { from: string; to: string } {
  const ws = weekStartFor(today, weekStartDay);
  switch (preset) {
    case 'last7':
      return { from: addDays(today, -6), to: today };
    case 'thisWeek':
      return { from: ws, to: today };
    case 'lastWeek':
      return { from: addDays(ws, -7), to: addDays(ws, -1) };
    case 'thisMonth':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'lastMonth': {
      const prev = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
      return monthBounds(prev);
    }
    case 'last30':
    default:
      return { from: addDays(today, -29), to: today };
  }
}

const LABELS: Record<RangePreset, string> = {
  last7: '7 days',
  thisWeek: 'This week',
  lastWeek: 'Last week',
  thisMonth: 'This month',
  lastMonth: 'Last month',
  last30: '30 days',
  custom: 'Custom',
};
const DEFAULT_PRESETS: RangePreset[] = ['thisWeek', 'lastWeek', 'thisMonth', 'lastMonth', 'custom'];

/** Date-range chips with an optional custom range. */
export function DateRangeFilter({
  preset,
  from,
  to,
  today,
  onChange,
  maxDays = 92,
  presets = DEFAULT_PRESETS,
}: {
  preset: RangePreset;
  from: string;
  to: string;
  today: string;
  onChange: (v: { preset: RangePreset; from: string; to: string }) => void;
  maxDays?: number;
  presets?: RangePreset[];
}) {
  const list = presets.includes(preset) ? presets : [preset, ...presets];
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Segmented
        label="Period"
        value={preset}
        onChange={(p) => onChange(p === 'custom' ? { preset: p, from, to } : { preset: p, ...rangeFor(p, today) })}
        options={list.map((p) => ({ value: p, label: LABELS[p] }))}
      />
      {preset === 'custom' && (
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" aria-label="From" value={from} max={to} min={addDays(to, -(maxDays - 1))} onChange={(e) => e.target.value && onChange({ preset, from: e.target.value, to })} className="h-10 w-auto" />
          <span className="text-muted-foreground" aria-hidden>
            –
          </span>
          <Input type="date" aria-label="To" value={to} min={from} max={today} onChange={(e) => e.target.value && onChange({ preset, from, to: e.target.value })} className="h-10 w-auto" />
        </div>
      )}
    </div>
  );
}

export function FilterBar({ children, onReset, className }: { children: ReactNode; onReset?: () => void; className?: string }) {
  return (
    <div className={cn('no-print mb-4 flex flex-wrap items-end gap-3', className)}>
      {children}
      {onReset && (
        <Button variant="ghost" size="sm" onClick={onReset} className="ml-auto text-muted-foreground">
          Reset
        </Button>
      )}
    </div>
  );
}

export function FilterSelect({ label, value, onChange, options, allLabel = 'All', className }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; allLabel?: string; className?: string }) {
  return (
    <label className={cn('flex flex-col gap-1 text-[12px] font-medium text-muted-foreground', className)}>
      {label}
      <Select value={value} onChange={(e) => onChange(e.target.value)} className="h-10 min-w-36 text-sm">
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </label>
  );
}

/** "Filters" button that opens a bottom sheet with secondary filters. */
export function FilterSheetButton({ children, activeCount, onReset }: { children: ReactNode; activeCount: number; onReset?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="rounded-full">
        <SlidersHorizontal /> Filters{activeCount ? ` · ${activeCount}` : ''}
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Filters"
        footer={
          <>
            {onReset && (
              <Button variant="ghost" onClick={onReset}>
                Reset
              </Button>
            )}
            <Button className="flex-1" onClick={() => setOpen(false)}>
              Show results
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4 [&_label]:w-full [&_select]:w-full">{children}</div>
      </Sheet>
    </>
  );
}

export function useDepartments() {
  const q = useOp('lookup.departments', {}, { staleTime: 10 * 60_000 });
  const items = q.data?.items ?? [];
  return { ...q, items, name: (id: string | null | undefined) => items.find((d) => d.id === id)?.name ?? '—' };
}

export function useProjects(includeAll = false) {
  const q = useOp('lookup.projects', { includeAll }, { staleTime: 5 * 60_000 });
  const items = q.data?.items ?? [];
  return { ...q, items, name: (id: string | null | undefined) => (id ? (items.find((p) => p.id === id)?.name ?? 'Unknown project') : 'No project') };
}
