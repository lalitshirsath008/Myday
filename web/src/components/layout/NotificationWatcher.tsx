import { useQueryClient } from '@tanstack/react-query';
import { Check, Volume2, VolumeX, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, useOp, useOpMutation } from '@/lib/api';
import { playChime, setSoundEnabled, soundEnabled, unlockAudioOnFirstGesture } from '@/lib/notifySound';
import { useMe } from '@/lib/session';
import { cn } from '@/lib/utils';

interface Banner {
  key: string;
  id: string | null; // null for a summary of several
  title: string;
  body: string;
  link: string | null;
  leaving?: boolean;
}

const SHOW_MS = 6000;

/** Turns the notification chime on or off for this device; turning it on plays a preview. */
export function SoundToggle({ className }: { className?: string }) {
  const [on, setOn] = useState(soundEnabled);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Notification sound"
      title={on ? 'Sound on' : 'Sound off'}
      onClick={() => {
        setSoundEnabled(!on);
        setOn(!on);
        if (!on) playChime();
      }}
      className={cn('flex size-7 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground', className)}
    >
      {on ? <Volume2 className="size-4" aria-hidden /> : <VolumeX className="size-4" aria-hidden />}
    </button>
  );
}
const MAX_BANNERS = 3;
const SAFETY_MS = 15 * 60_000;

/**
 * Watches for new notifications and announces them with an iOS-style banner and a chime.
 * In the desktop app the banner is drawn by the app itself (over every window), so this
 * only hands the notification over. Only notifications that arrive after the last check
 * pop up; on start-up, several that came in while away are summarised in one banner.
 */
export function NotificationWatcher() {
  const me = useMe();
  const navigate = useNavigate();
  const q = useOp('notifications.list', { unreadOnly: false, limit: 15 }, { refetchInterval: 10_000, refetchIntervalInBackground: true, staleTime: 5_000 });
  const markRead = useOpMutation('notifications.markRead', { invalidate: ['notifications.list'], silent: true });
  const [banners, setBanners] = useState<Banner[]>([]);
  const baseline = useRef<string | null>(null);
  const announced = useRef(new Set<string>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const storeKey = `rgk-notified-until:${me.user.id}`;

  useEffect(() => unlockAudioOnFirstGesture(), []);

  // Unread count in the browser tab title, e.g. "(3) RGK Myday".
  const unread = q.data?.unreadCount ?? 0;
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\+?\) /, '');
    document.title = unread ? `(${unread > 99 ? '99+' : unread}) ${base}` : base;
    window.rgkWidget?.setUnread?.(unread);
  }, [unread]);

  // A banner or strip clicked in the desktop app marks its notification read here.
  const mark = markRead.mutate;
  useEffect(() => window.rgkWidget?.onNotificationOpened?.((id) => mark({ ids: [id] })), [mark]);

  // Show banners (or hand them to the desktop app) with one chime; never the same notification twice.
  const announce = useCallback(
    (list: Banner[]) => {
      const fresh = list.filter((b) => !b.id || !announced.current.has(b.id));
      for (const b of fresh) if (b.id) announced.current.add(b.id);
      if (!fresh.length) return;
      if (window.rgkWidget?.notify) {
        for (const b of fresh) window.rgkWidget.notify({ id: b.id, title: b.title, body: b.body, link: b.link, sound: soundEnabled() });
      }
      playChime();
      if (!window.rgkWidget?.notify) {
        setBanners((cur) => [...fresh, ...cur.filter((c) => !fresh.some((b) => b.key === c.key))].slice(0, MAX_BANNERS));
      }
    },
    [],
  );

  // "Complete your 3 priority tasks" reminders: ask at each reminder time (the server decides whether
  // one is due) and at least every 15 minutes as a safety net, e.g. after the laptop wakes from sleep.
  const qc = useQueryClient();
  useEffect(() => {
    if (!me.isReporter) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const later = (ms: number) => {
      clearTimeout(timer);
      if (!stopped) timer = setTimeout(run, Math.min(Math.max(ms, 5_000), SAFETY_MS));
    };
    function run() {
      api('me.checkReminders', {})
        .then((r) => {
          // Always announce a created reminder, even if a newer check started meanwhile: the server
          // creates each reminder once, so a later check would never return it again.
          if (r.notification) {
            announce([{ key: r.notification.id, ...r.notification }]);
            void qc.invalidateQueries({ queryKey: ['notifications.list'] });
          }
          later(r.nextCheckAt ? new Date(r.nextCheckAt).getTime() - Date.now() + 2_000 : SAFETY_MS);
        })
        .catch(() => later(SAFETY_MS));
    }
    run();
    const onVisible = () => document.visibilityState === 'visible' && run();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [me.isReporter, announce, qc]);

  useEffect(() => {
    const items = q.data?.items;
    if (!items || !items.length) return;
    const newest = items.reduce((m, n) => (n.createdAt > m ? n.createdAt : m), '');
    const first = baseline.current === null;
    if (first) {
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(storeKey);
      } catch {
        // No storage
      }
      baseline.current = stored ?? '';
    }
    const since = baseline.current ?? '';
    const fresh = items
      .filter((n) => !n.read && (since === '' || n.createdAt > since) && !announced.current.has(n.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    if (newest && newest > since) {
      baseline.current = newest;
      try {
        localStorage.setItem(storeKey, newest);
      } catch {
        // Fine: worst case a banner repeats after a reload.
      }
    }
    if (!fresh.length) return;

    for (const n of fresh) announced.current.add(n.id);
    announce(fresh.slice(0, MAX_BANNERS).map((n) => ({ key: n.id, id: n.id, title: n.title, body: n.body, link: n.link })));
  }, [q.data, storeKey, announce]);

  // Auto-dismiss each banner after a few seconds (paused while hovered).
  const dismiss = (key: string) => {
    clearTimeout(timers.current.get(key));
    timers.current.delete(key);
    setBanners((cur) => cur.map((b) => (b.key === key ? { ...b, leaving: true } : b)));
    setTimeout(() => setBanners((cur) => cur.filter((b) => b.key !== key)), 260);
  };
  const schedule = (key: string) => {
    clearTimeout(timers.current.get(key));
    timers.current.set(
      key,
      setTimeout(() => dismiss(key), SHOW_MS),
    );
  };
  useEffect(() => {
    for (const b of banners) if (!b.leaving && !timers.current.has(b.key)) schedule(b.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banners]);
  useEffect(() => {
    const t = timers.current;
    return () => t.forEach((id) => clearTimeout(id));
  }, []);

  const open = (b: Banner) => {
    if (b.id) markRead.mutate({ ids: [b.id] });
    dismiss(b.key);
    if (b.link) navigate(b.link);
  };

  if (window.rgkWidget?.notify || banners.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-[max(0.5rem,env(safe-area-inset-top))] z-[90] flex flex-col items-center gap-2 px-3 sm:inset-x-auto sm:right-4 sm:top-[4.5rem] sm:items-end sm:px-0"
      aria-live="polite"
      aria-label="New notifications"
    >
      {banners.map((b) => (
        <div
          key={b.key}
          role="status"
          onMouseEnter={() => {
            clearTimeout(timers.current.get(b.key));
            timers.current.delete(b.key);
          }}
          onMouseLeave={() => schedule(b.key)}
          className={cn(
            'group pointer-events-auto relative w-full max-w-[380px] rounded-[22px] border border-white/50 bg-white/80 shadow-[0_12px_40px_rgba(0,0,0,0.16),0_2px_6px_rgba(0,0,0,0.06)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-[#2a2a2c]/85',
            b.leaving ? 'animate-[banner-out_0.26s_ease-in_both]' : 'animate-[banner-in_0.5s_cubic-bezier(0.2,0.9,0.3,1.2)_both]',
          )}
        >
          <button type="button" onClick={() => open(b)} className="flex w-full cursor-pointer items-start gap-3 p-3 pr-9 text-left focus-visible:outline-none">
            <span className="flex size-[38px] shrink-0 items-center justify-center rounded-[10px] bg-[#FC8019] text-white shadow-[0_1px_3px_rgba(0,0,0,0.2)]" aria-hidden>
              <Check className="size-5" strokeWidth={3} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2 text-[11.5px] text-foreground/55">
                <span className="font-medium uppercase tracking-wide">RGK Myday</span>
                <span>now</span>
              </span>
              <span className="mt-0.5 block text-[14px] font-semibold leading-snug text-foreground">{b.title}</span>
              {b.body && <span className="line-clamp-2 block text-[13px] leading-snug text-foreground/75">{b.body}</span>}
            </span>
          </button>
          <button
            type="button"
            onClick={() => dismiss(b.key)}
            aria-label="Dismiss notification"
            className="absolute right-2 top-2 flex size-6 cursor-pointer items-center justify-center rounded-full bg-foreground/5 text-foreground/50 opacity-0 transition-opacity hover:bg-foreground/10 focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-100"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
