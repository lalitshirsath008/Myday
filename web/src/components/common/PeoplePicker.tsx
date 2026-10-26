import { Loader2, Search, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useOp } from '@/lib/api';
import { cn } from '@/lib/utils';

export interface PickedPerson {
  id: string;
  fullName: string;
  employeeCode: string;
}

/** Search-as-you-type picker for collaborators / managers, limited to active employees. */
export function PeoplePicker({
  value,
  onChange,
  max = 20,
  exclude = [],
  placeholder = 'Search by name or employee code…',
  single,
  filter,
  disabled,
  ariaLabel = 'Search people',
}: {
  value: PickedPerson[];
  onChange: (v: PickedPerson[]) => void;
  max?: number;
  exclude?: string[];
  placeholder?: string;
  single?: boolean;
  filter?: (p: { role: string }) => boolean;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const listId = useId();
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  const { data, isFetching } = useOp('directory.people', { query: debounced, limit: 10 }, { enabled: debounced.length >= 1, staleTime: 60_000 });
  const results = (data?.people ?? []).filter((p) => !exclude.includes(p.id) && !value.some((v) => v.id === p.id) && (!filter || filter(p)));
  const add = (p: PickedPerson) => {
    onChange(single ? [p] : [...value, p].slice(0, max));
    setQ('');
    setOpen(false);
  };

  return (
    <div className="relative">
      {value.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {value.map((p) => (
            <li key={p.id} className="inline-flex items-center gap-1 rounded-full border bg-accent px-2.5 py-0.5 text-xs text-accent-foreground">
              {p.fullName} <span className="text-muted-foreground">{p.employeeCode}</span>
              {!disabled && (
                <button type="button" className="ml-0.5 cursor-pointer rounded-full p-0.5 hover:bg-card" onClick={() => onChange(value.filter((v) => v.id !== p.id))} aria-label={`Remove ${p.fullName}`}>
                  <X className="size-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {(!single || value.length === 0) && value.length < max && !disabled && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            className="h-9 w-full rounded-md border border-input bg-card pl-8 pr-8 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={q}
            placeholder={placeholder}
            role="combobox"
            aria-label={ariaLabel}
            aria-expanded={open && debounced.length > 0}
            aria-controls={listId}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (results[0]) add(results[0]);
              }
            }}
          />
          {isFetching && <Loader2 className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />}
          {open && debounced.length > 0 && (
            <ul id={listId} role="listbox" className="absolute left-0 right-0 top-10 z-30 max-h-60 overflow-y-auto rounded-lg border bg-card p-1 shadow-lg">
              {!results.length && !isFetching && <li className="px-3 py-3 text-sm text-muted-foreground">No active employees match.</li>}
              {results.map((p) => (
                <li
                  key={p.id}
                  role="option"
                  aria-selected={false}
                  className={cn('cursor-pointer rounded-md px-3 py-1.5 text-sm hover:bg-muted')}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    add(p);
                  }}
                >
                  <span className="font-medium">{p.fullName}</span> <span className="text-xs text-muted-foreground">{p.employeeCode} · {p.designation}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
