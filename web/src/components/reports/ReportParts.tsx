import type { ReviewDoc, TaskEntry } from '@rgk/core';
import { CalendarClock, CheckCircle2, Eye, FolderKanban, History, MessageSquare, MoreHorizontal, RotateCcw, ShieldCheck, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useState } from 'react';
import { Link } from 'react-router';
import { PriorityBadge, StatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/form';
import { Menu, Progress } from '@/components/ui/misc';
import { TaskUpdateHistory } from './TaskStatusUpdater';
import { useOp, useOpMutation } from '@/lib/api';
import { cn, fmtDate, fmtDateTime, fmtTime } from '@/lib/utils';

export function TaskCardView({
  task,
  people,
  projects,
  today,
}: {
  task: TaskEntry;
  people: Record<string, { fullName: string; employeeCode: string }>;
  projects: Record<string, { name: string; code: string }>;
  today: string;
}) {
  const overdue = task.status !== 'COMPLETED' && task.dueDate !== null && task.dueDate < today;
  return (
    <article className="rounded-[var(--radius-card)] border bg-card p-4 shadow-[var(--shadow-card)] sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold tracking-wide text-brand">
            TASK {task.slot} <span className="font-medium text-muted-foreground">· {task.isPrimary ? 'Priority' : 'Additional'}</span>
          </p>
          <h3 className="mt-0.5 font-semibold">{task.title}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={task.status} />
          {overdue && <StatusBadge status="OVERDUE" />}
        </div>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{task.description}</p>
      <div className="mt-3">
        <Progress value={task.progressPercentage} label={`Progress of ${task.title}`} />
        <p className="mt-1 text-xs text-muted-foreground">{task.progressPercentage}% complete</p>
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Priority</dt>
          <dd>
            <PriorityBadge priority={task.priority} />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Planned time</dt>
          <dd>{task.plannedStartTime ? `${fmtTime(task.plannedStartTime)} – ${fmtTime(task.plannedEndTime)}${task.overnight ? ' (overnight)' : ''}` : 'Not set'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Actual time</dt>
          <dd>{task.actualStartTime ? `${fmtTime(task.actualStartTime)} – ${fmtTime(task.actualEndTime)}` : 'Not recorded'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Project</dt>
          <dd className="flex items-center gap-1">
            <FolderKanban className="size-3 text-muted-foreground" aria-hidden />
            {task.projectId ? (projects[task.projectId]?.name ?? 'Unknown project') : 'No project'}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Category</dt>
          <dd>{task.category ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Due date</dt>
          <dd className={cn(overdue && 'font-medium text-danger')}>{task.dueDate ? fmtDate(task.dueDate) : '—'}</dd>
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <dt className="text-muted-foreground">Collaborators</dt>
          <dd className="flex flex-wrap items-center gap-1">
            <Users className="size-3 text-muted-foreground" aria-hidden />
            {task.collaboratorIds.length ? task.collaboratorIds.map((id) => people[id]?.fullName ?? 'Unknown').join(', ') : 'None'}
          </dd>
        </div>
        {task.notes && (
          <div className="sm:col-span-2 lg:col-span-3">
            <dt className="text-muted-foreground">Notes</dt>
            <dd className="whitespace-pre-wrap">{task.notes}</dd>
          </div>
        )}
      </dl>
      {task.updates?.length ? <TaskUpdateHistory updates={task.updates} className="mt-4 border-t pt-3" /> : null}
    </article>
  );
}

const ACTION_META: Record<string, { label: string; icon: typeof Eye; tone: string }> = {
  VIEWED: { label: 'Viewed', icon: Eye, tone: 'text-muted-foreground' },
  REVIEWED: { label: 'Marked reviewed', icon: ShieldCheck, tone: 'text-warning' },
  COMMENTED: { label: 'Commented', icon: MessageSquare, tone: 'text-info' },
  APPROVED: { label: 'Approved', icon: CheckCircle2, tone: 'text-success' },
  RETURNED: { label: 'Asked for changes', icon: RotateCcw, tone: 'text-danger' },
};

export function ReviewTimeline({ reviews, submittedAt, version, bare }: { reviews: ReviewDoc[]; submittedAt: string | null; version: number; bare?: boolean }) {
  const list = (
        <ol className="space-y-4">
          {submittedAt && (
            <li className="flex gap-3">
              <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="text-sm">
                <p>
                  <span className="font-medium">Submitted</span> <span className="text-muted-foreground">· current version {version}</span>
                </p>
                <p className="text-xs text-muted-foreground">{fmtDateTime(submittedAt)}</p>
              </div>
            </li>
          )}
          {reviews.map((r) => {
            const m = ACTION_META[r.action] ?? ACTION_META.COMMENTED!;
            return (
              <li key={r.id} className="flex gap-3">
                <m.icon className={cn('mt-0.5 size-4 shrink-0', m.tone)} aria-hidden />
                <div className="min-w-0 text-sm">
                  <p>
                    <span className="font-medium">{m.label}</span> by {r.reviewerName} <span className="text-muted-foreground">· v{r.reportVersion}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{fmtDateTime(r.createdAt)}</p>
                  {r.comment && <p className="mt-1 whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-sm">{r.comment}</p>}
                </div>
              </li>
            );
          })}
          {!reviews.length && !submittedAt && <p className="text-sm text-muted-foreground">Not submitted yet.</p>}
          {!reviews.length && submittedAt && <p className="text-sm text-muted-foreground">No review activity yet.</p>}
        </ol>
  );
  if (bare) return list;
  return (
    <Card>
      <CardHeader title="Review history" />
      <CardBody>{list}</CardBody>
    </Card>
  );
}

type VersionMeta = { id: string; version: number; source: string; actorName: string; reason: string; createdAt: string };

/** Version history; each version's full submitted content can be opened and compared. */
export function VersionHistory({ type, reportId, versions }: { type: 'DAILY' | 'WEEKLY'; reportId: string; versions: VersionMeta[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <Card>
      <CardHeader title="Version history" />
      <CardBody className="space-y-2">
        {!versions.length && <p className="text-sm text-muted-foreground">No submitted versions yet.</p>}
        {[...versions].reverse().map((v) => (
          <div key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
            <div className="min-w-0">
              <p className="font-medium">
                Version {v.version}{' '}
                <span className={cn('ml-1 rounded px-1.5 py-0.5 text-[11px] font-medium', v.source === 'ADMIN_CORRECTION' ? 'bg-warning-soft text-warning' : 'bg-muted text-muted-foreground')}>
                  {v.source === 'ADMIN_CORRECTION' ? 'Administrator correction' : 'Employee submission'}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                {v.actorName} · {fmtDateTime(v.createdAt)}
                {v.reason && ` · ${v.reason}`}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setOpen(v.version)}>
              <History /> View
            </Button>
          </div>
        ))}
      </CardBody>
      {open !== null && <VersionDialog type={type} reportId={reportId} version={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function VersionDialog({ type, reportId, version, onClose }: { type: 'DAILY' | 'WEEKLY'; reportId: string; version: number; onClose: () => void }) {
  const daily = useOp('daily.version', { reportId, version }, { enabled: type === 'DAILY' });
  const weekly = useOp('weekly.version', { reportId, version }, { enabled: type === 'WEEKLY' });
  const v = type === 'DAILY' ? daily.data : weekly.data;
  const snap = v?.snapshot as Record<string, unknown> | undefined;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Version ${version}`} description={v ? `${v.source === 'ADMIN_CORRECTION' ? 'Administrator correction' : 'Employee submission'} by ${v.actorName}, ${fmtDateTime(v.createdAt)}` : 'Loading…'} wide>
      {snap && type === 'DAILY' && (
        <div className="space-y-3 text-sm">
          <p>
            <span className="text-muted-foreground">Work date:</span> {fmtDate(snap.workDate as string)}
          </p>
          {(snap.tasks as TaskEntry[]).map((t) => (
            <div key={t.slot} className="rounded-md border p-3">
              <p className="font-medium">
                {t.slot}. {t.title} <StatusBadge status={t.status} className="ml-1" />
              </p>
              <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{t.description}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t.progressPercentage}% · planned {fmtTime(t.plannedStartTime)}–{fmtTime(t.plannedEndTime)} · actual {fmtTime(t.actualStartTime)}–{fmtTime(t.actualEndTime)}
              </p>
            </div>
          ))}
          {snap.employeeNotes ? <p className="whitespace-pre-wrap">Notes: {snap.employeeNotes as string}</p> : null}
        </div>
      )}
      {snap && type === 'WEEKLY' && (
        <div className="space-y-3 text-sm">
          {Object.entries(snap.narrative as Record<string, string>).map(([k, val]) =>
            val ? (
              <div key={k}>
                <p className="text-xs font-medium text-muted-foreground">{k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}</p>
                <p className="whitespace-pre-wrap">{val}</p>
              </div>
            ) : null,
          )}
        </div>
      )}
    </Dialog>
  );
}

/** Reviewer actions: Approve or Request changes (comment required). Version-safe. */
export function ReviewPanel({ type, reportId, version, reviewStatus, onDone }: { type: 'DAILY' | 'WEEKLY'; reportId: string; version: number; reviewStatus: string; onDone?: () => void }) {
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const invalidate = ['daily.get', 'weekly.get', 'review.pending', 'manager.dashboard', 'daily.list', 'weekly.list'] as const;
  const act = useOpMutation('review.act', { invalidate: [...invalidate], silent: true });
  const decided = reviewStatus === 'APPROVED' || reviewStatus === 'RETURNED';

  const run = (action: 'APPROVED' | 'RETURNED' | 'REVIEWED' | 'COMMENTED') => {
    setError(null);
    if ((action === 'RETURNED' || action === 'COMMENTED') && comment.trim().length < 3) {
      setError(action === 'RETURNED' ? 'Tell the employee what to change.' : 'Write a comment first.');
      return;
    }
    act.mutate(
      { reportType: type, reportId, action, comment, reportVersion: version },
      {
        onSuccess: () => {
          setComment('');
          toast.success(action === 'APPROVED' ? 'Approved' : action === 'RETURNED' ? 'Sent back for changes' : action === 'REVIEWED' ? 'Marked as reviewed' : 'Comment added');
          onDone?.();
        },
        onError: (e) => setError(e.message),
      },
    );
  };

  return (
    <div className="no-print sticky bottom-[calc(76px+env(safe-area-inset-bottom))] z-20 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur-md sm:mx-0 sm:rounded-2xl sm:border lg:bottom-4">
      {error && <p className="mb-2 text-[13px] font-medium text-danger" role="alert">{error}</p>}
      {decided && <p className="mb-2 text-[13px] text-muted-foreground">This version is {reviewStatus === 'APPROVED' ? 'approved' : 'waiting for changes'}. You can still add a comment.</p>}
      <Textarea aria-label="Comment" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder={decided ? 'Add a comment' : 'Comment (required for changes)'} className="min-h-[52px]" />
      <div className="mt-2 flex gap-2">
        {!decided ? (
          <>
            <Button variant="outline" className="flex-1 text-danger" onClick={() => run('RETURNED')} loading={act.isPending && act.variables?.action === 'RETURNED'}>
              <RotateCcw /> Request changes
            </Button>
            <Button variant="success" className="flex-1" onClick={() => run('APPROVED')} loading={act.isPending && act.variables?.action === 'APPROVED'}>
              <CheckCircle2 /> Approve
            </Button>
            <Menu
              trigger={
                <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="More review actions">
                  <MoreHorizontal />
                </Button>
              }
              items={[
                ...(reviewStatus !== 'REVIEWED' ? [{ label: <><ShieldCheck /> Mark as reviewed</>, onSelect: () => run('REVIEWED') }] : []),
                { label: <><MessageSquare /> Comment only</>, onSelect: () => run('COMMENTED') },
              ]}
            />
          </>
        ) : (
          <Button variant="outline" className="flex-1" onClick={() => run('COMMENTED')} loading={act.isPending}>
            <MessageSquare /> Add comment
          </Button>
        )}
      </div>
    </div>
  );
}

export function EmployeeLink({ id, name, code, base = '/employees' }: { id: string; name: string; code?: string; base?: string }) {
  return (
    <Link to={`${base}/${id}`} className="font-medium hover:text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
      {name}
      {code && <span className="ml-1 text-xs font-normal text-muted-foreground">{code}</span>}
    </Link>
  );
}
