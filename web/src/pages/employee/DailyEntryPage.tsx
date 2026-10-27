import { addDays, PRIORITIES, TASK_STATUSES, taskInput, taskIssues, type DailyReportDoc, type TaskEntry, type TaskInput } from '@rgk/core';
import { Check, CheckCircle2, Clock, FolderPlus, Plus, Save, Send, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { useProjects } from '@/components/common/filters';
import { PeoplePicker, type PickedPerson } from '@/components/common/PeoplePicker';
import { ProjectRequestSheet } from '@/components/common/ProjectRequestSheet';
import { StatusBadge, statusLabel } from '@/components/common/StatusBadge';
import { ReviewTimeline } from '@/components/reports/ReportParts';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Disclosure, ErrorState, Notice, PageSkeleton, Segmented } from '@/components/ui/misc';
import { TaskStatusUpdater } from '@/components/reports/TaskStatusUpdater';
import { useOp, useOpMutation } from '@/lib/api';
import { useMe } from '@/lib/session';
import { cn, fmtDate, fmtDateTime, fmtTime } from '@/lib/utils';

export interface FormTask {
  title: string;
  description: string;
  priority: TaskInput['priority'];
  plannedStartTime: string;
  plannedEndTime: string;
  actualStartTime: string;
  actualEndTime: string;
  overnight: boolean;
  dueDate: string;
  projectId: string;
  category: string;
  collaborators: PickedPerson[];
  progressPercentage: number;
  status: TaskInput['status'];
  notes: string;
}

export const blankTask = (): FormTask => ({
  title: '',
  description: '',
  priority: 'HIGH',
  plannedStartTime: '',
  plannedEndTime: '',
  actualStartTime: '',
  actualEndTime: '',
  overnight: false,
  dueDate: '',
  projectId: '',
  category: '',
  collaborators: [],
  progressPercentage: 0,
  status: 'PLANNED',
  notes: '',
});

export function fromEntry(t: TaskEntry, people: Map<string, PickedPerson>): FormTask {
  return {
    title: t.title,
    description: t.description,
    priority: t.priority,
    plannedStartTime: t.plannedStartTime ?? '',
    plannedEndTime: t.plannedEndTime ?? '',
    actualStartTime: t.actualStartTime ?? '',
    actualEndTime: t.actualEndTime ?? '',
    overnight: t.overnight,
    dueDate: t.dueDate ?? '',
    projectId: t.projectId ?? '',
    category: t.category ?? '',
    collaborators: t.collaboratorIds.map((id) => people.get(id) ?? { id, fullName: 'Colleague', employeeCode: '' }),
    progressPercentage: t.progressPercentage,
    status: t.status,
    notes: t.notes,
  };
}

export const isBlank = (t: FormTask) => !t.title.trim() && !t.description.trim();
const n = (s: string) => (s.trim() === '' ? null : s);

export function toInput(t: FormTask): TaskInput {
  return {
    title: t.title,
    description: t.description,
    priority: t.priority,
    plannedStartTime: n(t.plannedStartTime),
    plannedEndTime: n(t.plannedEndTime),
    actualStartTime: n(t.actualStartTime),
    actualEndTime: n(t.actualEndTime),
    overnight: t.overnight,
    dueDate: n(t.dueDate),
    projectId: n(t.projectId),
    category: n(t.category),
    collaboratorIds: t.collaborators.map((c) => c.id),
    progressPercentage: Number(t.progressPercentage),
    status: t.status,
    notes: t.notes,
  };
}

export type Errors = Record<number, Partial<Record<keyof FormTask | 'collaboratorIds', string>>>;

const MORE_FIELDS: (keyof FormTask)[] = ['actualStartTime', 'actualEndTime', 'dueDate', 'category', 'notes', 'overnight'];

export function DailyEntryPage() {
  const me = useMe();
  const params = useParams();
  const workDate = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : me.today;
  const q = useOp('daily.getForDate', { workDate });
  const collabIds = useMemo(() => [...new Set(q.data?.report?.tasks.flatMap((t) => t.collaboratorIds) ?? [])], [q.data]);
  const people = useOp('lookup.people', { ids: collabIds }, { enabled: collabIds.length > 0 });
  // The selected task tab survives the form reloading after a save or status update (same date only).
  const [tab, setTab] = useState({ date: workDate, index: 0 });
  const active = tab.date === workDate ? tab.index : 0;

  if (q.isLoading || (collabIds.length > 0 && people.isLoading)) return <PageSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const peopleMap = new Map((people.data?.items ?? []).map((p) => [p.id, { id: p.id, fullName: p.fullName, employeeCode: p.employeeCode }]));
  return <DailyForm key={`${workDate}-${q.data.report?.revision ?? 0}`} data={q.data} people={peopleMap} active={active} setActive={(index) => setTab({ date: workDate, index })} />;
}

function DailyForm({
  data,
  people,
  active,
  setActive,
}: {
  data: NonNullable<ReturnType<typeof useOp<'daily.getForDate'>>['data']>;
  people: Map<string, PickedPerson>;
  active: number;
  setActive: (index: number) => void;
}) {
  const me = useMe();
  const navigate = useNavigate();
  const s = me.settings;
  const report = data.report as DailyReportDoc | null;
  const slots = s.primaryTaskSlots;
  const initial = useMemo(() => {
    const list = (report?.tasks ?? []).map((t) => fromEntry(t, people));
    while (list.length < slots) list.push(blankTask());
    return list;
  }, [report, people, slots]);
  const [tasks, setTasks] = useState<FormTask[]>(initial);
  const [notes, setNotes] = useState(report?.employeeNotes ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [projectDialog, setProjectDialog] = useState<number | null>(null);
  const projects = useProjects();
  const dirty = JSON.stringify(tasks) !== JSON.stringify(initial) || notes !== (report?.employeeNotes ?? '');
  const save = useOpMutation('daily.save', { invalidate: ['daily.getForDate', 'me.dashboard', 'daily.list', 'notifications.list'], silent: true });
  const editable = data.editable;

  // Set once a save succeeds so the redirect after submitting is never mistaken for leaving unsaved work.
  const saved = useRef(false);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && editable && !save.isPending && !saved.current && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty || !editable) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty, editable]);

  const update = (i: number, patch: Partial<FormTask>) => {
    setTasks((prev) => prev.map((t, j) => (j === i ? { ...t, ...patch } : t)));
    setErrors((e) => ({ ...e, [i]: {} }));
  };

  const validate = (forSubmit: boolean): TaskInput[] | null => {
    const errs: Errors = {};
    const filled: TaskInput[] = [];

    // When submitting, all 3 priority tasks must be filled!
    if (forSubmit) {
      for (let i = 0; i < slots; i++) {
        const item = tasks[i];
        if (!item || !item.title.trim()) {
          errs[i] = { title: `Priority Task ${i + 1} must be filled.` };
        }
      }
    }

    tasks.forEach((t, i) => {
      if (isBlank(t)) return;
      const parsed = taskInput.safeParse(toInput(t));
      const e: Errors[number] = errs[i] ?? {};
      if (!parsed.success) {
        for (const issue of parsed.error.issues) e[issue.path[0] as keyof FormTask] ??= issue.message;
      } else {
        for (const issue of taskIssues(parsed.data, { allowOvernightTasks: s.allowOvernightTasks, taskCategories: s.taskCategories })) e[issue.field as keyof FormTask] ??= issue.message;
      }
      if (Object.keys(e).length) errs[i] = e;
      else if (parsed.success) filled.push(parsed.data);
    });
    setErrors(errs);
    const firstBad = Object.keys(errs).map(Number)[0];
    if (firstBad !== undefined) {
      setActive(firstBad);
      if (firstBad < slots && (!tasks[firstBad] || !tasks[firstBad].title.trim())) {
        setFormError(`Please fill all ${slots} priority tasks before submitting (Task ${firstBad + 1} is empty).`);
      } else {
        setFormError(`Check task ${firstBad + 1}`);
      }
      return null;
    }
    const requiredMin = Math.max(s.minTasksForSubmission, slots);
    if (forSubmit && filled.length < requiredMin) {
      setFormError(`Please fill all ${requiredMin} priority tasks before submitting.`);
      return null;
    }
    setFormError(null);
    return filled;
  };

  const doSave = (submit: boolean) => {
    const filled = validate(submit);
    if (!filled) return;
    save.mutate(
      { workDate: data.workDate, tasks: filled, employeeNotes: notes, submit, expectedRevision: report?.revision ?? null },
      {
        onSuccess: (r) => {
          saved.current = true;
          toast.success(submit ? 'Report submitted to your manager' : 'Draft saved');
          setConfirmSubmit(false);
          if (submit) navigate(`/reports/daily/${r.report.id}`);
        },
        onError: (e) => {
          setConfirmSubmit(false);
          const d = e.details as { task?: number; field?: string } | undefined;
          setFormError(e.message);
          if (d?.task !== undefined && d.field) {
            setErrors({ [d.task]: { [d.field]: e.message } });
            setActive(d.task);
          }
        },
      },
    );
  };

  const maxTasks = data.maxTasks;
  const isToday = data.workDate === data.today;
  const filledPriorityCount = tasks.slice(0, slots).filter((t) => t.title.trim().length > 0).length;
  const allPriorityFilled = filledPriorityCount >= slots;
  const t = tasks[active] ?? tasks[0]!;
  const submittedLocked = !editable && !!report && report.version > 0 && report.reviewStatus !== 'RETURNED';

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight">{isToday ? "Today's tasks" : fmtDate(data.workDate, { weekday: 'long', day: 'numeric', month: 'short' })}</h1>
          <p className="mt-0.5 text-[14px] text-muted-foreground">{isToday ? "What's on your plate today?" : 'Tasks for this day'}</p>
        </div>
        <Input
          type="date"
          aria-label="Choose work date"
          value={data.workDate}
          max={data.today}
          min={addDays(data.today, -60)}
          onChange={(e) => e.target.value && navigate(e.target.value === data.today ? '/daily/today' : `/daily/${e.target.value}`)}
          className="h-9 w-auto shrink-0 rounded-full px-3 text-[13px]"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        {report && !submittedLocked && <StatusBadge status={report.submissionStatus === 'DRAFT' ? 'DRAFT' : report.reviewStatus} />}
        <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium', data.workingDay.isWorkingDay ? 'bg-muted text-muted-foreground' : 'bg-warning-soft text-warning')}>
          {data.workingDay.isWorkingDay ? 'Working day' : 'Holiday — optional'}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 font-medium text-muted-foreground">
          <Clock className="size-3" aria-hidden /> Due {fmtDateTime(data.deadline).split(',').slice(-1)[0]?.trim()}
        </span>
        {data.pastDeadline && !report?.submittedAt && data.workingDay.isWorkingDay && <span className="rounded-full bg-danger-soft px-2.5 py-1 font-medium text-danger">Past deadline</span>}
      </div>

      {report?.reviewStatus === 'RETURNED' && (
        <Notice tone="danger" title="Your manager asked for changes">
          {report.lastReviewComment}
        </Notice>
      )}
      {submittedLocked ? (
        <div className="flex items-center gap-2.5 rounded-2xl bg-success-soft px-4 py-3 text-success">
          <CheckCircle2 className="size-5 shrink-0" aria-hidden />
          <span className="text-[15px] font-semibold">Submitted</span>
          {report?.reviewStatus === 'APPROVED' && <span className="text-[13px] font-medium">· Approved</span>}
          <Link to={`/reports/daily/${report!.id}`} className="ml-auto text-[13px] font-medium underline-offset-2 hover:underline">
            View
          </Link>
        </div>
      ) : (
        !editable && data.blockReason && <Notice tone="warning">{data.blockReason}</Notice>
      )}
      {formError && <Notice tone="danger">{formError}</Notice>}

      <div role="tablist" aria-label="Tasks" className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
        {tasks.map((task, i) => {
          const hasError = !!errors[i] && Object.keys(errors[i]!).length > 0;
          const filled = !isBlank(task);
          return (
            <button
              key={i}
              role="tab"
              type="button"
              aria-selected={i === active}
              aria-label={`Task ${i + 1}${filled ? `: ${task.title}` : ''}${hasError ? ' (has errors)' : ''}`}
              onClick={() => setActive(i)}
              className={cn(
                'tap flex min-w-0 shrink-0 cursor-pointer items-center gap-2 rounded-2xl border px-3.5 py-2.5 text-left text-[13px] font-medium',
                i === active ? 'border-transparent bg-foreground text-background' : 'bg-card text-foreground/80',
                hasError && i !== active && 'border-danger text-danger',
              )}
            >
              <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold', submittedLocked && filled ? 'bg-success text-white dark:text-black' : i === active ? 'bg-background/20' : filled ? 'bg-success-soft text-success' : 'bg-muted')}>
                {filled && (i !== active || submittedLocked) ? <Check className="size-3" aria-label="Submitted" /> : i + 1}
              </span>
              <span title={filled ? task.title : undefined}>Task {i + 1}</span>
            </button>
          );
        })}
        {editable && s.allowAdditionalTasks && tasks.length < maxTasks && (
          <button
            type="button"
            onClick={() => {
              setTasks((p) => [...p, { ...blankTask(), priority: 'MEDIUM' }]);
              setActive(tasks.length);
            }}
            className="tap flex shrink-0 cursor-pointer items-center gap-1 rounded-2xl border border-dashed px-3.5 py-2.5 text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            <Plus className="size-4" aria-hidden /> Add
          </button>
        )}
      </div>

      {/* Submitted: the report is locked, but each task's status can still be updated with a comment. */}
      {report && report.version > 0 && !editable && report.tasks[active] && data.workDate >= addDays(data.today, -s.maxBackdateDays) && (
        <TaskStatusUpdater key={`${report.id}_${active}_${report.revision}`} reportId={report.id} task={report.tasks[active]!} />
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (validate(true)) setConfirmSubmit(true);
        }}
        className="space-y-4"
      >
        <fieldset disabled={!editable || save.isPending} className="space-y-4">
          <TaskCard
            key={active}
            index={active}
            task={t}
            errors={errors[active] ?? {}}
            isPrimary={active < slots}
            onChange={(p) => update(active, p)}
            onRemove={editable && active >= slots ? () => { setTasks((prev) => prev.filter((_, j) => j !== active)); setActive(0); } : undefined}
            onClear={editable && active < slots && !isBlank(t) ? () => update(active, blankTask()) : undefined}
            projects={projects.items}
            categories={s.taskCategories}
            allowOvernight={s.allowOvernightTasks}
            allowProjectRequests={s.allowProjectRequests}
            onRequestProject={() => setProjectDialog(active)}
            workDate={data.workDate}
            selfId={me.user.id}
          />
          <Disclosure title="Note for your manager" badge={notes ? <span className="size-1.5 rounded-full bg-brand" aria-label="has a note" /> : undefined}>
            <Textarea aria-label="Note for your manager" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={4000} placeholder="Anything your manager should know (optional)" />
          </Disclosure>
        </fieldset>

        {editable && (
          <div className="no-print sticky bottom-[calc(76px+env(safe-area-inset-bottom))] z-20 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur-md sm:mx-0 sm:rounded-2xl sm:border lg:bottom-4">
            <p className={cn(
              "mb-2 text-center text-[12px] font-medium transition-colors",
              allPriorityFilled ? "text-success" : "text-amber-600 dark:text-amber-400"
            )}>
              {allPriorityFilled
                ? `✅ All ${slots} priority tasks filled · Ready to submit`
                : `⚠️ Fill all ${slots} priority tasks to submit (${filledPriorityCount} of ${slots} filled)`}
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => doSave(false)} loading={save.isPending && !save.variables?.submit}>
                <Save /> Save draft
              </Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={!allPriorityFilled || (save.isPending && !!save.variables?.submit)}
                loading={save.isPending && !!save.variables?.submit}
              >
                <Send /> {allPriorityFilled
                  ? (report?.reviewStatus === 'RETURNED' ? 'Resubmit report' : 'Submit report')
                  : `Fill all ${slots} priority tasks (${filledPriorityCount}/${slots})`}
              </Button>
            </div>
          </div>
        )}
      </form>

      {report && report.version > 0 && (
        <Disclosure title="Review history" defaultOpen={report.reviewStatus === 'RETURNED'}>
          <ReviewTimeline reviews={data.reviews} submittedAt={report.submittedAt} version={report.version} bare />
        </Disclosure>
      )}

      <ConfirmDialog
        open={confirmSubmit}
        onOpenChange={setConfirmSubmit}
        title="Submit report?"
        description="It goes to your manager for review."
        confirmLabel="Submit"
        loading={save.isPending}
        onConfirm={() => doSave(true)}
      >
        <ul className="space-y-1.5 text-sm">
          {tasks.filter((x) => !isBlank(x)).map((x, i) => (
            <li key={i} className="flex items-center justify-between gap-2 rounded-xl bg-muted px-3 py-2">
              <span className="truncate font-medium">{x.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {statusLabel(x.status)} · {x.progressPercentage}%
              </span>
            </li>
          ))}
        </ul>
      </ConfirmDialog>

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(o) => !o && blocker.reset?.()}
        title="Leave without saving?"
        description="Your changes will be lost."
        confirmLabel="Discard changes"
        tone="destructive"
        onConfirm={() => blocker.proceed?.()}
      />

      <ProjectRequestSheet
        open={projectDialog !== null}
        onOpenChange={(o) => !o && setProjectDialog(null)}
        onCreated={(id) => {
          if (projectDialog !== null) update(projectDialog, { projectId: id });
          void projects.refetch();
        }}
      />
    </div>
  );
}

const STATUS_SHORT: Record<string, string> = { PLANNED: 'Planned', IN_PROGRESS: 'In progress', COMPLETED: 'Done', BLOCKED: 'Blocked' };

export function TaskCard({
  index,
  task: t,
  errors,
  isPrimary,
  onChange,
  onRemove,
  onClear,
  projects,
  categories,
  allowOvernight,
  allowProjectRequests,
  onRequestProject,
  workDate,
  selfId,
}: {
  index: number;
  task: FormTask;
  errors: Errors[number];
  isPrimary: boolean;
  onChange: (p: Partial<FormTask>) => void;
  onRemove?: () => void;
  onClear?: () => void;
  projects: { id: string; name: string; code: string; status: string }[];
  categories: string[];
  allowOvernight: boolean;
  allowProjectRequests: boolean;
  onRequestProject: () => void;
  workDate: string;
  selfId: string;
}) {
  const hasError = Object.keys(errors).length > 0;
  const moreHasError = MORE_FIELDS.some((f) => errors[f]);
  const moreFilled = MORE_FIELDS.some((f) => (f === 'overnight' ? t.overnight : !!t[f]));
  const setStatus = (status: FormTask['status']) =>
    onChange({ status, progressPercentage: status === 'COMPLETED' ? 100 : status === 'PLANNED' ? 0 : t.progressPercentage === 100 || t.progressPercentage === 0 ? 50 : t.progressPercentage });

  return (
    <Card className={cn('animate-fade-up p-4 sm:p-5', hasError && 'border-danger/50')}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-[12px] font-semibold tracking-wide text-brand">
          TASK {index + 1} <span className="font-medium text-muted-foreground">· {isPrimary ? 'Priority' : 'Additional'}</span>
        </p>
        <div className="flex gap-1">
          {onClear && (
            <Button type="button" variant="ghost" size="sm" onClick={onClear}>
              Clear
            </Button>
          )}
          {onRemove && (
            <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label={`Remove task ${index + 1}`}>
              <Trash2 /> Remove
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-3.5">
        <Field label="Task title" hideLabel required error={errors.title}>
          {(p) => <Input {...p} value={t.title} onChange={(e) => onChange({ title: e.target.value })} maxLength={200} placeholder="Task title" className="h-12 text-[16px] font-medium" />}
        </Field>
        <Field label="Description" hideLabel required error={errors.description}>
          {(p) => <Textarea {...p} value={t.description} onChange={(e) => onChange({ description: e.target.value })} rows={2} maxLength={4000} placeholder="Short description" className="min-h-[68px]" />}
        </Field>

        <Field label="Project / workstream" hideLabel error={errors.projectId}>
          {(p) => (
            <div className="flex gap-2">
              <Select {...p} value={t.projectId} onChange={(e) => onChange({ projectId: e.target.value })}>
                <option value="">No project</option>
                {projects.map((pr) => (
                  <option key={pr.id} value={pr.id}>
                    {pr.name} ({pr.code}){pr.status !== 'ACTIVE' ? ` — ${statusLabel(pr.status)}` : ''}
                  </option>
                ))}
              </Select>
              {allowProjectRequests && (
                <Button type="button" variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={onRequestProject} aria-label="Request a new project" title="Request a new project">
                  <FolderPlus />
                </Button>
              )}
            </div>
          )}
        </Field>

        <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2">
          <Field label="Planned start" hideLabel error={errors.plannedStartTime}>
            {(p) => <Input {...p} type="time" value={t.plannedStartTime} onChange={(e) => onChange({ plannedStartTime: e.target.value })} />}
          </Field>
          <span className="pt-3 text-muted-foreground" aria-hidden>
            —
          </span>
          <Field label="Planned end" hideLabel error={errors.plannedEndTime}>
            {(p) => <Input {...p} type="time" value={t.plannedEndTime} onChange={(e) => onChange({ plannedEndTime: e.target.value })} />}
          </Field>
        </div>

        <div>
          <p className="mb-1.5 text-[13px] font-medium text-foreground/80">Collaborators</p>
          <PeoplePicker value={t.collaborators} onChange={(v) => onChange({ collaborators: v })} exclude={[selfId]} ariaLabel={`Add collaborators to task ${index + 1}`} placeholder="Add people (optional)" />
        </div>

        <div className="space-y-3.5">
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-foreground/80">Priority</p>
            <Segmented label={`Priority of task ${index + 1}`} value={t.priority} onChange={(v) => onChange({ priority: v })} options={PRIORITIES.map((p) => ({ value: p, label: statusLabel(p) }))} />
          </div>
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-foreground/80">Status</p>
            <Segmented label={`Status of task ${index + 1}`} value={t.status} onChange={setStatus} options={TASK_STATUSES.map((st) => ({ value: st, label: STATUS_SHORT[st] }))} />
            {errors.status && <p className="mt-1 text-xs text-danger" role="alert">{errors.status}</p>}
          </div>
        </div>

        {t.status !== 'PLANNED' && (
          <Field label={`Progress ${t.progressPercentage}%`} error={errors.progressPercentage}>
            {(p) => (
              <input
                {...p}
                type="range"
                min={0}
                max={100}
                step={5}
                value={t.progressPercentage}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  onChange({ progressPercentage: v, status: v === 100 ? 'COMPLETED' : t.status === 'COMPLETED' ? 'IN_PROGRESS' : t.status });
                }}
                className="w-full cursor-pointer accent-[var(--brand)]"
              />
            )}
          </Field>
        )}

        <Disclosure key={moreHasError ? 'err' : 'ok'} title="More details" defaultOpen={moreHasError} badge={moreFilled ? <span className="size-1.5 rounded-full bg-brand" aria-label="has details" /> : undefined} className="bg-muted/40">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="Actual start" error={errors.actualStartTime}>
              {(p) => <Input {...p} type="time" value={t.actualStartTime} onChange={(e) => onChange({ actualStartTime: e.target.value })} />}
            </Field>
            <Field label="Actual end" error={errors.actualEndTime}>
              {(p) => <Input {...p} type="time" value={t.actualEndTime} onChange={(e) => onChange({ actualEndTime: e.target.value })} />}
            </Field>
            <Field label="Due date" error={errors.dueDate} hint="Needed for overdue tracking">
              {(p) => <Input {...p} type="date" value={t.dueDate} min={workDate} onChange={(e) => onChange({ dueDate: e.target.value })} />}
            </Field>
            <Field label="Category" error={errors.category}>
              {(p) => (
                <Select {...p} value={t.category} onChange={(e) => onChange({ category: e.target.value })}>
                  <option value="">Select…</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {allowOvernight && (
              <div className="sm:col-span-2">
                <Checkbox label="Overnight work (ends after midnight)" checked={t.overnight} onChange={(e) => onChange({ overnight: e.target.checked })} />
                {errors.overnight && <p className="mt-1 text-xs text-danger">{errors.overnight}</p>}
              </div>
            )}
            <Field label="Task notes" className="sm:col-span-2">
              {(p) => <Textarea {...p} value={t.notes} onChange={(e) => onChange({ notes: e.target.value })} rows={2} maxLength={2000} placeholder="Blockers, follow-ups" />}
            </Field>
          </div>
        </Disclosure>
        {t.plannedStartTime && t.plannedEndTime && !errors.plannedEndTime && (
          <p className="text-[12px] text-muted-foreground">
            Planned {fmtTime(t.plannedStartTime)} – {fmtTime(t.plannedEndTime)}
          </p>
        )}
      </div>
    </Card>
  );
}
