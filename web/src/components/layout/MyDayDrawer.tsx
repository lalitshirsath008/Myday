import * as D from '@radix-ui/react-dialog';
import type { RoutineItem } from '@rgk/core';
import { firstName } from '@rgk/core';
import { Check, ListChecks, Lock, Plus, Repeat, Trash2, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/misc';
import { PillSwitch } from '@/components/ui/pill-switch';
import { DesktopAppOffer } from './DesktopAppOffer';
import { PANEL_NOTIFICATIONS, PanelNotifications } from './PanelNotifications';
import { TodayPriorityTasks } from './TodayPriorityTasks';
import { useOp, useOpMutation } from '@/lib/api';
import { useMe } from '@/lib/session';
import { cn, fmtDate, fmtTime } from '@/lib/utils';

const SUGGESTIONS = ['Check emails', 'Shop-floor round', 'Team meeting', 'Update stock register', 'Call supplier', 'Machine check-up'];
const GREETING_WORDS = 'Your 3 priority tasks first, then everything else.'.split(' ');

/** Today's routine list with autosave. Shared by the in-app drawer and the desktop widget. */
export function useMyDay() {
  const q = useOp('routine.get', { date: null }, { staleTime: 60_000 });
  const save = useOpMutation('routine.save', { silent: true });
  const [items, setItems] = useState<RoutineItem[]>([]);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editSeq = useRef(0);
  const qc = useQueryClient();

  // Take server data when we have no unsaved local edits.
  useEffect(() => {
    if (q.data && !dirty) setItems(q.data.items);
  }, [q.data, dirty]);

  // Autosave shortly after each change. A save only clears "dirty" if nothing changed while it ran,
  // and it updates the cached copy so the list never jumps back to older server data.
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => {
      const seq = editSeq.current;
      const snapshot = items;
      save.mutate(
        { items: snapshot },
        {
          onSuccess: (r) => {
            qc.setQueryData(['routine.get', { date: null }], (old: typeof q.data) => (old ? { ...old, items: snapshot, carriedOver: false } : old));
            setSavedAt(r.updatedAt);
            setError(null);
            if (editSeq.current === seq) setDirty(false);
          },
          onError: (e) => setError(e.message),
        },
      );
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, dirty]);

  const change = (next: RoutineItem[]) => {
    editSeq.current += 1;
    setItems(next);
    setDirty(true);
  };

  return {
    items,
    change,
    error,
    setError,
    dirty,
    saving: save.isPending || dirty,
    savedAt,
    carriedOver: !!q.data?.carriedOver && !dirty,
    editable: q.data?.editable ?? true,
    done: items.filter((i) => i.done).length,
    refetch: q.refetch,
  };
}
export type MyDayState = ReturnType<typeof useMyDay>;

/** The "My day" panel body: greeting, add box, list and save status. Fills its container's height. */
export function MyDayPanel({ state, onClose, className, extra }: { state: MyDayState; onClose?: () => void; className?: string; extra?: ReactNode }) {
  const me = useMe();
  const name = firstName(me.user.fullName.replace(/\s*\(.*\)$/, ''));
  const [text, setText] = useState('');
  const [time, setTime] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<'tasks' | 'notifications'>('tasks');
  const notes = useOp('notifications.list', PANEL_NOTIFICATIONS, { refetchInterval: 60_000, staleTime: 30_000 });
  const { items, change, error, setError, editable, done } = state;

  const add = (value: string, at: string | null = null) => {
    const v = value.trim();
    if (!v) return;
    if (items.length >= 30) return setError('You can add up to 30 routine tasks.');
    change([...items, { id: crypto.randomUUID(), text: v.slice(0, 200), time: at, done: false, repeat: false }]);
    setText('');
    setTime('');
    inputRef.current?.focus();
  };
  const sorted = [...items].sort((a, b) => Number(a.done) - Number(b.done) || (a.time ?? '99').localeCompare(b.time ?? '99'));

  return (
    <div className={cn('flex h-full flex-col bg-card', className)}>
      <div className="pt-safe relative shrink-0 overflow-hidden border-b bg-gradient-to-br from-brand-soft via-card to-card px-4 pb-3">
        <div aria-hidden className="absolute -right-10 -top-10 size-36 rounded-full bg-brand/15 blur-2xl" />
        <div className="relative flex items-center justify-between pt-3">
          <span className="rounded-full bg-card/80 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">{fmtDate(me.today, { weekday: 'long', day: 'numeric', month: 'short' })}</span>
          {onClose && (
            <Button variant="ghost" size="icon" className="size-8" aria-label="Close" onClick={onClose}>
              <X />
            </Button>
          )}
        </div>
        <h2 className="relative mt-1 text-[19px] font-semibold leading-tight tracking-tight">
          <span className="inline-block animate-[word-in_0.5s_cubic-bezier(0.2,0.8,0.2,1)_both]">Hi, {name}</span>{' '}
          <span className="inline-block origin-[70%_70%] animate-[wave_1.6s_ease-in-out_0.4s_2]" aria-hidden>
            👋
          </span>
        </h2>
        <p className="relative mt-0.5 text-[12.5px] leading-snug text-muted-foreground">
          {GREETING_WORDS.map((w, i) => (
            <span key={i} className="inline-block animate-[word-in_0.5s_cubic-bezier(0.2,0.8,0.2,1)_both] whitespace-pre" style={{ animationDelay: `${200 + i * 45}ms` }}>
              {w}
              {i < GREETING_WORDS.length - 1 ? ' ' : ''}
            </span>
          ))}
        </p>
        <PillSwitch
          label="Panel section"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'tasks', label: 'My tasks' },
            { value: 'notifications', label: 'Notifications', badge: notes.data?.unreadCount },
          ]}
          className="relative mt-3"
        />
      </div>

      {tab === 'notifications' ? (
        <div className="flex-1 overflow-y-auto pb-3 [scrollbar-width:thin]">
          <PanelNotifications onNavigate={onClose} />
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto pb-3 [scrollbar-width:thin]">
            {me.isReporter && <TodayPriorityTasks onNavigate={onClose} />}

            <section className="px-4 pt-4" aria-labelledby="own-tasks-heading">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 id="own-tasks-heading" className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  My own tasks
                </h3>
                {items.length > 0 && (
                  <span className={cn('text-[12px] font-medium', done === items.length ? 'text-success' : 'text-foreground')}>
                    {done} of {items.length} done
                  </span>
                )}
              </div>
              {items.length > 0 && <Progress value={(done / items.length) * 100} label="Own tasks done" />}

              {editable ? (
                <form
                  className="mt-3 flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    add(text, time || null);
                  }}
                >
                  <input
                    ref={inputRef}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    maxLength={200}
                    placeholder="Add a task for today…"
                    aria-label="New routine task"
                    className="h-10 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 text-[14px] placeholder:text-muted-foreground focus-visible:border-brand focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/15"
                  />
                  <input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    aria-label="Time (optional)"
                    className="h-10 w-[100px] shrink-0 rounded-xl border border-input bg-background px-2 text-[13px] focus-visible:border-brand focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/15"
                  />
                  <Button type="submit" size="icon" className="h-10 w-10 shrink-0" disabled={!text.trim()} aria-label="Add task">
                    <Plus />
                  </Button>
                </form>
              ) : (
                <p className="mt-3 flex items-center gap-2 text-[13px] text-muted-foreground">
                  <Lock className="size-4" aria-hidden /> Past days are read-only.
                </p>
              )}

              <div className="mt-3">
                {state.carriedOver && <p className="mb-3 rounded-xl bg-info-soft px-3 py-2 text-[12px] text-info">Your “repeat daily” tasks were added for today.</p>}
                {error && (
                  <p className="mb-3 rounded-xl bg-danger-soft px-3 py-2 text-[12px] text-danger" role="alert">
                    {error}
                  </p>
                )}
                {items.length === 0 ? (
                  <div className="animate-fade-up py-4 text-center">
                    <span className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-brand-soft text-brand">
                      <ListChecks className="size-5" aria-hidden />
                    </span>
                    <p className="mt-2 text-[14px] font-medium">Nothing planned yet</p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">Tap a suggestion or type your own.</p>
                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      {SUGGESTIONS.map((s, i) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => add(s)}
                          style={{ animationDelay: `${300 + i * 60}ms` }}
                          className="tap animate-[tile-in_0.45s_cubic-bezier(0.2,0.8,0.2,1)_both] cursor-pointer rounded-full border bg-card px-3 py-1.5 text-[13px] font-medium hover:border-brand/50 hover:bg-brand-soft"
                        >
                          + {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <ul className="space-y-1.5">
                    {sorted.map((it) => (
                      <li key={it.id} className={cn('flex animate-fade-up items-center gap-3 rounded-xl border px-3 py-2 transition-colors', it.done ? 'bg-muted/50' : 'bg-card')}>
                        <button
                          type="button"
                          disabled={!editable}
                          onClick={() => change(items.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)))}
                          aria-label={it.done ? `Mark "${it.text}" not done` : `Mark "${it.text}" done`}
                          aria-pressed={it.done}
                          className={cn(
                            'flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 transition-colors',
                            it.done ? 'border-success bg-success text-white dark:text-black' : 'border-input hover:border-brand',
                          )}
                        >
                          {it.done && <Check className="size-4 animate-[icon-pop_0.35s_cubic-bezier(0.34,1.56,0.64,1)_both]" strokeWidth={3} aria-hidden />}
                        </button>
                        <span className="min-w-0 flex-1">
                          <span className={cn('block break-words text-[14px] leading-snug transition-colors', it.done && 'text-muted-foreground line-through')}>{it.text}</span>
                          {it.time && <span className="mt-0.5 block text-[12px] text-muted-foreground">{fmtTime(it.time)}</span>}
                        </span>
                        {editable && (
                          <>
                            <button
                              type="button"
                              onClick={() => change(items.map((x) => (x.id === it.id ? { ...x, repeat: !x.repeat } : x)))}
                              aria-label={it.repeat ? 'Stop repeating daily' : 'Repeat daily'}
                              aria-pressed={it.repeat}
                              title={it.repeat ? 'Repeats every day' : 'Repeat daily'}
                              className={cn('flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors', it.repeat ? 'bg-brand-soft text-brand' : 'text-muted-foreground hover:bg-muted')}
                            >
                              <Repeat className="size-4" aria-hidden />
                            </button>
                            <button
                              type="button"
                              onClick={() => change(items.filter((x) => x.id !== it.id))}
                              aria-label={`Delete "${it.text}"`}
                              className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-danger-soft hover:text-danger"
                            >
                              <Trash2 className="size-4" aria-hidden />
                            </button>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </div>

          {extra}
          <div className="pb-safe flex items-center justify-between border-t px-4 py-3 text-[12px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Lock className="size-3.5" aria-hidden /> Only you can see your own tasks
            </span>
            <span aria-live="polite">{state.saving ? 'Saving…' : state.savedAt ? 'Saved' : ''}</span>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * "My day" in the web app: a right-edge tab on every screen that opens the panel in a drawer.
 * Autosaves to the server; private to its owner.
 */
export function MyDayDrawer() {
  const state = useMyDay();
  const [open, setOpen] = useState(false);
  const { items, done } = state;
  return (
    <D.Root open={open} onOpenChange={setOpen}>
      <D.Trigger asChild>
        <button
          type="button"
          className="no-print tap fixed right-0 top-[42%] z-30 flex cursor-pointer flex-col items-center gap-1.5 rounded-l-2xl bg-primary px-1.5 py-3 text-primary-foreground shadow-[0_6px_20px_rgba(200,83,10,0.35)] hover:pr-2.5 lg:px-2"
          aria-label={`My day: ${done} of ${items.length} routine tasks done`}
        >
          <ListChecks className="size-4" aria-hidden />
          <span className="text-[11px] font-semibold tracking-wide [writing-mode:vertical-rl]">My day</span>
          {items.length > 0 && <span className="rounded-full bg-white/20 px-1 text-[10px] font-semibold tabular-nums">{done}/{items.length}</span>}
        </button>
      </D.Trigger>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 animate-fade-in bg-black/30 backdrop-blur-[2px]" />
        <D.Content className="fixed inset-y-0 right-0 z-50 w-full max-w-[420px] animate-[drawer-in_0.38s_cubic-bezier(0.2,0.8,0.2,1)_both] overflow-hidden shadow-[var(--shadow-raised)] focus:outline-none sm:rounded-l-[28px]">
          <D.Title className="sr-only">My day</D.Title>
          <D.Description className="sr-only">Plan your day besides your 3 priority tasks</D.Description>
          <MyDayPanel state={state} onClose={() => setOpen(false)} extra={<DesktopAppOffer />} />
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
