import { useQuery } from '@tanstack/react-query';
import { Download, Monitor, X } from 'lucide-react';
import { useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Written by desktop/publish.cjs next to the installer. */
interface DesktopManifest {
  version: string;
  appUrl: string;
  file: string;
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
      try {
        const r = await fetch('/downloads/desktop.json', { cache: 'no-cache' });
        if (r.ok && r.headers.get('content-type')?.includes('json')) {
          const m = (await r.json()) as DesktopManifest;
          if (m && /^[\w.-]+\.exe$/.test(m.file)) return m;
        }
      } catch {
        // Use default manifest
      }
      return {
        version: '1.0.0',
        appUrl: window.location.origin,
        file: 'RGK-WorkTrack-Setup.exe',
        size: 120421492,
      };
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
    <div className="mx-4 mb-3 animate-fade-up rounded-2xl border bg-gradient-to-br from-brand-soft to-card p-3.5">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Monitor className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold leading-tight">My day on your desktop</p>
          <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">Keep this tab on your laptop screen, over every app. Same list, always in sync.</p>
        </div>
        <button type="button" onClick={hide} aria-label="Hide desktop app offer" className="-mr-1 -mt-1 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-muted">
          <X className="size-4" aria-hidden />
        </button>
      </div>
      {started ? (
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-[12px] leading-snug text-foreground/85" aria-live="polite">
          <li>Open the downloaded file ({m.file}).</li>
          <li>
            If Windows says “Windows protected your PC”, click <b>More info</b> → <b>Run anyway</b>.
          </li>
          <li>Sign in once with your usual details. The orange tab appears on the right edge of your screen.</li>
        </ol>
      ) : null}
      <a
        href={`/downloads/${m.file}`}
        download={m.file}
        onClick={() => setStarted(true)}
        className={cn(buttonVariants({ size: 'sm' }), 'mt-3 w-full')}
      >
        <Download /> {started ? 'Download again' : 'Download for Windows'} · {Math.round(m.size / 1_048_576)} MB
      </a>
    </div>
  );
}
