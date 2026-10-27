import { StoreError, type Doc, type Filter, type QuerySpec, type Store, type Tx } from './store';
import type { CollectionName } from './types';

type Data = Record<string, Record<string, Doc>>;

function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

function getField(doc: Doc, path: string): unknown {
  let cur: unknown = doc;
  for (const k of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  return (a as number | string) < (b as number | string) ? -1 : 1;
}

function matches(doc: Doc, [field, op, value]: Filter): boolean {
  const v = getField(doc, field);
  switch (op) {
    case '==':
      return v === value;
    case 'in':
      return (value as unknown[]).includes(v);
    case 'array-contains':
      return Array.isArray(v) && v.includes(value);
    case '>=':
      return v !== undefined && v !== null && compare(v, value) >= 0;
    case '<=':
      return v !== undefined && v !== null && compare(v, value) <= 0;
    case '>':
      return v !== undefined && v !== null && compare(v, value) > 0;
    case '<':
      return v !== undefined && v !== null && compare(v, value) < 0;
  }
}

export interface StoreChange {
  col: string;
  id: string;
  doc: Doc | null;
}

/**
 * In-memory implementation of Store with Firestore-like semantics (including the
 * reads-before-writes transaction rule). Used by unit tests and the browser demo backend.
 */
export class MemoryStore implements Store {
  private data: Data;
  private queue: Promise<unknown> = Promise.resolve();
  onChange?: (changes: StoreChange[]) => void;

  constructor(initial?: Data) {
    this.data = initial ? clone(initial) : {};
  }

  snapshot(): Data {
    return clone(this.data);
  }

  private col(name: string): Record<string, Doc> {
    return (this.data[name] ??= {});
  }

  async get<T extends Doc>(col: CollectionName, id: string): Promise<T | null> {
    const d = this.col(col)[id];
    return d ? (clone(d) as T) : null;
  }

  async getMany<T extends Doc>(col: CollectionName, ids: string[]): Promise<T[]> {
    const out: T[] = [];
    for (const id of new Set(ids)) {
      const d = this.col(col)[id];
      if (d) out.push(clone(d) as T);
    }
    return out;
  }

  async query<T extends Doc>(col: CollectionName, q: QuerySpec = {}): Promise<T[]> {
    let docs = Object.values(this.col(col)).filter((d) => (q.where ?? []).every((f) => matches(d, f)));
    const order = q.orderBy ?? [];
    if (order.length) {
      docs.sort((a, b) => {
        for (const [field, dir] of order) {
          const c = compare(getField(a, field), getField(b, field));
          if (c !== 0) return dir === 'asc' ? c : -c;
        }
        return compare(a.id, b.id);
      });
    }
    if (q.startAfter && order.length) {
      const after = q.startAfter;
      docs = docs.filter((d) => {
        for (let i = 0; i < order.length; i++) {
          const [field, dir] = order[i]!;
          const c = compare(getField(d, field), after[i]);
          if (c !== 0) return dir === 'asc' ? c > 0 : c < 0;
        }
        return false;
      });
    }
    if (q.limit !== undefined) docs = docs.slice(0, q.limit);
    return docs.map((d) => clone(d) as T);
  }

  /** Transactions run one at a time, which gives serializable isolation in-process. */
  transaction<R>(fn: (tx: Tx) => Promise<R>): Promise<R> {
    const run = async () => {
      const writes: Array<() => void> = [];
      let wrote = false;
      const pending = new Map<string, Doc | null>();
      const key = (c: string, id: string) => `${c}/${id}`;
      const current = (c: string, id: string): Doc | null => {
        const k = key(c, id);
        return pending.has(k) ? pending.get(k)! : (this.col(c)[id] ?? null);
      };
      const tx: Tx = {
        get: async <T extends Doc>(c: CollectionName, id: string) => {
          if (wrote) throw new StoreError('READ_AFTER_WRITE', `Transaction read ${c}/${id} after a write`);
          const d = this.col(c)[id];
          return d ? (clone(d) as T) : null;
        },
        create: (c, id, data) => {
          wrote = true;
          if (current(c, id)) throw new StoreError('ALREADY_EXISTS', `${c}/${id} already exists`);
          const v = clone({ ...data, id });
          pending.set(key(c, id), v);
          writes.push(() => (this.col(c)[id] = v));
        },
        set: (c, id, data) => {
          wrote = true;
          const v = clone({ ...data, id });
          pending.set(key(c, id), v);
          writes.push(() => (this.col(c)[id] = v));
        },
        update: (c, id, patch) => {
          wrote = true;
          const existing = current(c, id);
          if (!existing) throw new StoreError('NOT_FOUND', `${c}/${id} not found`);
          const v = clone({ ...existing, ...patch, id });
          pending.set(key(c, id), v);
          writes.push(() => (this.col(c)[id] = v));
        },
        delete: (c, id) => {
          wrote = true;
          pending.set(key(c, id), null);
          writes.push(() => delete this.col(c)[id]);
        },
      };
      const result = await fn(tx);
      for (const w of writes) w();
      if (writes.length) {
        const changes: StoreChange[] = [];
        for (const [k, v] of pending.entries()) {
          const slash = k.indexOf('/');
          const col = k.slice(0, slash);
          const id = k.slice(slash + 1);
          changes.push({ col, id, doc: v });
        }
        this.onChange?.(changes);
      }
      return result;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }
}
