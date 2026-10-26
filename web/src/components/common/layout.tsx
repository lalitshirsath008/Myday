import type { LucideIcon } from 'lucide-react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back && (
          <Link to={back.to} className="no-print mb-1.5 inline-flex items-center gap-0.5 text-[13px] font-medium text-muted-foreground hover:text-foreground">
            <ChevronLeft className="size-4" aria-hidden /> {back.label}
          </Link>
        )}
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const TONES = {
  default: 'bg-brand-soft text-brand',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
};

/** Compact summary tile (SummaryCard). */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default',
  to,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: keyof typeof TONES;
  to?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-medium text-muted-foreground">{label}</p>
        {Icon && (
          <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg', TONES[tone])}>
            <Icon className="size-3.5" aria-hidden />
          </span>
        )}
      </div>
      <p className="mt-1.5 text-[22px] font-semibold leading-none tracking-tight">{value}</p>
      {hint && <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground">{hint}</p>}
    </>
  );
  const cls = 'block rounded-2xl border bg-card p-3.5 shadow-[var(--shadow-card)]';
  return to ? (
    <Link to={to} className={cn(cls, 'tap hover:border-brand/40')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
export const SummaryCard = StatCard;

export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-2 gap-3 md:grid-cols-4', className)}>{children}</div>;
}

export function DefinitionList({ items, className }: { items: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2', className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-[12px] text-muted-foreground">{k}</dt>
          <dd className="mt-0.5 break-words text-sm">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Tappable list row used for reports, employees, projects, notifications. */
export function ListCard({ to, onClick, children, className }: { to?: string; onClick?: () => void; children: ReactNode; className?: string }) {
  const cls = cn('tap flex w-full items-center gap-3 rounded-2xl border bg-card p-4 text-left shadow-[var(--shadow-card)] hover:border-brand/40', className);
  const inner = (
    <>
      <div className="min-w-0 flex-1">{children}</div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </>
  );
  if (to) {
    return (
      <Link to={to} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cn(cls, 'cursor-pointer')}>
      {inner}
    </button>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2.5 mt-1 flex items-center justify-between gap-2">
      <h2 className="text-[15px] font-semibold">{children}</h2>
      {action}
    </div>
  );
}
