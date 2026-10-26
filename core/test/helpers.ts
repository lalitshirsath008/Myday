import { MemoryAuth } from '../src/authAdmin';
import { zonedDateTimeToInstant, type DateStr } from '../src/dates';
import { MemoryStore } from '../src/memoryStore';
import type { TaskInput } from '../src/schemas';
import { dispatch, type OpInput, type OpName, type OpOutput } from '../src/ops';
import type { Ctx } from '../src/ops/context';
import { seedDemoData, type SeedResult } from '../src/seed';
import { COL, type UserDoc } from '../src/types';

/** A fixed "now": Saturday 25 Oct 2025, 10:00 IST (Wednesday 22 Oct is the usual weekly holiday). */
export const NOW = zonedDateTimeToInstant('2025-10-25', '10:00', 'Asia/Kolkata');

export interface World {
  store: MemoryStore;
  auth: MemoryAuth;
  seed: SeedResult;
  clock: { now: Date };
  ctx(actorKey: string | null): Promise<Ctx>;
  call<K extends OpName>(actorKey: string | null, name: K, input: OpInput<K>): Promise<OpOutput<K>>;
  id(key: string): string;
  at(date: DateStr, time: string): Date;
}

export async function makeWorld(opts: { withHistory?: boolean; now?: Date } = {}): Promise<World> {
  const store = new MemoryStore();
  const auth = new MemoryAuth();
  const now = opts.now ?? NOW;
  const seed = await seedDemoData(store, auth, { now, withHistory: opts.withHistory ?? false });
  const clock = { now };
  const id = (key: string) => {
    const u = seed.users[key];
    if (!u) throw new Error(`unknown user key ${key}`);
    return u.id;
  };
  const ctx = async (key: string | null): Promise<Ctx> => ({
    store,
    auth,
    now: () => clock.now,
    actor: key ? ((await store.get<UserDoc & { id: string }>(COL.users, id(key))) as UserDoc) : null,
    correlationId: 'test',
    appUrl: 'http://localhost:5173',
  });
  return {
    store,
    auth,
    seed,
    clock,
    ctx,
    id,
    at: (date, time) => zonedDateTimeToInstant(date, time, 'Asia/Kolkata'),
    call: async (key, name, input) => (await dispatch(await ctx(key), name, input)) as OpOutput<typeof name>,
  };
}

export function task(overrides: Partial<TaskInput> = {}): TaskInput {
  return {
    title: 'Prepare shift report',
    description: 'Compile output and downtime for shift A.',
    priority: 'HIGH',
    plannedStartTime: '09:00',
    plannedEndTime: '11:00',
    actualStartTime: null,
    actualEndTime: null,
    overnight: false,
    dueDate: null,
    projectId: null,
    category: 'Production',
    collaboratorIds: [],
    progressPercentage: 50,
    status: 'IN_PROGRESS',
    notes: '',
    ...overrides,
  };
}

export async function expectCode(p: Promise<unknown>, code: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    const got = (e as { code?: string }).code;
    if (got !== code) throw new Error(`Expected error code ${code}, got ${got}: ${(e as Error).message}`);
    return;
  }
  throw new Error(`Expected error code ${code}, but the call succeeded`);
}
