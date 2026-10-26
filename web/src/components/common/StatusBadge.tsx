import {
  Ban,
  CalendarOff,
  CheckCircle2,
  CircleDashed,
  Clock,
  Eye,
  FileEdit,
  Hourglass,
  Loader,
  type LucideIcon,
  MinusCircle,
  RotateCcw,
  ShieldCheck,
  TimerOff,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Tone = 'red' | 'orange' | 'blue' | 'green' | 'grey';

const toneClass: Record<Tone, string> = {
  red: 'bg-danger-soft text-danger',
  orange: 'bg-warning-soft text-warning',
  blue: 'bg-info-soft text-info',
  green: 'bg-success-soft text-success',
  grey: 'bg-neutral-soft text-neutral',
};

/**
 * Every status has a text label and an icon, so meaning never depends on colour alone.
 * Colours follow the company convention: red = missing/overdue/returned, orange = awaiting review,
 * blue = in progress, green = approved/completed, grey = draft/not applicable.
 */
const STATUS: Record<string, { label: string; tone: Tone; icon: LucideIcon }> = {
  // Review status
  NOT_SUBMITTED: { label: 'Not submitted', tone: 'grey', icon: CircleDashed },
  DRAFT: { label: 'Draft', tone: 'grey', icon: FileEdit },
  PENDING_REVIEW: { label: 'Waiting for review', tone: 'orange', icon: Hourglass },
  VIEWED: { label: 'Viewed', tone: 'orange', icon: Eye },
  REVIEWED: { label: 'Reviewed', tone: 'orange', icon: ShieldCheck },
  APPROVED: { label: 'Approved', tone: 'green', icon: CheckCircle2 },
  RETURNED: { label: 'Needs changes', tone: 'red', icon: RotateCcw },
  // Task status
  PLANNED: { label: 'Planned', tone: 'grey', icon: CircleDashed },
  IN_PROGRESS: { label: 'In progress', tone: 'blue', icon: Loader },
  COMPLETED: { label: 'Completed', tone: 'green', icon: CheckCircle2 },
  BLOCKED: { label: 'Blocked', tone: 'red', icon: Ban },
  OVERDUE: { label: 'Overdue', tone: 'red', icon: TimerOff },
  // Day compliance
  MISSING: { label: 'Missing', tone: 'red', icon: XCircle },
  HOLIDAY: { label: 'Holiday', tone: 'grey', icon: CalendarOff },
  HOLIDAY_WORK: { label: 'Holiday work', tone: 'blue', icon: CalendarOff },
  NOT_DUE: { label: 'Not yet due', tone: 'grey', icon: Clock },
  NOT_EXPECTED: { label: 'Not expected', tone: 'grey', icon: MinusCircle },
  SUBMITTED_ON_TIME: { label: 'On time', tone: 'green', icon: CheckCircle2 },
  SUBMITTED_LATE: { label: 'Late', tone: 'orange', icon: Clock },
  // Account / project
  ACTIVE: { label: 'Active', tone: 'green', icon: CheckCircle2 },
  PENDING_ACTIVATION: { label: 'Pending activation', tone: 'orange', icon: Hourglass },
  DEACTIVATED: { label: 'Deactivated', tone: 'red', icon: Ban },
  ARCHIVED: { label: 'Archived', tone: 'grey', icon: MinusCircle },
  PROPOSED: { label: 'Waiting for approval', tone: 'orange', icon: Hourglass },
  ON_HOLD: { label: 'On hold', tone: 'grey', icon: Clock },
  CANCELLED: { label: 'Cancelled', tone: 'grey', icon: XCircle },
  PENDING: { label: 'Pending', tone: 'orange', icon: Hourglass },
  REJECTED: { label: 'Rejected', tone: 'red', icon: XCircle },
  // Priority
  HIGH: { label: 'High', tone: 'red', icon: CircleDashed },
  MEDIUM: { label: 'Medium', tone: 'orange', icon: CircleDashed },
  LOW: { label: 'Low', tone: 'grey', icon: CircleDashed },
};

export function statusLabel(status: string): string {
  return STATUS[status]?.label ?? status.replace(/_/g, ' ').toLowerCase();
}

export function StatusBadge({ status, className, label }: { status: string; className?: string; label?: string }) {
  const s = STATUS[status] ?? { label: statusLabel(status), tone: 'grey' as Tone, icon: CircleDashed };
  const Icon = s.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-medium leading-none', toneClass[s.tone], className)}>
      <Icon className="size-3.5" aria-hidden />
      {label ?? s.label}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  const tone = priority === 'HIGH' ? 'text-danger' : priority === 'MEDIUM' ? 'text-warning' : 'text-muted-foreground';
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', tone)}>
      <span className="inline-block size-1.5 rounded-full bg-current" aria-hidden />
      {statusLabel(priority)} priority
    </span>
  );
}
