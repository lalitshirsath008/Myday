import { BellOff } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Skeleton } from '@/components/ui/misc';
import { useOp, useOpMutation } from '@/lib/api';
import { cn, fmtRelative } from '@/lib/utils';
import { SoundToggle } from './NotificationWatcher';

/** Shared with the tab badge in the My day panel, so both read one cached list. */
export const PANEL_NOTIFICATIONS = { unreadOnly: false, limit: 30 } as const;

/** Notifications tab of the My day panel. In the desktop app, links open in the normal browser. */
export function PanelNotifications({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate();
  const q = useOp('notifications.list', PANEL_NOTIFICATIONS, { refetchInterval: 60_000, staleTime: 30_000 });
  const markRead = useOpMutation('notifications.markRead', { invalidate: ['notifications.list'], silent: true });
  const unread = q.data?.unreadCount ?? 0;

  const open = (n: { id: string; read: boolean; link: string | null }) => {
    if (!n.read) markRead.mutate({ ids: [n.id] });
    if (!n.link) return;
    if (window.rgkWidget) window.open(n.link, '_blank', 'noopener');
    else {
      onNavigate?.();
      navigate(n.link);
    }
  };

  if (q.isPending) {
    return (
      <div className="space-y-2 px-4 pt-3" role="status" aria-label="Loading notifications">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 rounded-xl" />
        ))}
      </div>
    );
  }
  const items = q.data?.items ?? [];
  return (
    <section aria-label="Notifications" className="pt-1">
      <div className="flex items-center justify-between px-4 py-2">
        <p className="text-[12px] text-muted-foreground">{unread ? `${unread} unread` : 'All caught up'}</p>
        <span className="flex items-center gap-2">
          {unread > 0 && (
            <button type="button" className="cursor-pointer text-[12px] font-medium text-primary hover:underline" onClick={() => markRead.mutate({ ids: null })}>
              Mark all read
            </button>
          )}
          <SoundToggle />
        </span>
      </div>
      {items.length === 0 ? (
        <div className="animate-fade-up px-4 py-10 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <BellOff className="size-6" aria-hidden />
          </span>
          <p className="mt-3 text-[14px] font-medium">No notifications yet</p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">Reviews, reminders and project updates show up here.</p>
        </div>
      ) : (
        <ul className="divide-y border-y">
          {items.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => open(n)}
                className={cn('flex w-full cursor-pointer items-start gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-muted/60', !n.read && 'bg-brand-soft/40')}
              >
                <span className={cn('mt-[7px] size-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-brand')} aria-label={n.read ? undefined : 'Unread'} />
                <span className="min-w-0 flex-1">
                  <span className={cn('block text-[13px] leading-snug', n.read ? 'text-foreground/80' : 'font-medium text-foreground')}>{n.title}</span>
                  {n.body && <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-muted-foreground">{n.body}</span>}
                  <span className="mt-1 block text-[11px] text-muted-foreground">{fmtRelative(n.createdAt)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
