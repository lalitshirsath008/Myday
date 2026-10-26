import { Table2, BarChart3 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/misc';

/**
 * Chart conventions (dataviz method): one y-axis, at most three categorical series in fixed
 * slot order, 2px lines, recessive grid, hover tooltip, a legend for ≥2 series, and a table
 * view so no value depends on colour alone.
 */
export interface Series {
  key: string;
  label: string;
}

const SLOT = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)'];
const axis = { stroke: 'var(--chart-axis)', fontSize: 11, tickLine: false, axisLine: { stroke: 'var(--chart-grid)' } };

function TooltipBox({ active, payload, label, labelFormat, valueFormat }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; labelFormat?: (l: string) => string; valueFormat?: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-card px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold">{labelFormat ? labelFormat(String(label)) : label}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 text-muted-foreground">
          <span className="inline-block size-2 rounded-full" style={{ background: p.color }} aria-hidden />
          <span>{p.name}</span>
          <span className="ml-auto font-semibold tabular-nums text-foreground">{valueFormat ? valueFormat(p.value) : p.value}</span>
        </p>
      ))}
    </div>
  );
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 px-4 pt-3 text-xs text-muted-foreground sm:px-5">
      {series.map((s, i) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: SLOT[i] }} aria-hidden />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

function DataTableView<T extends Record<string, unknown>>({ data, xKey, xLabel, series, labelFormat, valueFormat }: { data: T[]; xKey: string; xLabel: string; series: Series[]; labelFormat?: (l: string) => string; valueFormat?: (v: number) => string }) {
  return (
    <div className="max-h-72 overflow-auto px-4 pb-4 sm:px-5">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 pr-3 font-medium">{xLabel}</th>
            {series.map((s) => (
              <th key={s.key} className="py-2 pr-3 text-right font-medium">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((d, i) => (
            <tr key={i} className="border-b last:border-0">
              <td className="py-1.5 pr-3">{labelFormat ? labelFormat(String(d[xKey])) : String(d[xKey])}</td>
              {series.map((s) => (
                <td key={s.key} className="py-1.5 pr-3 text-right tabular-nums">
                  {d[s.key] === null || d[s.key] === undefined ? '—' : valueFormat ? valueFormat(Number(d[s.key])) : String(d[s.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChartCard({ title, description, tableView, chart, empty, actions }: { title: string; description?: ReactNode; tableView: ReactNode; chart: ReactNode; empty: boolean; actions?: ReactNode }) {
  const [table, setTable] = useState(false);
  return (
    <Card>
      <CardHeader
        title={title}
        description={description}
        actions={
          <>
            {actions}
            {!empty && (
              <Button variant="ghost" size="sm" onClick={() => setTable((t) => !t)} aria-pressed={table}>
                {table ? <BarChart3 /> : <Table2 />} {table ? 'Chart' : 'Table'}
              </Button>
            )}
          </>
        }
      />
      {empty ? <EmptyState title="No data for this period" /> : table ? <div className="pt-3">{tableView}</div> : chart}
    </Card>
  );
}

export function TrendChart<T extends Record<string, unknown>>({
  title,
  description,
  data,
  xKey,
  xLabel = 'Date',
  series,
  labelFormat,
  valueFormat,
  yMax,
  height = 240,
  actions,
}: {
  title: string;
  description?: ReactNode;
  data: T[];
  xKey: string;
  xLabel?: string;
  series: Series[];
  labelFormat?: (l: string) => string;
  valueFormat?: (v: number) => string;
  yMax?: number;
  height?: number;
  actions?: ReactNode;
}) {
  const s = series.slice(0, 3);
  const empty = data.length === 0 || data.every((d) => s.every((x) => !d[x.key]));
  return (
    <ChartCard
      title={title}
      description={description}
      actions={actions}
      empty={empty}
      tableView={<DataTableView data={data} xKey={xKey} xLabel={xLabel} series={s} labelFormat={labelFormat} valueFormat={valueFormat} />}
      chart={
        <>
          <Legend series={s} />
          <div className="px-2 pb-3 pt-2" style={{ height }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey={xKey} {...axis} tickFormatter={labelFormat} minTickGap={24} />
                <YAxis {...axis} allowDecimals={false} domain={[0, yMax ?? 'auto']} tickFormatter={valueFormat} width={44} />
                <Tooltip cursor={{ stroke: 'var(--chart-axis)', strokeDasharray: '3 3' }} content={<TooltipBox labelFormat={labelFormat} valueFormat={valueFormat} />} />
                {s.map((x, i) => (
                  <Line key={x.key} type="monotone" dataKey={x.key} name={x.label} stroke={SLOT[i]} strokeWidth={2} dot={data.length <= 31 ? { r: 3, strokeWidth: 2, fill: 'var(--card)' } : false} activeDot={{ r: 5, stroke: 'var(--card)', strokeWidth: 2 }} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      }
    />
  );
}

/** Horizontal bars for comparing one measure across categories (departments, projects, statuses). */
export function BarList<T extends Record<string, unknown>>({
  title,
  description,
  data,
  labelKey,
  series,
  valueFormat,
  max,
  actions,
}: {
  title: string;
  description?: ReactNode;
  data: T[];
  labelKey: string;
  series: Series[];
  valueFormat?: (v: number) => string;
  max?: number;
  actions?: ReactNode;
}) {
  const s = series.slice(0, 3);
  const height = Math.max(160, data.length * (s.length > 1 ? 44 : 32) + 40);
  return (
    <ChartCard
      title={title}
      description={description}
      actions={actions}
      empty={data.length === 0}
      tableView={<DataTableView data={data} xKey={labelKey} xLabel="Name" series={s} valueFormat={valueFormat} />}
      chart={
        <>
          <Legend series={s} />
          <div className="px-2 pb-3 pt-2" style={{ height }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 8 }} barGap={2} barCategoryGap="22%">
                <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
                <XAxis type="number" {...axis} domain={[0, max ?? 'auto']} allowDecimals={false} tickFormatter={valueFormat} />
                <YAxis type="category" dataKey={labelKey} {...axis} width={140} tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }} tickFormatter={(v: string) => (v.length > 20 ? `${v.slice(0, 19)}…` : v)} />
                <Tooltip cursor={{ fill: 'var(--muted)', opacity: 0.6 }} content={<TooltipBox valueFormat={valueFormat} />} />
                {s.map((x, i) => (
                  <Bar key={x.key} dataKey={x.key} name={x.label} fill={SLOT[i]} radius={[0, 4, 4, 0]} stroke="var(--card)" strokeWidth={1} maxBarSize={18} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      }
    />
  );
}

/** Single labelled meter (e.g. compliance %). Status colour always comes with a text value. */
export function Meter({ value, label, goodAt = 90, warnAt = 70 }: { value: number | null; label: string; goodAt?: number; warnAt?: number }) {
  const v = value ?? 0;
  const color = value === null ? 'var(--muted-foreground)' : v >= goodAt ? 'var(--success)' : v >= warnAt ? 'var(--warning)' : 'var(--danger)';
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">{value === null ? 'n/a' : `${v}%`}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="meter" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="h-full rounded-full" style={{ width: `${v}%`, background: color }} />
      </div>
    </div>
  );
}
