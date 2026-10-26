import { ListChecks, LogIn } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { MyDayPanel, useMyDay } from '@/components/layout/MyDayDrawer';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/misc';
import { useSession } from '@/lib/session';

/** Bridge exposed by the RGK WorkTrack desktop app (desktop/preload.cjs). Absent in a normal browser. */
declare global {
  interface Window {
    rgkWidget?: { hide: () => void; setCount: (done: number, total: number) => void };
  }
}

function Panel() {
  const state = useMyDay();
  useEffect(() => {
    window.rgkWidget?.setCount(state.done, state.items.length);
  }, [state.done, state.items.length]);
  // Refresh when the desktop panel is shown again, so edits made in the browser appear. Esc closes it.
  const { refetch } = state;
  useEffect(() => {
    const onFocus = () => void refetch();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && window.rgkWidget?.hide();
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
  const { status, me } = useSession();
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
      <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-card p-6 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-brand-soft text-brand">
          <ListChecks className="size-7" aria-hidden />
        </span>
        <p className="text-[17px] font-semibold">My day</p>
        <p className="text-[13px] text-muted-foreground">Sign in to RGK WorkTrack to plan your day.</p>
        <Button asChild>
          <Link to="/login" state={{ from: '/widget/my-day' }}>
            <LogIn /> Sign in
          </Link>
        </Button>
      </div>
    );
  }
  if (me.user.role === 'SUPER_ADMIN') {
    return <p className="flex h-dvh items-center justify-center bg-card p-6 text-center text-[13px] text-muted-foreground">My day is for employees and managers.</p>;
  }
  return <Panel />;
}
