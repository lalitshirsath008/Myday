import { zodResolver } from '@hookform/resolvers/zod';
import { ACCOUNT_STATUSES, employeeFields, password as passwordSchema, PERMISSION_LABELS, PERMISSIONS, ROLE_LABELS, ROLES, type Permission, type Role } from '@rgk/core';
import { Check, Copy, Eye, EyeOff, GitBranch, KeyRound, Link2, MoreHorizontal, Pencil, Power, ShieldCheck, Trash2, UserPlus, Wand2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { DataTable, type Column } from '@/components/common/DataTable';
import { FilterBar, FilterSelect, useDepartments } from '@/components/common/filters';
import { PageHeader } from '@/components/common/layout';
import { PeoplePicker, type PickedPerson } from '@/components/common/PeoplePicker';
import { StatusBadge, statusLabel } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { ErrorState, Menu, Notice, PageSkeleton } from '@/components/ui/misc';
import { api, errorMessage, useOp, useOpMutation } from '@/lib/api';
import { useMe } from '@/lib/session';
import { fmtDate, fmtDateTime } from '@/lib/utils';

type DirRow = NonNullable<ReturnType<typeof useOp<'directory.list'>>['data']>['items'][number];

/** Easy-to-read random password: "Rgk" + 4 digits + 2 letters (meets the 8+ chars, letters + number rule). */
export function generatePassword(): string {
  const r = crypto.getRandomValues(new Uint32Array(6));
  const digits = Array.from(r.slice(0, 4), (n) => String(n % 10)).join('');
  const letters = Array.from(r.slice(4), (n) => 'abcdefghjkmnpqrstuvwxyz'[n % 23]).join('');
  return `Rgk${digits}${letters}`;
}

/** Password box with show/hide and a Generate button. */
export function PasswordPicker({ value, onChange, error, label = 'Password' }: { value: string; onChange: (v: string) => void; error?: string; label?: string }) {
  const [show, setShow] = useState(false);
  return (
    <Field label={label} required error={error} hint="8+ characters with letters and a number">
      {(p) => (
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input {...p} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="new-password" className="pr-10" />
            <button type="button" onClick={() => setShow((x) => !x)} className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:text-foreground" aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          <Button type="button" variant="outline" onClick={() => { onChange(generatePassword()); setShow(true); }}>
            <Wand2 /> Generate
          </Button>
        </div>
      )}
    </Field>
  );
}

/** After creating an account: the sign-in details the admin just chose, ready to share. */
function AccountReadyDialog({ details, onClose }: { details: { fullName: string; code: string; phone: string; password: string; mustChange: boolean }; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = `RGK Myday sign-in\nEmployee code: ${details.code}\nMobile: ${details.phone}\nPassword: ${details.password}`;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`${details.fullName} can sign in now`} description="The account is active. Share these details with the employee in person or on official chat." footer={<Button onClick={onClose}>Done</Button>}>
      <div className="space-y-2 rounded-2xl bg-muted/60 p-4 text-sm">
        <p className="flex justify-between gap-3"><span className="text-muted-foreground">Employee code</span><span className="font-semibold">{details.code}</span></p>
        <p className="flex justify-between gap-3"><span className="text-muted-foreground">or mobile</span><span className="font-semibold">{details.phone}</span></p>
        <p className="flex justify-between gap-3"><span className="text-muted-foreground">Password</span><span className="font-mono font-semibold">{details.password}</span></p>
      </div>
      <Button
        variant="outline"
        className="mt-3 w-full"
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        }}
      >
        {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy sign-in details'}
      </Button>
      {details.mustChange && <p className="mt-3 text-xs text-muted-foreground">They will be asked to choose their own password the first time they sign in.</p>}
    </Dialog>
  );
}

/** Admin sets a new password directly — existing passwords can never be viewed. */
export function SetPasswordDialog({ user, onClose }: { user: { id: string; fullName: string }; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const [mustChange, setMustChange] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const m = useOpMutation('admin.users.setPassword', { invalidate: ['directory.list', 'admin.users.get'], silent: true });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Set new password — ${user.fullName}`}
      description="Their other sessions are signed out. Share the new password with them directly."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={m.isPending}
            onClick={() => {
              const check = passwordSchema.safeParse(pw);
              if (!check.success) return setError(check.error.issues[0]?.message);
              m.mutate({ userId: user.id, password: pw, requirePasswordChange: mustChange, reason: '' }, { onSuccess: () => { toast.success(`New password set for ${user.fullName}`); onClose(); }, onError: (e) => setError(e.message) });
            }}
          >
            <KeyRound /> Set password
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <PasswordPicker value={pw} onChange={(v) => { setPw(v); setError(undefined); }} error={error} label="New password" />
        <Checkbox label="Ask them to choose their own password at next sign-in" checked={mustChange} onChange={(e) => setMustChange(e.target.checked)} />
      </div>
    </Dialog>
  );
}

/** Permanent deletion: only for deactivated/archived accounts, typed employee code + reason. Audit history is kept. */
export function DeleteEmployeeDialog({ user, onClose, onDeleted }: { user: { id: string; fullName: string; employeeCode: string }; onClose: () => void; onDeleted?: () => void }) {
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const m = useOpMutation('admin.users.delete', { invalidate: ['directory.list', 'admin.dashboard'], silent: true });
  const ready = code.trim().toUpperCase() === user.employeeCode.toUpperCase() && reason.trim().length >= 3;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Delete ${user.fullName} permanently?`}
      description="This cannot be undone."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!ready}
            loading={m.isPending}
            onClick={() =>
              m.mutate(
                { userId: user.id, confirmCode: code, reason },
                {
                  onSuccess: (r) => {
                    toast.success(`${user.fullName} deleted (${r.dailyReports} daily reports removed)`);
                    onDeleted?.();
                    onClose();
                  },
                  onError: (e) => setError(e.message),
                },
              )
            }
          >
            <Trash2 /> Delete permanently
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="rounded-2xl bg-danger-soft p-3.5 text-[13px] text-foreground/85">
          <p className="font-semibold text-danger">This will delete:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            <li>their sign-in account and profile</li>
            <li>all their daily and weekly reports, tasks and review history</li>
            <li>their notifications and “My day” lists</li>
          </ul>
          <p className="mt-2 text-muted-foreground">Kept: the audit history, and reviews they wrote on other people’s reports.</p>
        </div>
        <Field label={`Type ${user.employeeCode} to confirm`} required>
          {(p) => <Input {...p} value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" autoComplete="off" placeholder={user.employeeCode} />}
        </Field>
        <Field label="Reason (saved in the audit log)" required>
          {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Duplicate account / left the company" />}
        </Field>
      </div>
    </Dialog>
  );
}

export function UsersPage() {
  const navigate = useNavigate();
  const me = useMe();
  const departments = useDepartments();
  const [query, setQuery] = useState('');
  const [dept, setDept] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const q = useOp('directory.list', { query, departmentId: dept || null, role: (role || null) as Role | null, status: (status || null) as never, managerId: null, limit: 50, offset: page * 50 }, { placeholderData: (p) => p });
  const [statusAction, setStatusAction] = useState<{ user: DirRow; status: 'ACTIVE' | 'DEACTIVATED' | 'ARCHIVED' } | null>(null);
  const [roleAction, setRoleAction] = useState<DirRow | null>(null);
  const [pwFor, setPwFor] = useState<DirRow | null>(null);
  const [deleteFor, setDeleteFor] = useState<DirRow | null>(null);
  const setStatusM = useOpMutation('admin.users.setStatus', { invalidate: ['directory.list', 'admin.dashboard'], success: 'Account status updated' });

  const columns: Column<DirRow>[] = [
    { key: 'n', header: 'Employee', cell: (r) => <Link to={`/admin/users/${r.id}`} className="font-medium hover:underline">{r.fullName} <span className="text-xs font-normal text-muted-foreground">{r.employeeCode}</span></Link> },
    { key: 'd', header: 'Department', cell: (r) => r.departmentName },
    { key: 'r', header: 'Role', cell: (r) => ROLE_LABELS[r.role] },
    { key: 'm', header: 'Reporting Manager', cell: (r) => r.managerName ?? <span className="text-warning">Not assigned</span>, hideOnMobile: true },
    { key: 's', header: 'Status', cell: (r) => <StatusBadge status={r.accountStatus} /> },
    {
      key: 'a',
      header: <span className="sr-only">Actions</span>,
      cell: (r) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Menu
            trigger={
              <Button variant="ghost" size="icon" aria-label={`Actions for ${r.fullName}`}>
                <MoreHorizontal />
              </Button>
            }
            items={[
              { label: <><Pencil /> Edit profile</>, onSelect: () => navigate(`/admin/users/${r.id}`) },
              { label: <><ShieldCheck /> Change role</>, onSelect: () => setRoleAction(r), disabled: r.id === me.user.id },
              { label: <><GitBranch /> Assign Reporting Manager</>, onSelect: () => navigate(`/admin/users/${r.id}#managers`) },
              {
                label: <><KeyRound /> Set new password</>,
                disabled: r.accountStatus === 'DEACTIVATED' || r.accountStatus === 'ARCHIVED' || r.id === me.user.id,
                onSelect: () => setPwFor(r),
              },
              { label: <><Link2 /> View reporting history</>, onSelect: () => navigate(`/employees/${r.id}`) },
              'separator',
              r.accountStatus === 'ACTIVE' || r.accountStatus === 'PENDING_ACTIVATION'
                ? { label: <><Power /> Deactivate</>, danger: true, disabled: r.id === me.user.id, onSelect: () => setStatusAction({ user: r, status: 'DEACTIVATED' }) }
                : { label: <><Power /> Reactivate</>, onSelect: () => setStatusAction({ user: r, status: 'ACTIVE' }) },
              ...(r.accountStatus === 'DEACTIVATED' ? [{ label: <><X /> Archive</>, danger: true, onSelect: () => setStatusAction({ user: r, status: 'ARCHIVED' }) }] : []),
              r.accountStatus === 'DEACTIVATED' || r.accountStatus === 'ARCHIVED'
                ? { label: <><Trash2 /> Delete permanently</>, danger: true, disabled: r.id === me.user.id, onSelect: () => setDeleteFor(r) }
                : { label: <><Trash2 /> Delete (deactivate first)</>, disabled: true, onSelect: () => undefined },
            ]}
          />
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Employees"
        actions={
          <Button asChild>
            <Link to="/admin/users/new">
              <UserPlus /> Add employee
            </Link>
          </Button>
        }
      />
      <FilterBar onReset={() => { setQuery(''); setDept(''); setRole(''); setStatus(''); setPage(0); }}>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Search
          <Input value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder="Name, code, mobile…" className="w-60" />
        </label>
        <FilterSelect label="Department" value={dept} onChange={(v) => { setDept(v); setPage(0); }} options={departments.items.map((d) => ({ value: d.id, label: d.name }))} />
        <FilterSelect label="Role" value={role} onChange={(v) => { setRole(v); setPage(0); }} options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
        <FilterSelect label="Account status" value={status} onChange={(v) => { setStatus(v); setPage(0); }} options={ACCOUNT_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))} />
      </FilterBar>
      {q.error ? <ErrorState error={q.error} /> : (
        <Card>
          <DataTable caption="Users" columns={columns} rows={q.data?.items ?? []} rowKey={(r) => r.id} loading={q.isLoading} onRowClick={(r) => navigate(`/admin/users/${r.id}`)} pageSize={50} server={{ page, total: q.data?.total ?? 0, onPageChange: setPage }} />
        </Card>
      )}
      {statusAction && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setStatusAction(null)}
          title={`${statusAction.status === 'ACTIVE' ? 'Reactivate' : statusAction.status === 'ARCHIVED' ? 'Archive' : 'Deactivate'} ${statusAction.user.fullName}?`}
          description={statusAction.status === 'ACTIVE' ? 'The employee can sign in again. Their history is unchanged.' : 'The employee is signed out everywhere and cannot sign in. Reports and audit history are kept.'}
          confirmLabel={statusAction.status === 'ACTIVE' ? 'Reactivate' : statusAction.status === 'ARCHIVED' ? 'Archive' : 'Deactivate'}
          tone={statusAction.status === 'ACTIVE' ? 'default' : 'destructive'}
          requireReason
          loading={setStatusM.isPending}
          onConfirm={(reason) => setStatusM.mutate({ userId: statusAction.user.id, status: statusAction.status, reason }, { onSuccess: () => setStatusAction(null) })}
        />
      )}
      {roleAction && <ChangeRoleDialog user={roleAction} onClose={() => setRoleAction(null)} />}
      {pwFor && <SetPasswordDialog user={pwFor} onClose={() => setPwFor(null)} />}
      {deleteFor && <DeleteEmployeeDialog user={deleteFor} onClose={() => setDeleteFor(null)} />}
    </div>
  );
}

function ChangeRoleDialog({ user, onClose }: { user: { id: string; fullName: string; role: Role }; onClose: () => void }) {
  const [role, setRole] = useState<Role>(user.role);
  const [confirm, setConfirm] = useState(false);
  const m = useOpMutation('admin.users.changeRole', { invalidate: ['directory.list', 'admin.users.get', 'admin.dashboard'], success: 'Role changed' });
  return (
    <>
      <Dialog open={!confirm} onOpenChange={(o) => !o && onClose()} title={`Change role — ${user.fullName}`} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={role === user.role} onClick={() => setConfirm(true)}>Continue</Button></>}>
        <Field label="New role">
          {(p) => (
            <Select {...p} value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
          {(Object.keys(PERMISSIONS) as Permission[]).filter((p) => (PERMISSIONS[p] as readonly Role[]).includes(role)).map((p) => (
            <li key={p}>• {PERMISSION_LABELS[p]}</li>
          ))}
        </ul>
      </Dialog>
      <ConfirmDialog
        open={confirm}
        onOpenChange={(o) => { if (!o) { setConfirm(false); } }}
        title={`Change ${user.fullName} from ${ROLE_LABELS[user.role]} to ${ROLE_LABELS[role]}?`}
        description="Access changes immediately. This is recorded in the audit log."
        confirmLabel="Change role"
        tone="warning"
        requireReason
        loading={m.isPending}
        onConfirm={(reason) => m.mutate({ userId: user.id, role, reason }, { onSuccess: onClose })}
      />
    </>
  );
}

type EmployeeForm = { fullName: string; employeeCode: string; phoneNumber: string; officialEmail: string | null; departmentId: string; designation: string; role: Role; primaryReportingManagerId: string | null; secondaryReviewerId: string | null; joinedAt: string | null };

/** Create a new employee (also used to approve a registration request). */
export function UserCreatePage({ prefill, requestId, onDone }: { prefill?: Partial<EmployeeForm>; requestId?: string; onDone?: () => void }) {
  const navigate = useNavigate();
  const departments = useDepartments();
  const [primary, setPrimary] = useState<PickedPerson[]>([]);
  const [secondary, setSecondary] = useState<PickedPerson[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [initialPassword, setInitialPassword] = useState('');
  const [pwError, setPwError] = useState<string | undefined>();
  const [mustChange, setMustChange] = useState(true);
  const [ready, setReady] = useState<{ fullName: string; code: string; phone: string; password: string; mustChange: boolean } | null>(null);
  const form = useForm<EmployeeForm>({
    resolver: zodResolver(employeeFields.omit({ primaryReportingManagerId: true, secondaryReviewerId: true }).extend({ primaryReportingManagerId: employeeFields.shape.primaryReportingManagerId, secondaryReviewerId: employeeFields.shape.secondaryReviewerId })) as never,
    defaultValues: { fullName: '', employeeCode: '', phoneNumber: '', officialEmail: '', departmentId: '', designation: '', role: 'EMPLOYEE', primaryReportingManagerId: null, secondaryReviewerId: null, joinedAt: null, ...prefill },
  });
  const { register, handleSubmit, formState } = form;
  const submit = handleSubmit(async (v) => {
    setError(null);
    const pwCheck = passwordSchema.safeParse(initialPassword);
    if (!pwCheck.success) return setPwError(pwCheck.error.issues[0]?.message);
    try {
      const input = { ...v, officialEmail: v.officialEmail || null, joinedAt: v.joinedAt || null, primaryReportingManagerId: primary[0]?.id ?? null, secondaryReviewerId: secondary[0]?.id ?? null, initialPassword, requirePasswordChange: mustChange };
      const res = requestId ? await api('admin.registrations.approve', { ...input, requestId }) : await api('admin.users.create', input);
      toast.success('Account created');
      setReady({ fullName: v.fullName, code: res.employeeCode, phone: v.phoneNumber, password: initialPassword, mustChange });
    } catch (e) {
      setError(errorMessage(e));
    }
  });
  return (
    <div className="space-y-5">
      {!requestId && <PageHeader back={{ to: '/admin/users', label: 'Employees' }} title="Add employee" description="The account works as soon as you create it" />}
      <Card>
        <CardBody>
          <form onSubmit={submit} className="grid gap-4 md:grid-cols-2" noValidate>
            {error && <Notice tone="danger" className="md:col-span-2">{error}</Notice>}
            <Field label="Full name" required error={formState.errors.fullName?.message}>{(p) => <Input {...p} {...register('fullName')} />}</Field>
            <Field label="Employee code" required error={formState.errors.employeeCode?.message} hint="Unique; used to sign in.">{(p) => <Input {...p} {...register('employeeCode')} autoCapitalize="characters" />}</Field>
            <Field label="Registered mobile" required error={formState.errors.phoneNumber?.message} hint="Unique; can also be used to sign in.">{(p) => <Input {...p} {...register('phoneNumber')} inputMode="tel" />}</Field>
            <Field label="Official email" error={formState.errors.officialEmail?.message} hint="Optional. Enables self-service password reset by email.">{(p) => <Input {...p} {...register('officialEmail')} type="email" />}</Field>
            <Field label="Department" required error={formState.errors.departmentId?.message}>
              {(p) => (
                <Select {...p} {...register('departmentId')}>
                  <option value="">Select…</option>
                  {departments.items.filter((d) => d.active).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Designation" required error={formState.errors.designation?.message}>{(p) => <Input {...p} {...register('designation')} />}</Field>
            <Field label="Role" required error={formState.errors.role?.message} hint="Management and Super Admin can only be granted here, never through self-registration.">
              {(p) => (
                <Select {...p} {...register('role')}>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Joining date" error={formState.errors.joinedAt?.message} hint="Reports are expected from this date.">{(p) => <Input {...p} {...register('joinedAt')} type="date" />}</Field>
            <div>
              <p className="mb-1.5 text-sm font-medium">Reporting Manager</p>
              <PeoplePicker single value={primary} onChange={setPrimary} filter={(p) => p.role === 'REPORTING_MANAGER'} placeholder="Search Reporting Managers…" ariaLabel="Reporting Manager" />
            </div>
            <div>
              <p className="mb-1.5 text-sm font-medium">Secondary reviewer (optional)</p>
              <PeoplePicker single value={secondary} onChange={setSecondary} filter={(p) => p.role === 'REPORTING_MANAGER'} exclude={primary.map((p) => p.id)} placeholder="Search Reporting Managers…" ariaLabel="Secondary reviewer" />
            </div>
            <div className="space-y-3 rounded-2xl border border-dashed p-4 md:col-span-2">
              <p className="text-sm font-semibold">Sign-in password</p>
              <PasswordPicker value={initialPassword} onChange={(v) => { setInitialPassword(v); setPwError(undefined); }} error={pwError} />
              <Checkbox label="Ask them to choose their own password at first sign-in" checked={mustChange} onChange={(e) => setMustChange(e.target.checked)} />
            </div>
            <div className="flex justify-end gap-2 md:col-span-2">
              <Button type="button" variant="outline" onClick={() => (onDone ? onDone() : navigate('/admin/users'))}>Cancel</Button>
              <Button type="submit" loading={formState.isSubmitting}><UserPlus /> {requestId ? 'Approve and create account' : 'Create employee'}</Button>
            </div>
          </form>
        </CardBody>
      </Card>
      {ready && <AccountReadyDialog details={ready} onClose={() => { setReady(null); if (onDone) onDone(); else navigate('/admin/users'); }} />}
    </div>
  );
}

export function UserEditPage() {
  const { id = '' } = useParams();
  const q = useOp('admin.users.get', { userId: id });
  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} />;
  return <UserEditor key={q.data.user.updatedAt} data={q.data} />;
}

function UserEditor({ data }: { data: NonNullable<ReturnType<typeof useOp<'admin.users.get'>>['data']> }) {
  const u = data.user;
  const departments = useDepartments();
  const [v, setV] = useState({ fullName: u.fullName, employeeCode: u.employeeCode, phoneNumber: u.phoneNumber, officialEmail: u.officialEmail ?? '', departmentId: u.departmentId, designation: u.designation, joinedAt: u.joinedAt ?? '' });
  const [confirm, setConfirm] = useState(false);
  const [roleDialog, setRoleDialog] = useState(false);
  const [pwDialog, setPwDialog] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState(false);
  const navigate = useNavigate();
  const me = useMe();
  const update = useOpMutation('admin.users.update', { invalidate: ['admin.users.get', 'directory.list'], success: 'Employee updated' });
  const managerIds = [u.primaryReportingManagerId, u.secondaryReviewerId].filter((x): x is string => !!x);
  const people = useOp('lookup.people', { ids: managerIds }, { enabled: managerIds.length > 0 });
  const sensitive = v.departmentId !== u.departmentId || v.employeeCode !== u.employeeCode || v.phoneNumber !== u.phoneNumber;
  const changes = useMemo(() => {
    const c: Record<string, unknown> = {};
    if (v.fullName !== u.fullName) c.fullName = v.fullName;
    if (v.employeeCode !== u.employeeCode) c.employeeCode = v.employeeCode;
    if (v.phoneNumber !== u.phoneNumber) c.phoneNumber = v.phoneNumber;
    if (v.officialEmail !== (u.officialEmail ?? '')) c.officialEmail = v.officialEmail || null;
    if (v.departmentId !== u.departmentId) c.departmentId = v.departmentId;
    if (v.designation !== u.designation) c.designation = v.designation;
    if (v.joinedAt !== (u.joinedAt ?? '')) c.joinedAt = v.joinedAt || null;
    return c;
  }, [v, u]);
  const save = (reason: string) => update.mutate({ userId: u.id, ...changes, reason }, { onSuccess: () => setConfirm(false) });

  return (
    <div className="space-y-5">
      <PageHeader back={{ to: '/admin/users', label: 'User management' }} title={u.fullName} description={`${u.employeeCode} · ${ROLE_LABELS[u.role]}`} actions={<><StatusBadge status={u.accountStatus} /><Button variant="outline" onClick={() => setRoleDialog(true)}><ShieldCheck /> Change role</Button><Button variant="outline" onClick={() => setPwDialog(true)} disabled={u.accountStatus === 'DEACTIVATED' || u.accountStatus === 'ARCHIVED'}><KeyRound /> Set new password</Button><Button asChild variant="outline"><Link to={`/employees/${u.id}`}>Reporting history</Link></Button></>} />
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Profile" description={`Sign-in identity: ${data.authEmail.endsWith('.invalid') ? 'employee code / mobile (no email on file)' : data.authEmail}`} />
          <CardBody>
            <form className="grid gap-4 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (sensitive) setConfirm(true); else save(''); }}>
              <Field label="Full name">{(p) => <Input {...p} value={v.fullName} onChange={(e) => setV({ ...v, fullName: e.target.value })} />}</Field>
              <Field label="Employee code">{(p) => <Input {...p} value={v.employeeCode} onChange={(e) => setV({ ...v, employeeCode: e.target.value.toUpperCase() })} />}</Field>
              <Field label="Registered mobile">{(p) => <Input {...p} value={v.phoneNumber} onChange={(e) => setV({ ...v, phoneNumber: e.target.value })} />}</Field>
              <Field label="Official email">{(p) => <Input {...p} type="email" value={v.officialEmail} onChange={(e) => setV({ ...v, officialEmail: e.target.value })} />}</Field>
              <Field label="Department">
                {(p) => <Select {...p} value={v.departmentId} onChange={(e) => setV({ ...v, departmentId: e.target.value })}>{departments.items.map((d) => <option key={d.id} value={d.id}>{d.name}{!d.active ? ' (inactive)' : ''}</option>)}</Select>}
              </Field>
              <Field label="Designation">{(p) => <Input {...p} value={v.designation} onChange={(e) => setV({ ...v, designation: e.target.value })} />}</Field>
              <Field label="Joining date">{(p) => <Input {...p} type="date" value={v.joinedAt} onChange={(e) => setV({ ...v, joinedAt: e.target.value })} />}</Field>
              <div className="flex items-end justify-end md:col-span-2">
                <Button type="submit" disabled={!Object.keys(changes).length} loading={update.isPending}>Save changes</Button>
              </div>
            </form>
          </CardBody>
        </Card>
        {people.isLoading ? <PageSkeleton /> : <ManagerAssignment key={`${u.primaryReportingManagerId}-${u.secondaryReviewerId}`} userId={u.id} userName={u.fullName} current={people.data?.items ?? []} primaryId={u.primaryReportingManagerId} secondaryId={u.secondaryReviewerId} reporteeCount={data.reporteeCount} />}
      </div>
      <Card>
        <CardHeader title="Account" />
        <CardBody className="grid gap-2 text-sm sm:grid-cols-3">
          <p><span className="text-muted-foreground">Created:</span> {fmtDateTime(u.createdAt)}</p>
          <p><span className="text-muted-foreground">Activated:</span> {fmtDateTime(u.activatedAt)}</p>
          <p><span className="text-muted-foreground">Deactivated:</span> {fmtDateTime(u.deactivatedAt)}</p>
          <p><span className="text-muted-foreground">Joined:</span> {fmtDate(u.joinedAt)}</p>
          <p><span className="text-muted-foreground">Employees reporting to them:</span> {data.reporteeCount}</p>
        </CardBody>
      </Card>
      {u.id !== me.user.id && (
        <Card className="border-danger/30">
          <CardHeader title="Danger zone" description={u.accountStatus === 'DEACTIVATED' || u.accountStatus === 'ARCHIVED' ? 'Delete this employee and all their reports. This cannot be undone.' : 'Deactivate the account first to enable permanent deletion.'} />
          <CardBody>
            <Button variant="destructive" disabled={u.accountStatus !== 'DEACTIVATED' && u.accountStatus !== 'ARCHIVED'} onClick={() => setDeleteDialog(true)}>
              <Trash2 /> Delete permanently
            </Button>
          </CardBody>
        </Card>
      )}
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Confirm sensitive change" description="You are changing the department, employee code or registered mobile. This affects sign-in and analytics grouping and is recorded in the audit log." confirmLabel="Save changes" tone="warning" requireReason loading={update.isPending} onConfirm={save} />
      {roleDialog && <ChangeRoleDialog user={u} onClose={() => setRoleDialog(false)} />}
      {pwDialog && <SetPasswordDialog user={u} onClose={() => setPwDialog(false)} />}
      {deleteDialog && <DeleteEmployeeDialog user={u} onClose={() => setDeleteDialog(false)} onDeleted={() => navigate('/admin/users')} />}
    </div>
  );
}

export function ManagerAssignment({ userId, userName, current, primaryId, secondaryId, reporteeCount, compact }: { userId: string; userName: string; current: { id: string; fullName: string; employeeCode: string }[]; primaryId: string | null; secondaryId: string | null; reporteeCount?: number; compact?: boolean }) {
  const toPicked = (id: string | null) => (id ? current.filter((p) => p.id === id).map((p) => ({ id: p.id, fullName: p.fullName, employeeCode: p.employeeCode })) : []);
  const [primary, setPrimary] = useState<PickedPerson[]>(toPicked(primaryId));
  const [secondary, setSecondary] = useState<PickedPerson[]>(toPicked(secondaryId));
  const [confirm, setConfirm] = useState(false);
  const m = useOpMutation('admin.users.setManagers', { invalidate: ['admin.users.get', 'directory.list', 'lookup.people', 'admin.dashboard'], success: 'Reporting relationship updated' });
  const changed = (primary[0]?.id ?? null) !== primaryId || (secondary[0]?.id ?? null) !== secondaryId;
  return (
    <Card id="managers">
      {!compact && <CardHeader title="Reporting relationship" description="Who reviews this employee's reports." />}
      <CardBody className="space-y-4">
        <div>
          <p className="mb-1.5 text-sm font-medium">Primary Reporting Manager</p>
          <PeoplePicker single value={primary} onChange={setPrimary} filter={(p) => p.role === 'REPORTING_MANAGER'} exclude={[userId]} ariaLabel="Primary Reporting Manager" />
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium">Secondary reviewer</p>
          <PeoplePicker single value={secondary} onChange={setSecondary} filter={(p) => p.role === 'REPORTING_MANAGER'} exclude={[userId, ...primary.map((p) => p.id)]} ariaLabel="Secondary reviewer" />
        </div>
        {reporteeCount !== undefined && reporteeCount > 0 && <p className="text-xs text-muted-foreground">{reporteeCount} employee(s) report to {userName}.</p>}
        <Button disabled={!changed} onClick={() => setConfirm(true)}>Save reporting relationship</Button>
      </CardBody>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Change reviewers for ${userName}?`}
        description="Pending reports move to the new reviewer immediately. The employee and new manager are notified."
        confirmLabel="Change"
        tone="warning"
        requireReason
        loading={m.isPending}
        onConfirm={(reason) => m.mutate({ userId, primaryReportingManagerId: primary[0]?.id ?? null, secondaryReviewerId: secondary[0]?.id ?? null, reason }, { onSuccess: () => setConfirm(false) })}
      />
    </Card>
  );
}

export function RegistrationsPage() {
  const [status, setStatus] = useState<'PENDING' | 'APPROVED' | 'REJECTED'>('PENDING');
  const q = useOp('admin.registrations.list', { status });
  const [approving, setApproving] = useState<NonNullable<typeof q.data>['items'][number] | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const reject = useOpMutation('admin.registrations.reject', { invalidate: ['admin.registrations.list', 'admin.dashboard'], success: 'Request rejected' });
  return (
    <div className="space-y-5">
      <PageHeader title="Access requests" description="Verify, then assign role and manager" />
      <FilterBar>
        <FilterSelect label="Status" value={status} onChange={(v) => setStatus((v || 'PENDING') as typeof status)} allLabel="Pending" options={[{ value: 'APPROVED', label: 'Approved' }, { value: 'REJECTED', label: 'Rejected' }]} />
      </FilterBar>
      {q.error ? <ErrorState error={q.error} /> : (
        <Card>
          <DataTable
            caption="Registration requests"
            loading={q.isLoading}
            rows={q.data?.items ?? []}
            rowKey={(r) => r.id}
            empty="No requests"
            columns={[
              { key: 'n', header: 'Name', cell: (r) => <span className="font-medium">{r.fullName}</span> },
              { key: 'c', header: 'Employee code', cell: (r) => r.employeeCode },
              { key: 'p', header: 'Mobile', cell: (r) => r.phoneNumber },
              { key: 'd', header: 'Designation', cell: (r) => r.designation || '—', hideOnMobile: true },
              { key: 't', header: 'Requested', cell: (r) => fmtDateTime(r.createdAt), hideOnMobile: true },
              { key: 's', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
              {
                key: 'a',
                header: <span className="sr-only">Actions</span>,
                cell: (r) => r.status === 'PENDING' && (
                  <div className="flex gap-1">
                    <Button size="sm" onClick={() => setApproving(r)}>Review & approve</Button>
                    <Button size="sm" variant="ghost" onClick={() => setRejecting(r.id)}>Reject</Button>
                  </div>
                ),
              },
            ]}
          />
        </Card>
      )}
      {approving && (
        <Dialog open onOpenChange={(o) => !o && setApproving(null)} title={`Approve ${approving.fullName}`} description="Confirm the details, then assign department, role and Reporting Manager." wide>
          <UserCreatePage
            requestId={approving.id}
            prefill={{ fullName: approving.fullName, employeeCode: approving.employeeCode, phoneNumber: approving.phoneNumber, officialEmail: approving.officialEmail, departmentId: approving.departmentId ?? '', designation: approving.designation }}
            onDone={() => { setApproving(null); void q.refetch(); }}
          />
        </Dialog>
      )}
      <ConfirmDialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)} title="Reject registration request?" confirmLabel="Reject" tone="destructive" requireReason loading={reject.isPending} onConfirm={(reason) => rejecting && reject.mutate({ requestId: rejecting, reason }, { onSuccess: () => setRejecting(null) })} />
    </div>
  );
}

export function RolesPage() {
  const perms = Object.keys(PERMISSIONS) as Permission[];
  const users = useOp('admin.dashboard', {});
  return (
    <div className="space-y-5">
      <PageHeader title="Roles" actions={<Button asChild><Link to="/admin/users">Assign roles in User management</Link></Button>} />
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">Role permission matrix</caption>
            <thead>
              <tr className="border-b bg-muted/60 text-left">
                <th className="px-4 py-3 text-xs font-semibold text-muted-foreground">Permission</th>
                {ROLES.map((r) => (
                  <th key={r} className="px-3 py-3 text-center text-xs font-semibold">
                    {ROLE_LABELS[r]}
                    <span className="block font-normal text-muted-foreground">{users.data ? `${users.data.usersByRole[r]} active` : ''}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b">
                <td className="px-4 py-2.5">Submit own daily & weekly reports <span className="text-xs text-muted-foreground">(configurable in System settings)</span></td>
                {ROLES.map((r) => <td key={r} className="px-3 py-2.5 text-center">{r === 'EMPLOYEE' || r === 'REPORTING_MANAGER' ? <Check className="mx-auto size-4 text-success" aria-label="Yes (default)" /> : <span className="text-muted-foreground" aria-label="No">—</span>}</td>)}
              </tr>
              {perms.map((p) => (
                <tr key={p} className="border-b last:border-0">
                  <td className="px-4 py-2.5">{PERMISSION_LABELS[p]}</td>
                  {ROLES.map((r) => (
                    <td key={r} className="px-3 py-2.5 text-center">
                      {(PERMISSIONS[p] as readonly Role[]).includes(r) ? <Check className="mx-auto size-4 text-success" aria-label="Yes" /> : <span className="text-muted-foreground" aria-label="No">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Notice tone="info" title="Scope rules">
        Employees see only their own reports. Reporting Managers see only employees assigned to them (primary or secondary). Management is read-only company-wide. Super Admin cannot view passwords and cannot change their own role or status.
      </Notice>
    </div>
  );
}
