import { NOTIFICATION_TYPES, PRIORITIES, PROJECT_STATUSES, ROLE_LABELS, ROLES, WEEKDAY_NAMES, addDays, type AuditLogDoc, type Milestone, type NotificationType, type ProjectStatus, type Role, type SystemSettings, type TaskEntry } from '@rgk/core';
import { BellRing, Building2, CalendarDays, ChevronRight, FileClock, Pencil, Plus, Settings as SettingsIcon, ShieldAlert, Trash2, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { DataTable } from '@/components/common/DataTable';
import { FilterBar, FilterSelect, useDepartments } from '@/components/common/filters';
import { DefinitionList, PageHeader } from '@/components/common/layout';
import { PeoplePicker, type PickedPerson } from '@/components/common/PeoplePicker';
import { StatusBadge, statusLabel } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Disclosure, EmptyState, ErrorState, Notice, PageSkeleton } from '@/components/ui/misc';
import { api, errorMessage, useOp, useOpMutation } from '@/lib/api';
import { useMe } from '@/lib/session';
import { fmtDate, fmtDateTime, fmtRelative } from '@/lib/utils';
import { CalendarView } from '../employee/PersonalPages';
import { blankTask, fromEntry, isBlank, TaskCard, toInput, type FormTask } from '../employee/DailyEntryPage';
import { NARRATIVE_FIELDS } from '../employee/WeeklyPages';
import { ManagerAssignment } from './UserAdminPages';

export function AdminDashboardPage() {
  const q = useOp('admin.dashboard', {});
  const reminders = useOpMutation('admin.runReminders', { invalidate: ['notifications.list'], success: (r) => `Sent ${r.deadlineReminders} reminder(s) and ${r.overdueNotices} overdue notice(s)` });
  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const groups: { title: string; icon: typeof Users; to: string; stat: string; note?: string; alert?: boolean; links: { to: string; label: string; badge?: number }[] }[] = [
    {
      title: 'People',
      icon: Users,
      to: '/admin/users',
      stat: `${d.usersByStatus.ACTIVE ?? 0} active`,
      note: d.usersByStatus.PENDING_ACTIVATION ? `${d.usersByStatus.PENDING_ACTIVATION} pending activation` : undefined,
      alert: d.withoutManager > 0 || d.pendingRegistrations > 0,
      links: [
        { to: '/admin/users', label: 'Employees' },
        { to: '/admin/registrations', label: 'Access requests', badge: d.pendingRegistrations },
        { to: '/admin/hierarchy', label: 'Reporting lines', badge: d.withoutManager },
        { to: '/admin/roles', label: 'Roles' },
      ],
    },
    {
      title: 'Organization',
      icon: Building2,
      to: '/admin/departments',
      stat: `${d.departments} departments`,
      note: `${d.activeProjects} active projects`,
      alert: d.proposedProjects > 0,
      links: [
        { to: '/admin/departments', label: 'Departments' },
        { to: '/admin/projects', label: 'Projects', badge: d.proposedProjects },
      ],
    },
    {
      title: 'Reports',
      icon: FileClock,
      to: '/admin/reports/daily',
      stat: `${d.reportsToday}/${d.reportersActive} today`,
      note: d.pendingReviews ? `${d.pendingReviews} waiting for review` : undefined,
      alert: d.needsReReview > 0,
      links: [
        { to: '/admin/reports/daily', label: 'Daily reports', badge: d.needsReReview },
        { to: '/admin/reports/weekly', label: 'Weekly reports' },
        { to: '/admin/audit', label: 'Audit history' },
      ],
    },
    { title: 'Calendar', icon: CalendarDays, to: '/admin/calendar', stat: d.todayWorkingDay.isWorkingDay ? 'Working day today' : 'Holiday today', note: d.todayWorkingDay.reason, links: [{ to: '/admin/calendar', label: 'Holidays & working days' }] },
    { title: 'Settings', icon: SettingsIcon, to: '/admin/settings', stat: 'Deadlines, tasks, access', links: [{ to: '/admin/settings', label: 'System settings' }] },
  ];
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Admin" description={fmtDate(d.today, { weekday: 'long', day: 'numeric', month: 'short' })} actions={<Button variant="outline" size="sm" onClick={() => reminders.mutate({ force: true })} loading={reminders.isPending}><BellRing /> Send reminders</Button>} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((g) => (
          <Card key={g.title} className="p-4 sm:p-5">
            <Link to={g.to} className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand">
                <g.icon className="size-5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-[15px] font-semibold">
                  {g.title}
                  {g.alert && <span className="size-2 rounded-full bg-danger" aria-label="Needs attention" />}
                </span>
                <span className="block text-[12px] text-muted-foreground">{g.stat}</span>
              </span>
            </Link>
            {g.note && <p className="mt-2 text-[12px] text-muted-foreground">{g.note}</p>}
            <ul className="mt-3 space-y-0.5">
              {g.links.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="tap flex items-center justify-between rounded-xl px-2 py-1.5 text-[14px] hover:bg-muted">
                    {l.label}
                    <span className="flex items-center gap-2">
                      {!!l.badge && <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-semibold text-danger">{l.badge}</span>}
                      <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
      <Disclosure title="Recent activity">
        <ul className="divide-y">
          {d.recentAudit.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <span>
                <span className="font-medium">{a.action.replace(/_/g, ' ').toLowerCase()}</span> <span className="text-muted-foreground">· {a.actorName}</span>
              </span>
              <span className="text-xs text-muted-foreground">{fmtRelative(a.timestamp)}</span>
            </li>
          ))}
        </ul>
      </Disclosure>
    </div>
  );
}

export function DepartmentsPage() {
  const q = useOp('admin.departments.list', {});
  const [editing, setEditing] = useState<{ id: string | null; name: string; code: string; description: string; active: boolean } | null>(null);
  const save = useOpMutation('admin.departments.upsert', { invalidate: ['admin.departments.list', 'lookup.departments'], success: 'Department saved', silent: true });
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-5">
      <PageHeader title="Departments" actions={<Button onClick={() => { setError(null); setEditing({ id: null, name: '', code: '', description: '', active: true }); }}><Plus /> Add department</Button>} />
      {q.error ? <ErrorState error={q.error} /> : (
        <Card>
          <DataTable
            caption="Departments"
            loading={q.isLoading}
            rows={q.data?.items ?? []}
            rowKey={(d) => d.id}
            onRowClick={(d) => { setError(null); setEditing({ id: d.id, name: d.name, code: d.code, description: d.description, active: d.active }); }}
            columns={[
              { key: 'n', header: 'Department', sort: (d) => d.name, cell: (d) => <span className="font-medium">{d.name}</span> },
              { key: 'c', header: 'Code', cell: (d) => d.code },
              { key: 'e', header: 'Active employees', sort: (d) => d.activeEmployees, cell: (d) => d.activeEmployees },
              { key: 's', header: 'Status', cell: (d) => <StatusBadge status={d.active ? 'ACTIVE' : 'ARCHIVED'} label={d.active ? 'Active' : 'Inactive'} /> },
            ]}
          />
        </Card>
      )}
      {editing && (
        <Dialog
          open
          onOpenChange={(o) => !o && setEditing(null)}
          title={editing.id ? 'Edit department' : 'Add department'}
          footer={<><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate(editing, { onSuccess: () => setEditing(null), onError: (e) => setError(e.message) })}>Save</Button></>}
        >
          <div className="space-y-3">
            {error && <Notice tone="danger">{error}</Notice>}
            <Field label="Name" required>{(p) => <Input {...p} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />}</Field>
            <Field label="Code" required hint="Short unique code, e.g. RND">{(p) => <Input {...p} value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })} disabled={!!editing.id} />}</Field>
            <Field label="Description">{(p) => <Textarea {...p} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} rows={2} />}</Field>
            <Checkbox label="Active" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
          </div>
        </Dialog>
      )}
    </div>
  );
}

export function HierarchyPage() {
  const q = useOp('directory.list', { query: '', departmentId: null, role: null, status: 'ACTIVE', managerId: null, limit: 200, offset: 0 });
  const [editing, setEditing] = useState<{ id: string; fullName: string; primary: string | null; secondary: string | null } | null>(null);
  const people = useOp('lookup.people', { ids: editing ? [editing.primary, editing.secondary].filter((x): x is string => !!x) : [] }, { enabled: !!editing });
  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} />;
  const all = q.data.items as (typeof q.data.items[number] & { primaryReportingManagerId?: string | null; secondaryReviewerId?: string | null })[];
  const managers = all.filter((u) => u.role === 'REPORTING_MANAGER');
  const unassigned = all.filter((u) => (u.role === 'EMPLOYEE' || u.role === 'REPORTING_MANAGER') && !u.primaryReportingManagerId);
  const reportsOf = (id: string) => all.filter((u) => u.primaryReportingManagerId === id);
  const secondaryOf = (id: string) => all.filter((u) => u.secondaryReviewerId === id);
  return (
    <div className="space-y-5">
      <PageHeader title="Reporting lines" description="Tap an employee to reassign" />
      {unassigned.length > 0 && (
        <Notice tone="warning" title={`${unassigned.length} reporting employee(s) without a Reporting Manager`}>
          Their reports cannot be reviewed until a manager is assigned:{' '}
          {unassigned.map((u, i) => (
            <span key={u.id}>
              {i > 0 && ', '}
              <button className="cursor-pointer font-medium underline" onClick={() => setEditing({ id: u.id, fullName: u.fullName, primary: null, secondary: u.secondaryReviewerId ?? null })}>{u.fullName}</button>
            </span>
          ))}
        </Notice>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {managers.map((m) => (
          <Card key={m.id}>
            <CardHeader title={m.fullName} description={`${m.designation} · ${m.departmentName}${m.managerName ? ` · reports to ${m.managerName}` : ''}`} />
            <CardBody className="space-y-3">
              {reportsOf(m.id).length === 0 && <p className="text-sm text-muted-foreground">No direct reports.</p>}
              <ul className="space-y-1">
                {reportsOf(m.id).map((u) => (
                  <li key={u.id}>
                    <button className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted" onClick={() => setEditing({ id: u.id, fullName: u.fullName, primary: u.primaryReportingManagerId ?? null, secondary: u.secondaryReviewerId ?? null })}>
                      <span>{u.fullName} <span className="text-xs text-muted-foreground">{u.employeeCode}</span></span>
                      <Pencil className="size-3.5 text-muted-foreground" aria-label="Reassign" />
                    </button>
                  </li>
                ))}
              </ul>
              {secondaryOf(m.id).length > 0 && <p className="text-xs text-muted-foreground">Secondary reviewer for: {secondaryOf(m.id).map((u) => u.fullName).join(', ')}</p>}
            </CardBody>
          </Card>
        ))}
      </div>
      {managers.length === 0 && <Card><EmptyState title="No Reporting Managers yet" description="Give a user the Reporting Manager role in User management." /></Card>}
      {editing && (
        <Dialog open onOpenChange={(o) => !o && setEditing(null)} title={`Reporting relationship — ${editing.fullName}`}>
          {people.isLoading ? <PageSkeleton /> : <ManagerAssignment compact userId={editing.id} userName={editing.fullName} current={people.data?.items ?? []} primaryId={editing.primary} secondaryId={editing.secondary} />}
        </Dialog>
      )}
    </div>
  );
}

type ProjectForm = { id: string | null; name: string; code: string; description: string; departmentId: string | null; ownerId: string | null; reviewerId: string | null; participantIds: string[]; startDate: string | null; targetEndDate: string | null; status: ProjectStatus; priority: (typeof PRIORITIES)[number]; milestones: Milestone[] };

export function ProjectsAdminPage() {
  const departments = useDepartments();
  const q = useOp('lookup.projects', { includeAll: true });
  const [editing, setEditing] = useState<ProjectForm | null>(null);
  const [owner, setOwner] = useState<PickedPerson[]>([]);
  const [reviewer, setReviewer] = useState<PickedPerson[]>([]);
  const [error, setError] = useState<string | null>(null);
  const save = useOpMutation('admin.projects.upsert', { invalidate: ['lookup.projects', 'projects.analytics', 'admin.dashboard'], success: 'Project saved', silent: true });
  type P = NonNullable<typeof q.data>['items'][number];
  const open = async (p: P | null) => {
    setError(null);
    if (!p) {
      setOwner([]);
      setReviewer([]);
      setEditing({ id: null, name: '', code: '', description: '', departmentId: null, ownerId: null, reviewerId: null, participantIds: [], startDate: null, targetEndDate: null, status: 'ACTIVE', priority: 'MEDIUM', milestones: [] });
      return;
    }
    const ownerId = (p as P & { ownerId?: string | null }).ownerId ?? null;
    const reviewerId = (p as P & { reviewerId?: string | null }).reviewerId ?? null;
    const ids = [ownerId, reviewerId].filter((x): x is string => !!x);
    const found = ids.length ? (await api('lookup.people', { ids })).items : [];
    const pick = (id: string | null) => found.filter((u) => u.id === id).map((u) => ({ id: u.id, fullName: u.fullName, employeeCode: u.employeeCode }));
    setOwner(pick(ownerId));
    setReviewer(pick(reviewerId));
    const full = p as P & Partial<ProjectForm>;
    setEditing({ id: p.id, name: p.name, code: p.code, description: full.description ?? '', departmentId: p.departmentId, ownerId, reviewerId, participantIds: full.participantIds ?? [], startDate: full.startDate ?? null, targetEndDate: full.targetEndDate ?? null, status: p.status, priority: p.priority, milestones: full.milestones ?? [] });
  };
  return (
    <div className="space-y-5">
      <PageHeader title="Projects" description="Approve requests by setting them to Active" actions={<Button onClick={() => void open(null)}><Plus /> New project</Button>} />
      {q.error ? <ErrorState error={q.error} /> : (
        <Card>
          <DataTable
            caption="Projects"
            loading={q.isLoading}
            rows={q.data?.items ?? []}
            rowKey={(p) => p.id}
            onRowClick={(p) => void open(p)}
            columns={[
              { key: 'n', header: 'Project', sort: (p) => p.name, cell: (p) => <span className="font-medium">{p.name}</span> },
              { key: 'c', header: 'Code', cell: (p) => p.code },
              { key: 'd', header: 'Department', cell: (p) => departments.name(p.departmentId), hideOnMobile: true },
              { key: 'p', header: 'Priority', cell: (p) => statusLabel(p.priority) },
              { key: 's', header: 'Status', sort: (p) => p.status, cell: (p) => <StatusBadge status={p.status} /> },
              { key: 'a', header: '', cell: (p) => <Link to={`/projects/${p.id}`} onClick={(e) => e.stopPropagation()} className="text-xs font-medium text-primary hover:underline">Analytics</Link> },
            ]}
            initialSort={{ key: 's', dir: 'desc' }}
          />
        </Card>
      )}
      {editing && (
        <Dialog
          open
          wide
          onOpenChange={(o) => !o && setEditing(null)}
          title={editing.id ? `Edit ${editing.name}` : 'New project'}
          footer={<><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate({ ...editing, ownerId: owner[0]?.id ?? null, reviewerId: reviewer[0]?.id ?? null, startDate: editing.startDate || null, targetEndDate: editing.targetEndDate || null }, { onSuccess: () => setEditing(null), onError: (e) => setError(e.message) })}>Save project</Button></>}
        >
          <div className="grid gap-4 md:grid-cols-2">
            {error && <Notice tone="danger" className="md:col-span-2">{error}</Notice>}
            <Field label="Name" required>{(p) => <Input {...p} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />}</Field>
            <Field label="Code" required>{(p) => <Input {...p} value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })} />}</Field>
            <Field label="Description" className="md:col-span-2">{(p) => <Textarea {...p} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} rows={2} />}</Field>
            <Field label="Department">{(p) => <Select {...p} value={editing.departmentId ?? ''} onChange={(e) => setEditing({ ...editing, departmentId: e.target.value || null })}><option value="">—</option>{departments.items.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>}</Field>
            <div><p className="mb-1.5 text-sm font-medium">Project lead</p><PeoplePicker single value={owner} onChange={setOwner} ariaLabel="Project lead" /></div>
            <div><p className="mb-1.5 text-sm font-medium">Reviewer</p><PeoplePicker single value={reviewer} onChange={setReviewer} filter={(x) => ['REPORTING_MANAGER', 'MANAGEMENT', 'SUPER_ADMIN'].includes(x.role)} exclude={owner.map((o) => o.id)} ariaLabel="Project reviewer" /></div>
            <Field label="Status">{(p) => <Select {...p} value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value as ProjectStatus })}>{PROJECT_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</Select>}</Field>
            <Field label="Priority">{(p) => <Select {...p} value={editing.priority} onChange={(e) => setEditing({ ...editing, priority: e.target.value as ProjectForm['priority'] })}>{PRIORITIES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</Select>}</Field>
            <Field label="Start date">{(p) => <Input {...p} type="date" value={editing.startDate ?? ''} onChange={(e) => setEditing({ ...editing, startDate: e.target.value || null })} />}</Field>
            <Field label="Target end date">{(p) => <Input {...p} type="date" value={editing.targetEndDate ?? ''} onChange={(e) => setEditing({ ...editing, targetEndDate: e.target.value || null })} />}</Field>
            <div className="space-y-2 md:col-span-2">
              <p className="text-sm font-medium">Milestones</p>
              {editing.milestones.map((m, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Input aria-label="Milestone title" value={m.title} onChange={(e) => setEditing({ ...editing, milestones: editing.milestones.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} className="min-w-48 flex-1" />
                  <Input aria-label="Milestone due date" type="date" value={m.dueDate ?? ''} onChange={(e) => setEditing({ ...editing, milestones: editing.milestones.map((x, j) => (j === i ? { ...x, dueDate: e.target.value || null } : x)) })} className="w-40" />
                  <Checkbox label="Done" checked={m.done} onChange={(e) => setEditing({ ...editing, milestones: editing.milestones.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)) })} />
                  <Button variant="ghost" size="icon" aria-label="Remove milestone" onClick={() => setEditing({ ...editing, milestones: editing.milestones.filter((_, j) => j !== i) })}><Trash2 /></Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setEditing({ ...editing, milestones: [...editing.milestones, { title: '', dueDate: null, done: false }] })}><Plus /> Add milestone</Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

export function CalendarAdminPage() {
  const me = useMe();
  const departments = useDepartments();
  const [month] = useState(me.today.slice(0, 7));
  const q = useOp('calendar.month', { month, departmentId: null });
  const upsert = useOpMutation('admin.calendar.upsertException', { invalidate: ['calendar.month'], success: 'Calendar updated', silent: true });
  const del = useOpMutation('admin.calendar.deleteException', { invalidate: ['calendar.month'], success: 'Entry removed' });
  const policy = useOpMutation('admin.calendar.setPolicy', { invalidate: ['calendar.month', 'admin.settings.get'], success: 'Weekly policy scheduled', silent: true });
  const [form, setForm] = useState({ date: me.today, type: 'HOLIDAY' as 'HOLIDAY' | 'WORKING_DAY', name: '', description: '', departmentId: '' });
  const [error, setError] = useState<string | null>(null);
  const current = q.data?.policies[0];
  const [weekdays, setWeekdays] = useState<number[] | null>(null);
  const [effective, setEffective] = useState(addDays(me.today, 1));
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<string | null>(null);
  const days = weekdays ?? current?.workingWeekdays ?? [];
  const upcoming = useOp('calendar.month', { month: addDays(`${month}-28`, 7).slice(0, 7), departmentId: null });
  const exceptions = [...(q.data?.exceptions ?? []), ...(upcoming.data?.exceptions ?? [])].filter((e) => e.date >= me.today);

  return (
    <div className="space-y-5">
      <PageHeader title="Work calendar" description="Past dates are locked to keep history accurate" />
      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <CalendarView admin />
        <div className="space-y-4">
          <Card>
            <CardHeader title="Declare a holiday or working day" description="E.g. mark a Wednesday as a working day, or add a company holiday." />
            <CardBody className="space-y-3">
              {error && <Notice tone="danger">{error}</Notice>}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Date" required>{(p) => <Input {...p} type="date" min={me.today} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />}</Field>
                <Field label="Type" required>{(p) => <Select {...p} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as typeof form.type })}><option value="HOLIDAY">Holiday — no report expected</option><option value="WORKING_DAY">Working day — reports expected</option></Select>}</Field>
              </div>
              <Field label="Name" required>{(p) => <Input {...p} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Diwali, Quarter-end working day" />}</Field>
              <Field label="Applies to" hint="A department-specific entry takes precedence over a company-wide one.">{(p) => <Select {...p} value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}><option value="">Whole company</option>{departments.items.map((d) => <option key={d.id} value={d.id}>{d.name} only</option>)}</Select>}</Field>
              <Field label="Description">{(p) => <Textarea {...p} rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />}</Field>
              <Button loading={upsert.isPending} onClick={() => { setError(null); upsert.mutate({ ...form, departmentId: form.departmentId || null }, { onSuccess: () => setForm({ ...form, name: '', description: '' }), onError: (e) => setError(e.message) }); }}>
                <Plus /> Save calendar entry
              </Button>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Weekly working-day policy" description={current ? `In effect since ${fmtDate(current.effectiveFrom)}${current.note ? ` — ${current.note}` : ''}` : undefined} />
            <CardBody className="space-y-3">
              {policyError && <Notice tone="danger">{policyError}</Notice>}
              <fieldset>
                <legend className="mb-2 text-sm font-medium">Working weekdays</legend>
                <div className="flex flex-wrap gap-3">
                  {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                    <Checkbox key={d} label={WEEKDAY_NAMES[d]!.slice(0, 3)} checked={days.includes(d)} onChange={(e) => setWeekdays(e.target.checked ? [...days, d] : days.filter((x) => x !== d))} />
                  ))}
                </div>
              </fieldset>
              <Field label="Effective from" hint="Takes effect from this date; earlier dates keep the old policy.">{(p) => <Input {...p} type="date" min={me.today} value={effective} onChange={(e) => setEffective(e.target.value)} />}</Field>
              <Button variant="outline" disabled={!weekdays} loading={policy.isPending} onClick={() => { setPolicyError(null); policy.mutate({ effectiveFrom: effective, workingWeekdays: days, note: '' }, { onSuccess: () => setWeekdays(null), onError: (e) => setPolicyError(e.message) }); }}>
                Schedule policy change
              </Button>
              {q.data && q.data.policies.length > 1 && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Policy history ({q.data.policies.length})</summary>
                  <ul className="mt-2 space-y-1">
                    {q.data.policies.map((p) => <li key={p.effectiveFrom}>From {fmtDate(p.effectiveFrom)}: {p.workingWeekdays.map((w) => WEEKDAY_NAMES[w]?.slice(0, 3)).join(', ')}</li>)}
                  </ul>
                </details>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
      <Card>
        <CardHeader title="Upcoming declared exceptions" />
        <DataTable
          caption="Calendar exceptions"
          rows={exceptions}
          rowKey={(e) => e.id}
          empty="No upcoming exceptions"
          columns={[
            { key: 'd', header: 'Date', sort: (e) => e.date, cell: (e) => fmtDate(e.date) },
            { key: 't', header: 'Type', cell: (e) => <StatusBadge status={e.type === 'HOLIDAY' ? 'HOLIDAY' : 'ACTIVE'} label={e.type === 'HOLIDAY' ? 'Holiday' : 'Working day'} /> },
            { key: 'n', header: 'Name', cell: (e) => e.name },
            { key: 's', header: 'Applies to', cell: (e) => (e.departmentId ? departments.name(e.departmentId) : 'Whole company') },
            { key: 'a', header: '', cell: (e) => <Button variant="ghost" size="sm" onClick={() => setToDelete(e.id)}><Trash2 /> Remove</Button> },
          ]}
          initialSort={{ key: 'd', dir: 'asc' }}
        />
      </Card>
      <ConfirmDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)} title="Remove calendar entry?" description="The date reverts to the weekly policy." confirmLabel="Remove" tone="destructive" requireReason loading={del.isPending} onConfirm={(reason) => toDelete && del.mutate({ id: toDelete, reason }, { onSuccess: () => setToDelete(null) })} />
    </div>
  );
}

/** Audited administrative correction of a submitted daily report (including its work date). */
export function CorrectDailyPage() {
  const { id = '' } = useParams();
  const q = useOp('daily.get', { reportId: id });
  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} />;
  return <CorrectDailyForm key={q.data.report.version} data={q.data} />;
}

function CorrectDailyForm({ data }: { data: NonNullable<ReturnType<typeof useOp<'daily.get'>>['data']> }) {
  const me = useMe();
  const navigate = useNavigate();
  const r = data.report;
  const people = useMemo(() => new Map(Object.entries(data.people).map(([pid, p]) => [pid, { id: pid, ...p }])), [data.people]);
  const [workDate, setWorkDate] = useState(r.workDate);
  const [tasks, setTasks] = useState<FormTask[]>(r.tasks.map((t: TaskEntry) => fromEntry(t, people)));
  const [notes, setNotes] = useState(r.employeeNotes);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projects = useOp('lookup.projects', { includeAll: true });
  const m = useOpMutation('admin.daily.correct', { invalidate: ['daily.get', 'daily.list'], silent: true });
  return (
    <div className="space-y-5">
      <PageHeader back={{ to: `/admin/reports/daily/${r.id}`, label: 'Report' }} title="Administrative correction" description={`${data.employee.fullName} · ${fmtDate(r.workDate)} · current version ${r.version}`} />
      <Notice tone="warning" title="Corrections are audited">
        Saving creates version {r.version + 1} marked as an administrator correction. The original submission stays in the version history{r.reviewStatus === 'APPROVED' ? ' and, per policy, the approved report may go back for re-review' : ''}. The employee is notified.
      </Notice>
      {error && <Notice tone="danger">{error}</Notice>}
      <Card>
        <CardBody className="grid gap-4 md:grid-cols-2">
          <Field label="Work date" hint="Correct an incorrectly entered date. The new date must not already have a report.">{(p) => <Input {...p} type="date" max={me.today} value={workDate} onChange={(e) => setWorkDate(e.target.value)} />}</Field>
          <Field label="Employee notes">{(p) => <Textarea {...p} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />}</Field>
        </CardBody>
      </Card>
      {tasks.map((t, i) => (
        <TaskCard
          key={i}
          index={i}
          task={t}
          errors={{}}
          isPrimary={i < me.settings.primaryTaskSlots}
          onChange={(p) => setTasks((prev) => prev.map((x, j) => (j === i ? { ...x, ...p } : x)))}
          onRemove={tasks.length > 1 ? () => setTasks((prev) => prev.filter((_, j) => j !== i)) : undefined}
          projects={projects.data?.items ?? []}
          categories={me.settings.taskCategories}
          allowOvernight={me.settings.allowOvernightTasks}
          allowProjectRequests={false}
          onRequestProject={() => undefined}
          workDate={workDate}
          selfId={r.employeeId}
        />
      ))}
      {tasks.length < 10 && <Button variant="outline" onClick={() => setTasks((p) => [...p, blankTask()])}><Plus /> Add task</Button>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => navigate(-1)}>Cancel</Button>
        <Button variant="warning" onClick={() => setConfirm(true)}><ShieldAlert /> Save correction</Button>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Save administrative correction?"
        description="A reason is required and is shown to the employee and in the audit log."
        confirmLabel="Save correction"
        tone="warning"
        requireReason
        reasonLabel="Correction reason"
        loading={m.isPending}
        onConfirm={(reason) => {
          setError(null);
          m.mutate(
            { reportId: r.id, workDate: workDate !== r.workDate ? workDate : undefined, tasks: tasks.filter((t) => !isBlank(t)).map(toInput), employeeNotes: notes, reason, expectedVersion: r.version },
            { onSuccess: () => { toast.success('Correction saved as a new version'); navigate(`/admin/reports/daily/${r.id}`); }, onError: (e) => { setConfirm(false); setError(e.message); } },
          );
        }}
      />
    </div>
  );
}

export function CorrectWeeklyPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const q = useOp('weekly.get', { reportId: id });
  const [narrative, setNarrative] = useState<Record<string, string> | null>(null);
  const [recalc, setRecalc] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const m = useOpMutation('admin.weekly.correct', { invalidate: ['weekly.get', 'weekly.list'], silent: true });
  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} />;
  const r = q.data.report;
  const n = narrative ?? (r.narrative as unknown as Record<string, string>);
  return (
    <div className="space-y-5">
      <PageHeader back={{ to: `/admin/reports/weekly/${r.id}`, label: 'Report' }} title="Correct weekly report" description={`${q.data.employee.fullName} · ${fmtDate(r.periodStart)} – ${fmtDate(r.periodEnd)}`} />
      <Notice tone="warning">Saving creates version {r.version + 1}; the original stays in history and the change is audited.</Notice>
      {error && <Notice tone="danger">{error}</Notice>}
      <Card>
        <CardBody className="grid gap-4 md:grid-cols-2">
          {NARRATIVE_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} className={f.required ? 'md:col-span-2' : ''}>{(p) => <Textarea {...p} rows={3} value={n[f.key] ?? ''} onChange={(e) => setNarrative({ ...n, [f.key]: e.target.value })} />}</Field>
          ))}
          <Checkbox className="md:col-span-2" label="Recalculate the automatic summary from current daily reports" checked={recalc} onChange={(e) => setRecalc(e.target.checked)} />
        </CardBody>
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => navigate(-1)}>Cancel</Button>
        <Button variant="warning" onClick={() => setConfirm(true)}><ShieldAlert /> Save correction</Button>
      </div>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Save correction?" confirmLabel="Save" tone="warning" requireReason reasonLabel="Correction reason" loading={m.isPending}
        onConfirm={(reason) => m.mutate({ reportId: r.id, narrative: n as never, reason, recalculate: recalc, expectedVersion: r.version }, { onSuccess: () => { toast.success('Correction saved'); navigate(`/admin/reports/weekly/${r.id}`); }, onError: (e) => { setConfirm(false); setError(e.message); } })} />
    </div>
  );
}

export function AuditLogPage() {
  const me = useMe();
  const [from, setFrom] = useState(addDays(me.today, -30));
  const [to, setTo] = useState(me.today);
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [entityId, setEntityId] = useState('');
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [selected, setSelected] = useState<AuditLogDoc | null>(null);
  const cursor = cursors[cursors.length - 1] ?? null;
  const q = useOp('admin.audit.list', { from, to, entityType: entityType || null, action: action || null, actorId: null, entityId: entityId.trim() || null, cursor, pageSize: 200 }, { placeholderData: (p) => p });
  const reset = () => setCursors([null]);
  return (
    <div className="space-y-5">
      <PageHeader title="Audit history" description="Read-only record of sensitive actions" />
      <FilterBar onReset={() => { setEntityType(''); setAction(''); setEntityId(''); reset(); }}>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">From<Input type="date" value={from} max={to} onChange={(e) => { setFrom(e.target.value); reset(); }} className="w-40" /></label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">To<Input type="date" value={to} min={from} onChange={(e) => { setTo(e.target.value); reset(); }} className="w-40" /></label>
        <FilterSelect label="Entity" value={entityType} onChange={(v) => { setEntityType(v); reset(); }} options={['user', 'dailyReport', 'weeklyReport', 'project', 'department', 'workCalendar', 'systemSettings', 'registrationRequest', 'export'].map((x) => ({ value: x, label: x }))} />
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">Action<Input value={action} onChange={(e) => { setAction(e.target.value.toUpperCase()); reset(); }} placeholder="e.g. USER_ROLE_CHANGED" className="w-56" /></label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">Record ID<Input value={entityId} onChange={(e) => { setEntityId(e.target.value); reset(); }} className="w-48" /></label>
      </FilterBar>
      {q.error ? <ErrorState error={q.error} /> : (
        <Card>
          <DataTable
            caption="Audit events"
            loading={q.isLoading}
            rows={q.data?.items ?? []}
            rowKey={(a) => a.id}
            onRowClick={setSelected}
            pageSize={200}
            columns={[
              { key: 't', header: 'Time', cell: (a) => <span className="whitespace-nowrap text-xs">{fmtDateTime(a.timestamp)}</span> },
              { key: 'a', header: 'Action', cell: (a) => <code className="text-xs">{a.action}</code> },
              { key: 'u', header: 'Actor', cell: (a) => <span>{a.actorName} <span className="text-xs text-muted-foreground">{a.actorRole}</span></span> },
              { key: 'e', header: 'Record', cell: (a) => <span className="text-xs">{a.entityType} · <span className="font-mono">{a.entityId.slice(0, 12)}</span></span>, hideOnMobile: true },
              { key: 'r', header: 'Reason', cell: (a) => <span className="block max-w-xs truncate text-xs">{a.reason || '—'}</span>, hideOnMobile: true },
            ]}
            empty="No audit events match"
          />
          <div className="flex items-center justify-between border-t px-4 py-2.5 text-xs">
            <Button variant="outline" size="sm" disabled={cursors.length <= 1} onClick={() => setCursors((c) => c.slice(0, -1))}>Newer</Button>
            <span className="text-muted-foreground">Page {cursors.length}</span>
            <Button variant="outline" size="sm" disabled={!q.data?.nextCursor} onClick={() => setCursors((c) => [...c, q.data?.nextCursor ?? null])}>Older</Button>
          </div>
        </Card>
      )}
      {selected && (
        <Dialog open onOpenChange={(o) => !o && setSelected(null)} title={selected.action} description={`${selected.actorName} (${selected.actorRole}) · ${fmtDateTime(selected.timestamp)}`} wide>
          <DefinitionList items={[['Record', `${selected.entityType} / ${selected.entityId}`], ['Reason', selected.reason || '—'], ['Request ID', selected.requestCorrelationId]]} />
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div><p className="mb-1 text-xs font-semibold text-muted-foreground">Before</p><pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(selected.beforeSnapshot, null, 2) ?? '—'}</pre></div>
            <div><p className="mb-1 text-xs font-semibold text-muted-foreground">After</p><pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(selected.afterSnapshot, null, 2) ?? '—'}</pre></div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

const NOTIF_LABELS: Record<NotificationType, string> = {
  DAILY_SUBMITTED: 'Daily report submission confirmation',
  WEEKLY_SUBMITTED: 'Weekly report submission confirmation',
  REPORT_APPROVED: 'Report approved',
  REPORT_RETURNED: 'Report returned for correction',
  FEEDBACK_RECEIVED: 'Manager feedback / admin correction',
  REVIEW_REQUESTED: 'New report awaiting review (managers)',
  COLLABORATOR_ADDED: 'Added as a collaborator on someone’s task',
  TASK_STATUS_UPDATED: 'A team member changed a submitted task’s status (managers)',
  TASK_OVERDUE: 'Overdue task',
  DEADLINE_UPCOMING: 'Reminders to complete the 3 priority tasks (at the reminder times)',
  ACCOUNT_ACTIVATED: 'Account activation',
  MANAGER_REASSIGNED: 'Reporting Manager reassignment',
  PROJECT_ASSIGNED: 'Made project lead or reviewer',
};

export function SettingsPage() {
  const q = useOp('admin.settings.get', {});
  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} />;
  return <SettingsForm key={q.data.settings.updatedAt} initial={q.data.settings} />;
}

function SettingsForm({ initial }: { initial: SystemSettings }) {
  const [s, setS] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const save = useOpMutation('admin.settings.update', { invalidate: ['admin.settings.get', 'me.get'], success: 'Settings saved', silent: true });
  const set = <K extends keyof SystemSettings>(k: K, v: SystemSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  const changes = Object.fromEntries((Object.keys(s) as (keyof SystemSettings)[]).filter((k) => !['calendarPolicies', 'updatedAt', 'updatedBy'].includes(k) && JSON.stringify(s[k]) !== JSON.stringify(initial[k])).map((k) => [k, s[k]]));
  const num = (k: keyof SystemSettings, label: string, min: number, max: number, hint?: string) => (
    <Field label={label} hint={hint}>{(p) => <Input {...p} type="number" min={min} max={max} value={s[k] as number} onChange={(e) => set(k, Number(e.target.value) as never)} />}</Field>
  );
  return (
    <div className="space-y-5">
      <PageHeader title="System settings" description={`Last updated ${fmtDateTime(initial.updatedAt)}. Every change is audited.`} actions={<Button disabled={!Object.keys(changes).length} onClick={() => setConfirm(true)}>Save {Object.keys(changes).length || ''} change{Object.keys(changes).length === 1 ? '' : 's'}</Button>} />
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Company & reporting period" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Company name">{(p) => <Input {...p} value={s.companyName} onChange={(e) => set('companyName', e.target.value)} />}</Field>
            <Field label="Timezone" hint="IANA name, e.g. Asia/Kolkata">{(p) => <Input {...p} value={s.timezone} onChange={(e) => set('timezone', e.target.value)} />}</Field>
            <Field label="Weekly period starts on">{(p) => <Select {...p} value={s.weekStartDay} onChange={(e) => set('weekStartDay', Number(e.target.value))}>{WEEKDAY_NAMES.map((d, i) => <option key={d} value={i}>{d}</option>)}</Select>}</Field>
            <div className="sm:col-span-2">
              <p className="text-[13px] font-medium">Priority-task reminders</p>
              <p className="mb-2 mt-0.5 text-[12px] text-muted-foreground">Times (company time) to remind everyone who hasn’t submitted today’s 3 priority tasks, with a sound.</p>
              <div className="flex flex-wrap items-center gap-2">
                {s.reminderTimes.map((t, i) => (
                  <span key={i} className="flex items-center gap-0.5">
                    <Input type="time" aria-label={`Reminder ${i + 1}`} value={t} className="w-[148px]" onChange={(e) => set('reminderTimes', s.reminderTimes.map((x, j) => (j === i ? e.target.value : x)))} />
                    {s.reminderTimes.length > 1 && (
                      <Button variant="ghost" size="icon" aria-label={`Remove reminder ${i + 1}`} onClick={() => set('reminderTimes', s.reminderTimes.filter((_, j) => j !== i))}>
                        <Trash2 />
                      </Button>
                    )}
                  </span>
                ))}
                {s.reminderTimes.length < 6 && (
                  <Button variant="outline" size="sm" onClick={() => set('reminderTimes', [...s.reminderTimes, '17:00'])}>
                    <Plus /> Add time
                  </Button>
                )}
              </div>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Deadlines & grace period" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            {num('dailyDeadlineDayOffset', 'Daily deadline: days after work date', 0, 3, '0 = same day')}
            <Field label="Daily deadline time">{(p) => <Input {...p} type="time" value={s.dailyDeadlineTime} onChange={(e) => set('dailyDeadlineTime', e.target.value)} />}</Field>
            {num('dailyGraceMinutes', 'Grace period (minutes)', 0, 1440)}
            {num('maxBackdateDays', 'Self-service backdating window (days)', 0, 60)}
            {num('weeklyDeadlineDayOffset', 'Weekly deadline: days after period end', 0, 7)}
            <Field label="Weekly deadline time">{(p) => <Input {...p} type="time" value={s.weeklyDeadlineTime} onChange={(e) => set('weeklyDeadlineTime', e.target.value)} />}</Field>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Daily task policy" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            {num('primaryTaskSlots', 'Primary task slots', 1, 5)}
            {num('minTasksForSubmission', 'Minimum tasks to submit', 1, 5)}
            <Checkbox label="Allow additional tasks" checked={s.allowAdditionalTasks} onChange={(e) => set('allowAdditionalTasks', e.target.checked)} />
            {num('maxAdditionalTasks', 'Max additional tasks', 0, 5)}
            <Checkbox label="Allow overnight work entries" checked={s.allowOvernightTasks} onChange={(e) => set('allowOvernightTasks', e.target.checked)} />
            <Checkbox label="Employees can request projects" checked={s.allowProjectRequests} onChange={(e) => set('allowProjectRequests', e.target.checked)} />
            <Field label="Task categories" hint="One per line" className="sm:col-span-2">{(p) => <Textarea {...p} rows={4} value={s.taskCategories.join('\n')} onChange={(e) => set('taskCategories', e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))} />}</Field>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Access & review policy" />
          <CardBody className="space-y-4">
            <Checkbox label="Allow self-registration requests (always pending admin approval)" checked={s.allowSelfRegistration} onChange={(e) => set('allowSelfRegistration', e.target.checked)} />
            <Checkbox label="Send approved reports back for re-review after an admin correction" checked={s.reReviewOnAdminCorrection} onChange={(e) => set('reReviewOnAdminCorrection', e.target.checked)} />
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Roles that submit daily and weekly reports</legend>
              <div className="flex flex-wrap gap-4">
                {ROLES.map((r) => <Checkbox key={r} label={ROLE_LABELS[r]} checked={s.reportingRoles.includes(r)} onChange={(e) => set('reportingRoles', e.target.checked ? [...s.reportingRoles, r] : s.reportingRoles.filter((x: Role) => x !== r))} />)}
              </div>
            </fieldset>
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="In-app notifications" description="Email delivery is not configured; notifications appear in the app only." />
          <CardBody className="grid gap-3 sm:grid-cols-2">
            {NOTIFICATION_TYPES.map((t) => <Checkbox key={t} label={NOTIF_LABELS[t]} checked={s.notificationTypesEnabled[t]} onChange={(e) => set('notificationTypesEnabled', { ...s.notificationTypesEnabled, [t]: e.target.checked })} />)}
          </CardBody>
        </Card>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Save system settings?"
        description={`Changing: ${Object.keys(changes).join(', ')}. Changes apply to all users immediately.`}
        confirmLabel="Save"
        tone="warning"
        loading={save.isPending}
        onConfirm={(reason) => { setError(null); save.mutate({ changes: changes as never, reason }, { onSuccess: () => setConfirm(false), onError: (e) => { setConfirm(false); setError(errorMessage(e)); } }); }}
      />
    </div>
  );
}
