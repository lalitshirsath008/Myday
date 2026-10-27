import type { TaskEntry, TaskStatus, TaskStatusUpdate } from '@rgk/core';
import { History } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/misc';
import { useOpMutation } from '@/lib/api';
import { cn, fmtDateTime } from '@/lib/utils';

const LABEL: Record<TaskStatus, string> = { PLANNED: 'Planned', IN_PROGRESS: 'In progress', COMPLETED: 'Done', BLOCKED: 'Blocked' };
const ORDER: TaskStatus[] = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED'];
const PROMPT: Record<TaskStatus, string> = {
  PLANNED: 'Why is it back to planned?',
  IN_PROGRESS: 'What’s the latest?',
  COMPLETED: 'What was finished?',
  BLOCKED: 'What’s blocking it?',
};

/**
 * Change a submitted task's status (and progress) with a comment. The report stays submitted;
 * the manager is notified. `compact` is the small version used inside the My day panel.
 */
export function TaskStatusUpdater({ reportId, task, compact, onDone }: { reportId: string; task: TaskEntry; compact?: boolean; onDone?: () => void }) {
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [progress, setProgress] = useState(task.progressPercentage);
  const [comment, setComment] = useState('');
  const save = useOpMutation('daily.updateTaskStatus', { invalidate: ['daily.getForDate', 'daily.get', 'daily.list', 'me.dashboard', 'calendar.events'], success: 'Status updated' });
  const effectiveProgress = status === 'COMPLETED' ? 100 : progress;
  const changed = status !== task.status || effectiveProgress !== task.progressPercentage;
  const ready = changed && comment.trim().length >= 2;

  return (
    <form
      className={cn('space-y-3', !compact && 'rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]')}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        save.mutate(
          { reportId, slot: task.slot, status, progressPercentage: status === 'COMPLETED' ? null : progress, comment: comment.trim() },
          {
            onSuccess: () => {
              setComment('');
              onDone?.();
            },
          },
        );
      }}
    >
      {!compact && (
        <div>
          <p className="text-[14px] font-semibold">Update status</p>
          <p className="text-[12px] text-muted-foreground">Your report stays submitted. Your manager sees the change and your comment.</p>
        </div>
      )}
      <Segmented label={`New status for ${task.title}`} value={status} onChange={setStatus} options={ORDER.map((s) => ({ value: s, label: LABEL[s] }))} />
      {status !== 'COMPLETED' && (
        <label className="block">
          <span className="mb-1 flex justify-between text-[12px] text-muted-foreground">
            <span>Progress</span>
            <span className="font-semibold tabular-nums text-foreground">{progress}%</span>
          </span>
          <input type="range" min={0} max={100} step={5} value={progress} onChange={(e) => setProgress(Number(e.target.value))} className="w-full accent-[var(--color-primary)]" aria-label="Progress" />
        </label>
      )}
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        maxLength={500}
        rows={compact ? 2 : 3}
        placeholder={PROMPT[status]}
        aria-label="Comment (required)"
        className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-[14px] placeholder:text-muted-foreground focus-visible:border-brand focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/15"
      />
      {save.error && <p className="text-[12px] text-danger" role="alert">{save.error.message}</p>}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-muted-foreground">{!changed ? 'Pick a new status or progress' : comment.trim().length < 2 ? 'Add a comment to save' : `${LABEL[task.status]} → ${LABEL[status]}`}</span>
        <Button type="submit" size="sm" disabled={!ready} loading={save.isPending}>
          Save update
        </Button>
      </div>
      {!compact && task.updates?.length ? <TaskUpdateHistory updates={task.updates} /> : null}
    </form>
  );
}

/** Newest first: "27 Oct, 2:30 pm · In progress → Done (100%) — comment". */
export function TaskUpdateHistory({ updates, className }: { updates: TaskStatusUpdate[]; className?: string }) {
  return (
    <div className={className}>
      <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
        <History className="size-3.5" aria-hidden /> Status updates
      </p>
      <ol className="space-y-2 border-l-2 border-muted pl-3">
        {[...updates].reverse().map((u) => (
          <li key={u.at} className="text-[13px]">
            <span className="text-[11.5px] text-muted-foreground">{fmtDateTime(u.at)}</span>
            <span className="block font-medium">
              {LABEL[u.from]} → {LABEL[u.to]} <span className="font-normal text-muted-foreground">({u.progress}%)</span>
            </span>
            <span className="block text-foreground/80">“{u.comment}”</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
