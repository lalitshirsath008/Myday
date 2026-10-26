import { FolderPlus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Notice, Sheet } from '@/components/ui/misc';
import { useOpMutation } from '@/lib/api';
import { useMe } from '@/lib/session';
import { useDepartments } from './filters';
import { PeoplePicker, type PickedPerson } from './PeoplePicker';

const REVIEWER_ROLES = ['REPORTING_MANAGER', 'MANAGEMENT', 'SUPER_ADMIN'];

/** "New project" form for employees. The project stays "Waiting for approval" until an admin activates it. */
export function ProjectRequestSheet({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated?: (id: string) => void }) {
  const me = useMe();
  const departments = useDepartments();
  const self: PickedPerson = { id: me.user.id, fullName: me.user.fullName, employeeCode: me.user.employeeCode };
  const manager = me.primaryManager ? [{ id: me.primaryManager.id, fullName: me.primaryManager.fullName, employeeCode: me.primaryManager.employeeCode }] : [];
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState(me.today);
  const [endDate, setEndDate] = useState('');
  const [departmentId, setDepartmentId] = useState(me.user.departmentId);
  const [lead, setLead] = useState<PickedPerson[]>([self]);
  const [reviewer, setReviewer] = useState<PickedPerson[]>(manager);
  const [error, setError] = useState<string | null>(null);
  const create = useOpMutation('projects.request', { invalidate: ['projects.mine', 'lookup.projects', 'me.projects'], silent: true });

  const reset = () => {
    setName('');
    setDescription('');
    setStartDate(me.today);
    setEndDate('');
    setLead([self]);
    setReviewer(manager);
    setError(null);
  };

  const submit = () => {
    setError(null);
    if (name.trim().length < 2) return setError('Enter a project name.');
    if (description.trim().length < 5) return setError('Add a short description.');
    if (endDate && startDate && endDate < startDate) return setError('End date must be on or after the start date.');
    create.mutate(
      { name, description, departmentId, startDate: startDate || null, targetEndDate: endDate || null, ownerId: lead[0]?.id ?? null, reviewerId: reviewer[0]?.id ?? null },
      {
        onSuccess: (r) => {
          toast.success(`Project created · waiting for approval`);
          onCreated?.(r.project.id);
          reset();
          onOpenChange(false);
        },
        onError: (e) => setError(e.message),
      },
    );
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
      title="New project"
      footer={
        <Button className="flex-1" onClick={submit} loading={create.isPending}>
          <FolderPlus /> Create project
        </Button>
      }
    >
      <div className="space-y-4 pt-1">
        {error && <Notice tone="danger">{error}</Notice>}
        <Field label="Project name" required>
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Line 3 automation" autoFocus />}
        </Field>
        <Field label="Description" required>
          {(p) => <Textarea {...p} value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What is this project about?" />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date">{(p) => <Input {...p} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />}</Field>
          <Field label="End date">{(p) => <Input {...p} type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} />}</Field>
        </div>
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-foreground/80">Project lead · reports progress</p>
          <PeoplePicker single value={lead} onChange={setLead} ariaLabel="Project lead" placeholder="Search employee" />
        </div>
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-foreground/80">Reviewer</p>
          <PeoplePicker single value={reviewer} onChange={setReviewer} filter={(p) => REVIEWER_ROLES.includes(p.role)} exclude={lead.map((l) => l.id)} ariaLabel="Project reviewer" placeholder="Search manager" />
        </div>
        <Field label="Department">
          {(p) => (
            <Select {...p} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              {departments.items.filter((d) => d.active).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <p className="text-[12px] text-muted-foreground">You can add your tasks to it right away. An admin approves it for everyone.</p>
      </div>
    </Sheet>
  );
}
