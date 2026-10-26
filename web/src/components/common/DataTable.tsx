import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { cn } from '@/lib/utils';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Value used for client-side sorting; omit to make the column unsortable. */
  sort?: (row: T) => string | number | null;
  className?: string;
  /** Hide on small screens. */
  hideOnMobile?: boolean;
}

/**
 * Accessible data table with client-side sorting and pagination. For server-paged lists pass
 * `page`, `total` and `onPageChange` and leave `pageSize` to match the server limit.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  empty = 'No records found',
  emptyDescription,
  onRowClick,
  pageSize = 25,
  server,
  caption,
  initialSort,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  empty?: string;
  emptyDescription?: ReactNode;
  onRowClick?: (row: T) => void;
  pageSize?: number;
  server?: { page: number; total: number; onPageChange: (p: number) => void };
  caption?: string;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
}) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(initialSort ?? null);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sort || server) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    return [...rows].sort((a, b) => {
      const va = col.sort!(a);
      const vb = col.sort!(b);
      if (va === vb) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return (va < vb ? -1 : 1) * (sort.dir === 'asc' ? 1 : -1);
    });
  }, [rows, sort, columns, server]);

  const total = server ? server.total : sorted.length;
  const currentPage = server ? server.page : Math.min(page, Math.max(0, Math.ceil(total / pageSize) - 1));
  const visible = server ? sorted : sorted.slice(currentPage * pageSize, currentPage * pageSize + pageSize);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const setP = (p: number) => (server ? server.onPageChange(p) : setPage(p));

  return (
    <div>
      {/* Phones: each row becomes a compact card (first column is the title). */}
      <ul className="divide-y md:hidden" aria-label={caption}>
        {loading &&
          Array.from({ length: 4 }, (_, i) => (
            <li key={i} className="space-y-2 px-4 py-3.5">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </li>
          ))}
        {!loading &&
          visible.map((row) => {
            const [first, ...rest] = columns;
            const content = (
              <>
                <div className="text-[14px] font-medium">{first?.cell(row)}</div>
                <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px]">
                  {rest.map((c) => (
                    <div key={c.key} className="flex min-w-0 items-center gap-1.5">
                      {typeof c.header === 'string' && c.header && <dt className="text-muted-foreground">{c.header}</dt>}
                      <dd className="min-w-0">{c.cell(row)}</dd>
                    </div>
                  ))}
                </dl>
              </>
            );
            return (
              <li key={rowKey(row)}>
                {onRowClick ? (
                  <div role="button" tabIndex={0} className="tap block w-full cursor-pointer px-4 py-3.5 text-left active:bg-muted" onClick={() => onRowClick(row)} onKeyDown={(e) => e.key === 'Enter' && onRowClick(row)}>
                    {content}
                  </div>
                ) : (
                  <div className="px-4 py-3.5">{content}</div>
                )}
              </li>
            );
          })}
      </ul>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr className="border-b">
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cn('whitespace-nowrap px-4 py-3 text-left text-[12px] font-medium text-muted-foreground', c.className)}
                  >
                    {c.sort && !server ? (
                      <button
                        className="inline-flex cursor-pointer items-center gap-1 hover:text-foreground"
                        onClick={() => setSort(active && sort.dir === 'asc' ? { key: c.key, dir: 'desc' } : { key: c.key, dir: 'asc' })}
                      >
                        {c.header}
                        {active && (sort.dir === 'asc' ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />)}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 5 }, (_, i) => (
                <tr key={i} className="border-b">
                  {columns.map((c) => (
                    <td key={c.key} className="px-4 py-3">
                      <Skeleton className="h-4 w-full max-w-40" />
                    </td>
                  ))}
                </tr>
              ))}
            {!loading &&
              visible.map((row) => (
                <tr
                  key={rowKey(row)}
                  className={cn('border-b last:border-0 transition-colors', onRowClick && 'cursor-pointer hover:bg-muted/50')}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(row) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={cn('px-4 py-3 align-middle', c.className)}>
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {!loading && rows.length === 0 && <EmptyState title={empty} description={emptyDescription} />}
      {!loading && total > pageSize && (
        <div className="flex items-center justify-between gap-3 border-t px-4 py-3 text-xs text-muted-foreground">
          <span>
            {currentPage * pageSize + 1}–{Math.min(total, (currentPage + 1) * pageSize)} of {total}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => setP(currentPage - 1)} disabled={currentPage === 0} aria-label="Previous page">
              <ChevronLeft />
            </Button>
            <span className="px-2">
              Page {currentPage + 1} of {pages}
            </span>
            <Button variant="outline" size="sm" onClick={() => setP(currentPage + 1)} disabled={currentPage >= pages - 1} aria-label="Next page">
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
