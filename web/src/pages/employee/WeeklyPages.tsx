import { addDays, EMPTY_NARRATIVE, weekStartFor, type WeeklyNarrative, type WeeklySummary } from '@rgk/core';
import { ChevronLeft, ChevronRight, Edit3, Eye, Info, Printer, Save, Send, ShieldAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { DefinitionList, PageHeader } from '@/components/common/layout';
import { StatusBadge } from '@/components/common/StatusBadge';
import { ReviewPanel, ReviewTimeline, VersionHistory } from '@/components/reports/ReportParts';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/form';
import { Disclosure, ErrorState, Notice, PageSkeleton, Progress } from '@/components/ui/misc';
import { useOp, useOpMutation } from '@/lib/api';
import { useMe } from '@/lib/session';
import { fmtDate, fmtDateTime, fmtShortDate } from '@/lib/utils';

export const NARRATIVE_FIELDS: { key: keyof WeeklyNarrative; label: string; required?: boolean; main?: boolean; placeholder?: string }[] = [
  { key: 'majorAccomplishments', label: 'Key achievements', required: true, main: true, placeholder: 'What did you get done this week?' },
  { key: 'blockers', label: 'Blockers', main: true, placeholder: 'Anything slowing you down?' },
  { key: 'nextWeekPlan', label: "Next week's plan", required: true, main: true, placeholder: 'What will you focus on next?' },
  { key: 'projectProgress', label: 'Project progress', placeholder: 'Filled in from your daily reports' },
  { key: 'keyDeliverables', label: 'Key deliverables' },
  { key: 'decisionsRequired', label: 'Decisions needed' },
  { key: 'collaborationSummary', label: 'Collaboration' },
  { key: 'employeeComments', label: 'Other comments' },
];

/** Automatic figures from daily reports, shown apart from what the employee writes. */
export function CalculatedSummary({ summary }: { summary: WeeklySummary }) {
  const stats = [
    { label: 'Completed', value: summary.tasksCompleted, cls: 'text-success' },
    { label: 'In progress', value: summary.tasksInProgress, cls: 'text-info' },
    { label: 'Pending', value: summary.tasksPending + summary.tasksBlocked, cls: 'text-warning' },
    { label: 'Reports', value: `${summary.dailyReportsSubmitted}/${summary.workingDays}`, cls: '' },
  ];
  const notes = [
    summary.missingReportDates.length ? `Missing: ${summary.missingReportDates.map(fmtShortDate).join(', ')}` : null,
    summary.tasksBlocked ? `${summary.tasksBlocked} blocked` : null,
    summary.tasksOverdue ? `${summary.tasksOverdue} overdue` : null,
  ].filter(Boolean);
  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-muted-foreground">From your daily reports</p>
        <span className="rounded-full bg-info-soft px-2 py-0.5 text-[11px] font-medium text-info">Automatic</span>
      </div>
      <div className="grid grid-cols-4 divide-x text-center">
        {stats.map((x) => (
          <div key={x.label} className="px-1">
            <p className={`text-[22px] font-semibold leading-none ${x.cls}`}>{x.value}</p>
            <p className="mt-1.5 text-[11px] text-muted-foreground sm:text-[12px]">{x.label}</p>
          </div>
        ))}
      </div>
      {notes.length > 0 && <p className="mt-3 text-[12px] text-muted-foreground">{notes.join(' · ')}</p>}
      {summary.projects.length > 0 && (
        <Disclosure title="Project breakdown" className="mt-4 bg-muted/40">
          <ul className="space-y-2.5">
            {summary.projects.map((p) => (
              <li key={p.projectId ?? 'none'}>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-medium">{p.projectName}</span>
                  <span className="shrink-0 text-[12px] text-muted-foreground">
                    {p.completed}/{p.tasks} done · {p.activeDays} day{p.activeDays === 1 ? '' : 's'}
                  </span>
                </div>
                <Progress value={p.tasks ? (p.completed / p.tasks) * 100 : 0} className="mt-1.5 h-1.5" label={`${p.projectName} completion`} />
              </li>
            ))}
          </ul>
          {summary.collaborators.length > 0 && <p className="mt-3 text-[12px] text-muted-foreground">Worked with {summary.collaborators.map((c) => c.name).join(', ')}</p>}
        </Disclosure>
      )}
    </Card>
  );
}

export function WeeklyCreatePage() {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const requested = params.get('period');
  const periodStart = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? weekStartFor(requested, me.settings.weekStartDay) : null;
  const q = useOp('weekly.preview', { periodStart });
  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return <WeeklyForm key={`${q.data.periodStart}-${q.data.report?.revision ?? 0}`} data={q.data} onPeriod={(p) => setParams({ period: p })} />;
}

function WeeklyForm({ data, onPeriod }: { data: NonNullable<ReturnType<typeof useOp<'weekly.preview'>>['data']>; onPeriod: (p: string) => void }) {
  const navigate = useNavigate();
  const report = data.report;
  const prefill: WeeklyNarrative = report?.narrative ?? {
    ...EMPTY_NARRATIVE,
    projectProgress: data.summary.projects.map((p) => `${p.projectName}: ${p.completed} of ${p.tasks} tasks completed over ${p.activeDays} day(s)`).join('\n'),
  };
  const [narrative, setNarrative] = useState<WeeklyNarrative>(prefill);
  const [preview, setPreview] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useOpMutation('weekly.save', { invalidate: ['weekly.preview', 'weekly.list', 'me.dashboard'], silent: true });
  const dirty = JSON.stringify(narrative) !== JSON.stringify(prefill);
  const isCurrent = data.periodStart === weekStartFor(data.today, data.weekStartDay);

  useEffect(() => {
    if (!dirty || !data.editable) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty, data.editable]);

  const submit = (doSubmit: boolean) => {
    setError(null);
    save.mutate(
      { periodStart: data.periodStart, narrative, submit: doSubmit, expectedRevision: report?.revision ?? null },
      {
        onSuccess: (r) => {
          toast.success(doSubmit ? 'Weekly report submitted' : 'Weekly report draft saved');
          setConfirm(false);
          setPreview(false);
          if (doSubmit) navigate(`/reports/weekly/${r.report.id}`);
        },
        onError: (e) => {
          setConfirm(false);
          setError(e.message);
        },
      },
    );
  };
  const missingRequired = NARRATIVE_FIELDS.filter((f) => f.required && !narrative[f.key].trim());
  const field = (f: (typeof NARRATIVE_FIELDS)[number]) => (
    <Field key={f.key} label={f.label} required={f.required}>
      {(p) => <Textarea {...p} rows={f.main ? 3 : 2} value={narrative[f.key]} placeholder={f.placeholder} onChange={(e) => setNarrative((x) => ({ ...x, [f.key]: e.target.value }))} maxLength={6000} />}
    </Field>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight">{isCurrent ? 'This week' : 'Weekly report'}</h1>
          <p className="mt-0.5 text-[14px] text-muted-foreground">
            {fmtShortDate(data.periodStart)} – {fmtShortDate(data.periodEnd)}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={() => onPeriod(addDays(data.periodStart, -7))} aria-label="Previous week">
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon" onClick={() => onPeriod(addDays(data.periodStart, 7))} disabled={isCurrent} aria-label="Next week">
            <ChevronRight />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={report ? (report.version > 0 ? report.reviewStatus : 'DRAFT') : 'NOT_SUBMITTED'} />
        <span className="text-[12px] text-muted-foreground">Due {fmtDateTime(data.deadline)}</span>
        {report && report.version > 0 && (
          <Link to={`/reports/weekly/${report.id}`} className="text-[12px] font-medium text-primary hover:underline">
            View submitted
          </Link>
        )}
      </div>
      {report?.reviewStatus === 'RETURNED' && <Notice tone="danger" title="Your manager asked for changes">{report.lastReviewComment}</Notice>}
      {!data.editable && data.blockReason && <Notice tone="warning">{data.blockReason}</Notice>}
      {data.editable && !data.canSubmitNow && <Notice tone="info">You can save now and submit from {fmtDate(data.submitOpensOn, { weekday: 'short', day: 'numeric', month: 'short' })}.</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}

      <CalculatedSummary summary={data.summary} />

      <Card className="p-4 sm:p-5">
        <fieldset disabled={!data.editable || save.isPending} className="space-y-4">
          {NARRATIVE_FIELDS.filter((f) => f.main).map(field)}
          <Disclosure title="More sections" className="bg-muted/40" badge={NARRATIVE_FIELDS.some((f) => !f.main && narrative[f.key]) ? <span className="size-1.5 rounded-full bg-brand" aria-label="has content" /> : undefined}>
            <div className="space-y-4">{NARRATIVE_FIELDS.filter((f) => !f.main).map(field)}</div>
          </Disclosure>
        </fieldset>
      </Card>

      {data.editable && (
        <div className="no-print sticky bottom-[calc(76px+env(safe-area-inset-bottom))] z-20 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur-md sm:mx-0 sm:rounded-2xl sm:border lg:bottom-4">
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => submit(false)} loading={save.isPending && !save.variables?.submit}>
              <Save /> Save
            </Button>
            <Button variant="outline" onClick={() => setPreview(true)}>
              <Eye /> Preview
            </Button>
            <Button className="flex-1" onClick={() => (missingRequired.length ? setError(`Fill in: ${missingRequired.map((f) => f.label).join(', ')}`) : setConfirm(true))} disabled={!data.canSubmitNow}>
              <Send /> Submit
            </Button>
          </div>
          {dirty && <p className="mt-1.5 text-center text-[11px] text-muted-foreground">Unsaved changes</p>}
        </div>
      )}

      {data.reviews.length > 0 && report && (
        <Disclosure title="Review history">
          <ReviewTimeline reviews={data.reviews} submittedAt={report.submittedAt} version={report.version} bare />
        </Disclosure>
      )}

      <Dialog open={preview} onOpenChange={setPreview} title="Preview" description={`${fmtShortDate(data.periodStart)} – ${fmtShortDate(data.periodEnd)}`} wide>
        <div className="space-y-4 text-sm">
          <p className="rounded-xl bg-info-soft px-3 py-2 text-info">
            <Info className="mr-1 inline size-4" aria-hidden /> {data.summary.tasksCompleted}/{data.summary.tasksPlanned} tasks done · {data.summary.dailyReportsSubmitted}/{data.summary.workingDays} daily reports
          </p>
          {NARRATIVE_FIELDS.filter((f) => narrative[f.key]).map((f) => (
            <div key={f.key}>
              <p className="text-[12px] font-semibold text-muted-foreground">{f.label}</p>
              <p className="whitespace-pre-wrap">{narrative[f.key]}</p>
            </div>
          ))}
        </div>
      </Dialog>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Submit weekly report?" description="Your manager will be notified." confirmLabel="Submit" loading={save.isPending} onConfirm={() => submit(true)} />
    </div>
  );
}

export function WeeklyDetailPage({ mode }: { mode: 'own' | 'review' | 'admin' }) {
  const { id = '' } = useParams();
  const q = useOp('weekly.get', { reportId: id });
  const markViewed = useOpMutation('review.markViewed', { invalidate: ['weekly.get', 'review.pending'], silent: true });
  const viewed = useRef<string | null>(null);
  useEffect(() => {
    const d = q.data;
    if (d?.canReview && d.report.submissionStatus === 'SUBMITTED' && viewed.current !== `${id}-${d.report.version}`) {
      viewed.current = `${id}-${d.report.version}`;
      markViewed.mutate({ reportType: 'WEEKLY', reportId: id });
    }
  }, [q.data, id, markViewed]);
  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { report, employee } = q.data;
  const back = mode === 'review' ? { to: '/reviews/weekly', label: 'Weekly report reviews' } : mode === 'admin' ? { to: '/admin/reports/weekly', label: 'Weekly report administration' } : { to: '/reports/weekly', label: 'Weekly history' };
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        back={back}
        title={`${fmtShortDate(report.periodStart)} – ${fmtShortDate(report.periodEnd)}`}
        description={`${employee.fullName} (${employee.employeeCode})`}
        actions={
          <>
            {q.data.isOwner && (report.submissionStatus === 'DRAFT' || report.reviewStatus === 'RETURNED') && (
              <Button asChild>
                <Link to={`/weekly?period=${report.periodStart}`}>
                  <Edit3 /> {report.reviewStatus === 'RETURNED' ? 'Correct and resubmit' : 'Edit draft'}
                </Link>
              </Button>
            )}
            {q.data.canCorrect && report.submissionStatus === 'SUBMITTED' && (
              <Button asChild variant="warning">
                <Link to={`/admin/reports/weekly/${report.id}/correct`}>
                  <ShieldAlert /> Administrative correction
                </Link>
              </Button>
            )}
            <Button variant="outline" onClick={() => window.print()}>
              <Printer /> Print / PDF
            </Button>
          </>
        }
      />
      {report.needsReReview && <Notice tone="warning" title="Re-review required">Corrected by an administrator after approval.</Notice>}
      <StatusBadge status={report.version > 0 ? report.reviewStatus : 'DRAFT'} />
      <Disclosure title="Report details">
        <div>
          <DefinitionList
            items={[
              ['Employee', `${employee.fullName} · ${employee.employeeCode}`],
              ['Department', q.data.departmentName],
              ['Reporting Manager', q.data.primaryManager ?? 'Not assigned'],
              ['Period', `${fmtDate(report.periodStart)} – ${fmtDate(report.periodEnd)}`],
              ['Submitted', report.submittedAt ? `${fmtDateTime(report.submittedAt)}${report.submittedLate ? ' (after deadline)' : ''}` : 'Not submitted'],
              ['Manager feedback', report.lastReviewComment ?? '—'],
            ]}
          />
        </div>
      </Disclosure>
      <CalculatedSummary summary={report.calculatedSummary} />
      <Card className="print-area">
        <CardBody className="space-y-4">
          {NARRATIVE_FIELDS.filter((f) => f.main || report.narrative[f.key]).map((f) => (
            <div key={f.key}>
              <p className="text-[12px] font-semibold text-muted-foreground">{f.label}</p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm">{report.narrative[f.key] || '—'}</p>
            </div>
          ))}
        </CardBody>
      </Card>
      {q.data.canReview && report.submissionStatus === 'SUBMITTED' && <ReviewPanel type="WEEKLY" reportId={report.id} version={report.version} reviewStatus={report.reviewStatus} />}
      <Disclosure title="Review history">
        <ReviewTimeline reviews={q.data.reviews} submittedAt={report.submittedAt} version={report.version} bare />
      </Disclosure>
      {q.data.versions.length > 1 && <VersionHistory type="WEEKLY" reportId={report.id} versions={q.data.versions} />}
    </div>
  );
}
