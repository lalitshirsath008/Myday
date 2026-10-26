import * as P from '@radix-ui/react-popover';
import { Bell } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { useOp, useOpMutation } from '@/lib/api';
import { cn, fmtRelative } from '@/lib/utils';

export function NotificationBell() {
  const navigate = useNavigate();
  const { data } = useOp('notifications.list', { unreadOnly: false, limit: 8 }, { refetchInterval: 60_000, staleTime: 30_000 });
  const markRead = useOpMutation('notifications.markRead', { invalidate: ['notifications.list'] });
  const unread = data?.unreadCount ?? 0;

  return (
    <P.Root>
      <P.Trigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
          <Bell />
          {unread > 0 && (
            <span className="absolute right-0.5 top-0.5 flex min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-[18px] text-primary-foreground ring-2 ring-background">{unread > 99 ? '99+' : unread}</span>
          )}
        </Button>
      </P.Trigger>
      <P.Portal>
        <P.Content align="end" sideOffset={8} className="z-50 w-[22rem] max-w-[calc(100vw-1.5rem)] animate-fade-in overflow-hidden rounded-2xl border bg-card shadow-[var(--shadow-raised)]">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <p className="text-sm font-semibold">Notifications</p>
            {unread > 0 && (
              <button className="cursor-pointer text-xs font-medium text-primary hover:underline" onClick={() => markRead.mutate({ ids: null })}>
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {!data?.items.length && <li className="px-4 py-8 text-center text-sm text-muted-foreground">You're all caught up.</li>}
            {data?.items.map((n) => (
              <li key={n.id}>
                <P.Close asChild>
                  <button
                    className={cn('block w-full cursor-pointer border-b px-4 py-3 text-left last:border-0 hover:bg-muted', !n.read && 'bg-brand-soft/50')}
                    onClick={() => {
                      if (!n.read) markRead.mutate({ ids: [n.id] });
                      if (n.link) navigate(n.link);
                    }}
                  >
                    <span className="flex items-start gap-2">
                      {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand" aria-label="Unread" />}
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{n.title}</span>
                        <span className="line-clamp-1 block text-xs text-muted-foreground">{n.body}</span>
                        <span className="mt-1 block text-[11px] text-muted-foreground">{fmtRelative(n.createdAt)}</span>
                      </span>
                    </span>
                  </button>
                </P.Close>
              </li>
            ))}
          </ul>
          <div className="border-t px-4 py-2 text-center">
            <P.Close asChild>
              <Link to="/notifications" className="text-xs font-medium text-primary hover:underline">
                View all notifications
              </Link>
            </P.Close>
          </div>
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}
