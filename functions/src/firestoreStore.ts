import type { Firestore, Query, Transaction } from 'firebase-admin/firestore';
import { StoreError, type CollectionName, type Doc, type QuerySpec, type Store, type Tx } from '@rgk/core';

/** Firestore implementation of the core Store interface (Admin SDK; bypasses security rules by design). */
export class FirestoreStore implements Store {
  constructor(private readonly db: Firestore) {}

  async get<T extends Doc>(col: CollectionName, id: string): Promise<T | null> {
    const snap = await this.db.collection(col).doc(id).get();
    return snap.exists ? ({ ...snap.data(), id: snap.id } as T) : null;
  }

  async getMany<T extends Doc>(col: CollectionName, ids: string[]): Promise<T[]> {
    const unique = [...new Set(ids)];
    if (!unique.length) return [];
    const out: T[] = [];
    for (let i = 0; i < unique.length; i += 300) {
      const refs = unique.slice(i, i + 300).map((id) => this.db.collection(col).doc(id));
      const snaps = await this.db.getAll(...refs);
      for (const s of snaps) if (s.exists) out.push({ ...s.data(), id: s.id } as T);
    }
    return out;
  }

  private build(col: CollectionName, q: QuerySpec): Query {
    let query: Query = this.db.collection(col);
    for (const [field, op, value] of q.where ?? []) query = query.where(field, op, value);
    for (const [field, dir] of q.orderBy ?? []) query = query.orderBy(field, dir);
    if (q.startAfter?.length) query = query.startAfter(...q.startAfter);
    if (q.limit !== undefined) query = query.limit(q.limit);
    return query;
  }

  async query<T extends Doc>(col: CollectionName, q: QuerySpec = {}): Promise<T[]> {
    const snap = await this.build(col, q).get();
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as T);
  }

  transaction<R>(fn: (tx: Tx) => Promise<R>): Promise<R> {
    return this.db.runTransaction(async (t: Transaction) => {
      const ref = (c: CollectionName, id: string) => this.db.collection(c).doc(id);
      const strip = (d: Doc) => {
        const { id: _id, ...rest } = d;
        return rest;
      };
      const tx: Tx = {
        get: async <T extends Doc>(c: CollectionName, id: string) => {
          const s = await t.get(ref(c, id));
          return s.exists ? ({ ...s.data(), id: s.id } as T) : null;
        },
        create: (c, id, data) => void t.create(ref(c, id), { ...strip(data), id }),
        set: (c, id, data) => void t.set(ref(c, id), { ...strip(data), id }),
        update: (c, id, patch) => void t.update(ref(c, id), patch),
        delete: (c, id) => void t.delete(ref(c, id)),
      };
      return fn(tx);
    }).catch((e: { code?: number | string; message?: string }) => {
      // gRPC ALREADY_EXISTS (6) from tx.create on an existing document.
      if (e?.code === 6 || e?.code === 'already-exists') throw new StoreError('ALREADY_EXISTS', e.message ?? 'Document already exists');
      throw e;
    });
  }
}
