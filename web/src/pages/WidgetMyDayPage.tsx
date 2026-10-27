import { ListChecks, LogIn, LogOut, RotateCw, X } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { MyDayPanel, useMyDay } from '@/components/layout/MyDayDrawer';
import { NotificationWatcher } from '@/components/layout/NotificationWatcher';
import { useTaskStartAlerts } from '@/components/layout/TaskStartAlerts';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/misc';
import { soundEnabled } from '@/lib/notifySound';
import { useSession } from '@/lib/session';
import { fmtTime } from '@/lib/utils';

/** Bridge exposed by the desktop app (desktop/panel-preload.cjs). Absent in a normal browser; older app versions lack the optional parts. */
declare global {
  interface Window {
    rgkWidget?: {
      hide: () => void;
      reload?: () => void;
      setCount: (done: number, total: number) => void;
      setUnread?: (unread: number) => void;
      notify?: (n: { id: string | null; title: string; body: string; link: string | null; sound: boolean }) => void;
      onNotificationOpened?: (fn: (id: string) => void) => () => void;
      taskAlert?: (a: { title: string; time: string; timeLabel: string; label: string; sound: boolean }) => void;
    };
  }
}

function Panel() {
  const state = useMyDay();
  // Start-time strip over every app (desktop app); older app versions get a notification banner instead.
  useTaskStartAlerts(state.items, (a) => {
    const w = window.rgkWidget;
    if (w?.taskAlert) w.taskAlert({ title: a.title, time: a.time, timeLabel: fmtTime(a.time), label: a.label, sound: soundEnabled() });
    else w?.notify?.({ id: null, title: `${fmtTime(a.time)} · Time to start`, body: `${a.title} (${a.label})`, link: null, sound: soundEnabled() });
  });
  useEffect(() => {
    window.rgkWidget?.setCount(state.done, state.items.length);
  }, [state.done, state.items.length]);
  // Refresh when the desktop panel is shown again, so edits made in the browser appear. Esc closes it. F5/Ctrl+R reloads.
  const { refetch } = state;
  useEffect(() => {
    const onFocus = () => void refetch();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        window.rgkWidget?.hide();
      } else if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r')) {
        if (window.rgkWidget?.reload) {
          e.preventDefault();
          window.rgkWidget.reload();
        }
      }
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('keydown', onKey);
    };
  }, [refetch]);
  return <MyDayPanel state={state} onClose={window.rgkWidget ? () => window.rgkWidget?.hide() : undefined} className="h-dvh" />;
}

/** Full-window "My day" used by the desktop widget (also works in a browser tab). */
export function WidgetMyDayPage() {
  const { status, me, signOut } = useSession();

  const handleReload = () => {
    if (window.rgkWidget?.reload) window.rgkWidget.reload();
    else window.location.reload();
  };

  if (status === 'loading') {
    return (
      <div className="space-y-3 p-5" role="status" aria-label="Loading">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-11" />
        <Skeleton className="h-16 rounded-2xl" />
      </div>
    );
  }
  if (status !== 'signed-in' || !me || me.user.mustChangePassword) {
    return (
      <div className="relative flex h-dvh flex-col items-center justify-center gap-3 bg-card p-6 text-center">
        {window.rgkWidget && (
          <div className="absolute right-3 top-3 flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Refresh (Ctrl+R)"
              aria-label="Refresh"
              onClick={handleReload}
            >
              <RotateCw className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Close (Esc)"
              aria-label="Close"
              onClick={() => window.rgkWidget?.hide()}
            >
              <X className="size-4" />
            </Button>
          </div>
        )}
        <span className="flex size-14 items-center justify-center rounded-2xl bg-brand-soft text-brand">
          <ListChecks className="size-7" aria-hidden />
        </span>
        <p className="text-[17px] font-semibold">My day</p>
        <p className="text-[13px] text-muted-foreground">Sign in to RGK Myday to plan your day.</p>
        <Button asChild>
          <Link to="/login" state={{ from: '/widget/my-day' }}>
            <LogIn /> Sign in
          </Link>
        </Button>
      </div>
    );
  }
  if (me.user.role === 'SUPER_ADMIN') {
    return (
      <>
        <NotificationWatcher />
        <div className="relative flex h-dvh flex-col items-center justify-center bg-card p-6 text-center text-[13px] text-muted-foreground">
          {window.rgkWidget && (
            <div className="absolute right-3 top-3 flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="size-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Refresh (Ctrl+R)"
                aria-label="Refresh"
                onClick={handleReload}
              >
                <RotateCw className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 rounded-lg text-muted-foreground hover:bg-danger/10 hover:text-danger"
                title="Sign out"
                aria-label="Sign out"
                onClick={async () => {
                  if (window.confirm('Sign out of RGK Myday?')) {
                    await signOut();
                  }
                }}
              >
                <LogOut className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Close (Esc)"
                aria-label="Close"
                onClick={() => window.rgkWidget?.hide()}
              >
                <X className="size-4" />
              </Button>
            </div>
          )}
          My day is for employees and managers.
        </div>
      </>
    );
  }
  return (
    <>
      <NotificationWatcher />
      <Panel />
    </>
  );
}
