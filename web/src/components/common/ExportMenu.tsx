import type { OpInput } from '@rgk/core';
import { Download, FileSpreadsheet, FileText, Printer } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Menu } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { downloadCsv, downloadExcel } from '@/lib/export';

/**
 * Exports run on the server with the caller's normal access scope (and are audited), so
 * an export can never contain more than the person could already see.
 */
export function ExportMenu({ request, filename, printable = true, compact }: { request: OpInput<'export.run'>; filename: string; printable?: boolean; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const run = async (format: 'csv' | 'xls') => {
    setBusy(true);
    try {
      const { rows } = await api('export.run', request);
      if (!rows.length) {
        toast.info('Nothing to export for these filters.');
        return;
      }
      if (format === 'csv') downloadCsv(filename, rows);
      else downloadExcel(filename, rows);
      toast.success(`Exported ${rows.length} rows`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Menu
      trigger={
        compact ? (
          <Button variant="ghost" size="icon" loading={busy} aria-label="Export">
            {!busy && <Download />}
          </Button>
        ) : (
          <Button variant="outline" size="sm" loading={busy}>
            <Download /> Export
          </Button>
        )
      }
      items={[
        { label: <><FileText /> CSV</>, onSelect: () => void run('csv') },
        { label: <><FileSpreadsheet /> Excel (.xls)</>, onSelect: () => void run('xls') },
        ...(printable ? (['separator', { label: <><Printer /> Print / Save as PDF</>, onSelect: () => window.print() }] as const) : []),
      ]}
    />
  );
}
