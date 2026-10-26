import { Building2, FolderKanban, Loader2, Search, User } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useOp } from '@/lib/api';
import { useMe } from '@/lib/session';
import { cn } from '@/lib/utils';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

type Item = { key: string; kind: 'employee' | 'department' | 'project'; label: string; sub: string; to: string };

/** Global search with autocomplete (management: company-wide; managers: their team only). */
export function GlobalSearch({ autoFocus }: { autoFocus?: boolean } = {}) {
  const me = useMe();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const debounced = useDebounced(q.trim(), 250);
  const ref = useRef<HTMLDivElement>(null);
  const { data, isFetching } = useOp('search.global', { query: debounced }, { enabled: debounced.length >= 2, staleTime: 30_000 });
  const companyWide = me.can('directory.full');

  const items: Item[] = data
    ? [
        ...data.employees.map((e) => ({
          key: `e-${e.id}`,
          kind: 'employee' as const,
          label: e.fullName,
          sub: `${e.employeeCode} · ${e.designation} · ${e.departmentName}${e.managerName ? ` · Reports to ${e.managerName}` : ''}`,
          to: companyWide ? `/employees/${e.id}` : `/team/${e.id}`,
        })),
        ...data.departments.map((d) => ({ key: `d-${d.id}`, kind: 'department' as const, label: d.name, sub: 'Department — open analytics', to: `/departments?dept=${d.id}` })),
        ...data.projects.map((p) => ({ key: `p-${p.id}`, kind: 'project' as const, label: p.name, sub: `Project ${p.code}`, to: `/projects/${p.id}` })),
      ]
    : [];

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  useEffect(() => setActive(0), [debounced]);

  const go = (item: Item) => {
    navigate(item.to);
    setOpen(false);
    setQ('');
  };
  const Icon = { employee: User, department: Building2, project: FolderKanban };

  return (
    <div ref={ref} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        role="combobox"
        aria-expanded={open && debounced.length >= 2}
        aria-controls="global-search-results"
        aria-autocomplete="list"
        aria-label={companyWide ? 'Search employees, codes, departments, managers or projects' : 'Search your team'}
        placeholder={companyWide ? 'Search people, departments, projects' : 'Search your team'}
        autoFocus={autoFocus}
        className="h-11 w-full rounded-xl border border-transparent bg-muted pl-10 pr-9 text-sm placeholder:text-muted-foreground focus-visible:border-brand focus-visible:bg-card focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/15"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, items.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && items[active]) {
            go(items[active]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {isFetching && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />}
      {open && debounced.length >= 2 && (
        <ul id="global-search-results" role="listbox" className="absolute left-0 right-0 top-12 z-50 max-h-96 animate-fade-in overflow-y-auto rounded-2xl border bg-card p-1.5 shadow-[var(--shadow-raised)]">
          {items.length === 0 && !isFetching && <li className="px-3 py-6 text-center text-sm text-muted-foreground">No matches for “{debounced}”</li>}
          {items.map((item, i) => {
            const I = Icon[item.kind];
            return (
              <li
                key={item.key}
                role="option"
                aria-selected={i === active}
                className={cn('flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5', i === active && 'bg-muted')}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  go(item);
                }}
              >
                <I className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{item.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{item.sub}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
