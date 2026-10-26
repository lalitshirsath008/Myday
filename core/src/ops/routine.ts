import { z } from 'zod';
import { addDays, todayIn } from '../dates';
import { invalid } from '../errors';
import { dateStr, timeStr } from '../schemas';
import { COL } from '../types';
import { nowIso, op } from './context';
import { getSettings } from './helpers';

/** A personal routine item: work besides the 3 priority tasks. Private to its owner. */
export interface RoutineItem {
  id: string;
  text: string;
  time: string | null;
  done: boolean;
  repeat: boolean;
}

export interface RoutineDoc {
  id: string;
  userId: string;
  date: string;
  items: RoutineItem[];
  updatedAt: string;
}

const MAX_ITEMS = 30;
const LOOKBACK_DAYS = 14;

const itemInput = z.object({
  id: z.string().min(1).max(64),
  text: z.string().trim().min(1, 'Write the task').max(200),
  time: timeStr.nullable().default(null),
  done: z.boolean().default(false),
  repeat: z.boolean().default(false),
});

const routineId = (userId: string, date: string) => `${userId}_${date}`;

export const routineOps = {
  /**
   * The user's routine list for a day. A new day starts with yesterday's (most recent) "repeat daily"
   * items, unticked. Only the owner can read their own list.
   */
  'routine.get': op({
    input: z.object({ date: dateStr.nullable().default(null) }),
    run: async (ctx, input) => {
      const settings = await getSettings(ctx);
      const today = todayIn(settings.timezone, ctx.now());
      const date = input.date ?? today;
      if (date > today || date < addDays(today, -60)) throw invalid('Choose a date within the last 60 days.');
      const doc = await ctx.store.get<RoutineDoc>(COL.dailyRoutines, routineId(ctx.actor.id, date));
      if (doc) return { date, today, items: doc.items, editable: date === today, carriedOver: false, updatedAt: doc.updatedAt };
      if (date !== today) return { date, today, items: [], editable: false, carriedOver: false, updatedAt: null };
      const previous = await ctx.store.query<RoutineDoc>(COL.dailyRoutines, {
        where: [['userId', '==', ctx.actor.id], ['date', '<', today], ['date', '>=', addDays(today, -LOOKBACK_DAYS)]],
        orderBy: [['date', 'desc']],
        limit: 1,
      });
      const repeating = (previous[0]?.items ?? []).filter((i) => i.repeat).map((i) => ({ ...i, done: false }));
      return { date, today, items: repeating, editable: true, carriedOver: repeating.length > 0, updatedAt: null };
    },
  }),

  /** Replace today's list (the client autosaves the whole list; it is small and owned by one person). */
  'routine.save': op({
    input: z.object({ items: z.array(itemInput).max(MAX_ITEMS, `At most ${MAX_ITEMS} routine tasks`) }),
    run: async (ctx, { items }) => {
      const settings = await getSettings(ctx);
      const today = todayIn(settings.timezone, ctx.now());
      const ids = new Set(items.map((i) => i.id));
      if (ids.size !== items.length) throw invalid('Duplicate routine task.');
      const doc: RoutineDoc = { id: routineId(ctx.actor.id, today), userId: ctx.actor.id, date: today, items, updatedAt: nowIso(ctx) };
      await ctx.store.transaction(async (tx) => tx.set(COL.dailyRoutines, doc.id, doc));
      return { date: today, updatedAt: doc.updatedAt, count: items.length, done: items.filter((i) => i.done).length };
    },
  }),
};
