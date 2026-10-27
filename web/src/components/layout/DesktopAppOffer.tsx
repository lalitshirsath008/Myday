import { useQuery } from '@tanstack/react-query';
import { Download, Monitor, X } from 'lucide-react';
import { useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Written by desktop/publish.cjs. `url` is where the installer is hosted (a GitHub Release). */
interface DesktopManifest {
  version: string;
  appUrl: string;
  file: string;
  url: string | null;
  size: number;
}

const HIDE_KEY = 'rgk-desktop-offer-hidden';
const isWindowsDesktop = typeof navigator !== 'undefined' && /Windows NT/.test(navigator.userAgent) && !/Mobile/.test(navigator.userAgent);

function readHidden() {
  try {
    return localStorage.getItem(HIDE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * "Get My day on your desktop" card in the My day drawer. Shown on Windows only, and only when this
 * site has an installer that was built for this site's own address.
 */
export function DesktopAppOffer() {
  const [hidden, setHidden] = useState(readHidden);
  const [started, setStarted] = useState(false);
  const q = useQuery({
    queryKey: ['desktop-manifest'],
    enabled: isWindowsDesktop && !hidden,
    staleTime: 60 * 60_000,
    retry: false,
    queryFn: async (): Promise<DesktopManifest | null> => {
      const r = await fetch('/downloads/desktop.json', { cache: 'no-cache' });
      if (!r.ok || !r.headers.get('content-type')?.includes('json')) return null;
      const m = (await r.json()) as DesktopManifest;
      // Only an installer built for this very site, from this site or an https download link.
      const hosted = m.url ? /^https:\/\//.test(m.url) : /^[\w.-]+\.exe$/.test(m.file);
      return m.appUrl === window.location.origin && hosted ? m : null;
    },
  });
  const m = q.data;
  if (hidden || !m) return null;

  const hide = () => {
    try {
      localStorage.setItem(HIDE_KEY, '1');
    } catch {
      // Only a convenience; the card just shows again next time.
    }
    setHidden(true);
  };

  return (
    <div className="mx-4 mb-2 animate-fade-up rounded-xl border bg-gradient-to-r from-brand-soft to-card px-3 py-2">
      <div className="flex items-center gap-2.5">
        <Monitor className="size-4 shrink-0 text-brand" aria-hidden />
        <p className="min-w-0 flex-1 truncate text-[12.5px]" title="Keep this tab on your laptop screen, over every app. Same list, always in sync.">
          My day on your desktop
        </p>
        <a
          href={m.url ?? `/downloads/${m.file}`}
          download={m.url ? undefined : m.file}
          onClick={() => setStarted(true)}
          aria-label={`Download the Windows app (${Math.round(m.size / 1_048_576)} MB)`}
          className={cn(buttonVariants({ size: 'sm' }), 'h-7 shrink-0 rounded-lg px-2.5 text-[12px]')}
        >
          <Download /> {started ? 'Again' : 'Download'}
        </a>
        <button type="button" onClick={hide} aria-label="Hide desktop app offer" className="-mr-1 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-muted">
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      {started ? (
        <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-[11.5px] leading-snug text-foreground/85" aria-live="polite">
          <li>Open the downloaded file ({m.file}).</li>
          <li>
            If Windows says “Windows protected your PC”, click <b>More info</b> → <b>Run anyway</b>.
          </li>
          <li>Sign in once. The orange tab appears on the right edge of your screen.</li>
        </ol>
      ) : null}
    </div>
  );
}
