import * as D from '@radix-ui/react-dialog';
import * as DM from '@radix-ui/react-dropdown-menu';
import * as P from '@radix-ui/react-popover';
import * as T from '@radix-ui/react-tabs';
import { AlertTriangle, ChevronDown, Inbox, Info, Lock, RefreshCw, X } from 'lucide-react';
import { useState, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('skeleton rounded-xl', className)} aria-hidden {...props} />;
}

export function PageSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-36 rounded-[var(--radius-card)]" />
      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-56 rounded-[var(--radius-card)]" />
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
      <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">{icon ?? <Inbox className="size-6" aria-hidden />}</div>
      <p className="text-[15px] font-semibold">{title}</p>
      {description && <p className="mt-1 max-w-xs text-[13px] text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: { message: string; code?: string } | null; onRetry?: () => void }) {
  const denied = error?.code === 'permission-denied';
  return (
    <div role="alert" className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed bg-card px-4 py-12 text-center">
      <div className={cn('mb-3 flex size-12 items-center justify-center rounded-2xl', denied ? 'bg-warning-soft text-warning' : 'bg-danger-soft text-danger')}>
        {denied ? <Lock className="size-6" aria-hidden /> : <AlertTriangle className="size-6" aria-hidden />}
      </div>
      <p className="text-[15px] font-semibold">{denied ? 'Access denied' : 'Could not load this page'}</p>
      <p className="mt-1 max-w-md text-[13px] text-muted-foreground">{error?.message ?? 'Unknown error'}</p>
      {onRetry && !denied && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          <RefreshCw /> Try again
        </Button>
      )}
    </div>
  );
}

/** Pill-style tabs. */
export function Tabs({ value, onValueChange, tabs, children }: { value: string; onValueChange: (v: string) => void; tabs: { value: string; label: ReactNode }[]; children: ReactNode }) {
  return (
    <T.Root value={value} onValueChange={onValueChange}>
      <T.List className="mb-4 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]" aria-label="Sections">
        {tabs.map((t) => (
          <T.Trigger
            key={t.value}
            value={t.value}
            className="tap shrink-0 cursor-pointer whitespace-nowrap rounded-full border bg-card px-3.5 py-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground data-[state=active]:border-transparent data-[state=active]:bg-foreground data-[state=active]:text-background"
          >
            {t.label}
          </T.Trigger>
        ))}
      </T.List>
      {children}
    </T.Root>
  );
}
export const TabPanel = T.Content;

/** Compact segmented control / quick-filter chips. */
export function Segmented<V extends string>({ value, onChange, options, label, className }: { value: V; onChange: (v: V) => void; options: { value: V; label: ReactNode; count?: number }[]; label: string; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]', className)}>
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
              'tap inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[13px] font-medium',
              active ? 'border-transparent bg-foreground text-background' : 'bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            {o.label}
            {o.count !== undefined && <span className={cn('rounded-full px-1.5 text-[11px] font-semibold', active ? 'bg-background/20' : 'bg-muted')}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Menu({ trigger, items, align = 'end' }: { trigger: ReactNode; items: ({ label: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean } | 'separator')[]; align?: 'start' | 'end' }) {
  return (
    <DM.Root>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content align={align} sideOffset={6} className="z-50 min-w-52 animate-fade-in rounded-2xl border bg-card p-1.5 shadow-[var(--shadow-raised)]">
          {items.map((item, i) =>
            item === 'separator' ? (
              <DM.Separator key={i} className="my-1 h-px bg-border" />
            ) : (
              <DM.Item
                key={i}
                disabled={item.disabled}
                onSelect={item.onSelect}
                className={cn(
                  'flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-sm outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-muted [&_svg]:size-4',
                  item.danger && 'text-danger',
                )}
              >
                {item.label}
              </DM.Item>
            ),
          )}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

export function Progress({ value, className, label }: { value: number; className?: string; label?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-muted', className)} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={label ?? 'Progress'}>
      <div className={cn('h-full rounded-full transition-[width] duration-500 ease-out', v === 100 ? 'bg-success' : 'bg-brand')} style={{ width: `${v}%` }} />
    </div>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const letters = name
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span className={cn('inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-accent-foreground', className)} aria-hidden>
      {letters}
    </span>
  );
}

export function Notice({ tone = 'info', title, children, className }: { tone?: 'info' | 'warning' | 'danger' | 'success'; title?: ReactNode; children?: ReactNode; className?: string }) {
  const tones = {
    info: 'bg-info-soft text-info',
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger',
    success: 'bg-success-soft text-success',
  };
  return (
    <div className={cn('rounded-2xl px-4 py-3 text-[13px]', tones[tone], className)} role={tone === 'danger' ? 'alert' : 'status'}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cn(title && 'mt-0.5', 'text-foreground/80')}>{children}</div>}
    </div>
  );
}

/** Small (i) button that reveals an optional explanation instead of a paragraph on the page. */
export function InfoTip({ children, label = 'More information' }: { children: ReactNode; label?: string }) {
  return (
    <P.Root>
      <P.Trigger asChild>
        <button type="button" className="inline-flex size-6 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={label}>
          <Info className="size-4" />
        </button>
      </P.Trigger>
      <P.Portal>
        <P.Content sideOffset={6} collisionPadding={12} className="z-50 max-w-xs animate-fade-in rounded-2xl border bg-card p-3.5 text-[13px] leading-relaxed text-foreground/85 shadow-[var(--shadow-raised)]">
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}

/** Expandable section for progressive disclosure. */
export function Disclosure({ title, children, defaultOpen = false, className, badge }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; className?: string; badge?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cn('rounded-2xl border bg-card', className)}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full cursor-pointer items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium">
        <span className="flex items-center gap-2">
          {title}
          {badge}
        </span>
        <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && <div className="animate-fade-up border-t px-4 py-4">{children}</div>}
    </div>
  );
}

/** Bottom sheet on mobile, centered panel on larger screens. */
export function Sheet({ open, onOpenChange, title, children, footer }: { open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 animate-fade-in bg-black/40" />
        <D.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] animate-sheet-up flex-col rounded-t-[28px] bg-card shadow-[var(--shadow-raised)] focus:outline-none sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:animate-fade-up sm:rounded-[24px]">
          <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-muted sm:hidden" aria-hidden />
          <div className="flex items-center justify-between px-5 pb-2 pt-3">
            <D.Title className="text-base font-semibold">{title}</D.Title>
            <D.Description className="sr-only">{typeof title === 'string' ? title : 'Panel'}</D.Description>
            <D.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X />
              </Button>
            </D.Close>
          </div>
          <div className="overflow-y-auto px-5 pb-4">{children}</div>
          {footer && <div className="pb-safe flex gap-2 border-t px-5 py-3">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
