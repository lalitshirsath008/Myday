import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  runTransaction,
  startAfter,
  where,
  type Firestore,
  type QueryConstraint,
  type WhereFilterOp,
} from 'firebase/firestore';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  StoreError,
  type CollectionName,
  type Doc,
  type QuerySpec,
  type Store,
  type Tx,
} from '@rgk/core';
import { readFirebaseEnv } from './firebase';

/**
 * Direct Client-Side Cloud Firestore implementation of the Store interface.
 * Operates on the 100% Free Firebase Spark plan with zero Google Cloud Functions or Blaze billing.
 */
export class ClientFirestoreStore implements Store {
  private db: Firestore;

  constructor(customDb?: Firestore) {
    if (customDb) {
      this.db = customDb;
    } else {
      const cfg = readFirebaseEnv();
      const app = getApps().length
        ? getApp()
        : initializeApp({
            apiKey: cfg.apiKey,
            authDomain: cfg.authDomain,
            projectId: cfg.projectId,
            storageBucket: cfg.storageBucket,
            messagingSenderId: cfg.messagingSenderId,
            appId: cfg.appId,
          });
      this.db = getFirestore(app);
    }
  }

  async get<T extends Doc>(col: CollectionName, id: string): Promise<T | null> {
    const snap = await getDoc(doc(this.db, col, id));
    return snap.exists() ? ({ ...snap.data(), id: snap.id } as T) : null;
  }

  async getMany<T extends Doc>(col: CollectionName, ids: string[]): Promise<T[]> {
    const unique = [...new Set(ids)];
    if (!unique.length) return [];
    const snaps = await Promise.all(unique.map((id) => getDoc(doc(this.db, col, id))));
    return snaps.filter((s) => s.exists()).map((s) => ({ ...s.data(), id: s.id } as T));
  }

  async query<T extends Doc>(col: CollectionName, qSpec: QuerySpec = {}): Promise<T[]> {
    const constraints: QueryConstraint[] = [];
    for (const [field, op, value] of qSpec.where ?? []) {
      constraints.push(where(field, op as WhereFilterOp, value));
    }
    for (const [field, dir] of qSpec.orderBy ?? []) {
      constraints.push(orderBy(field, dir));
    }
    if (qSpec.startAfter?.length) {
      constraints.push(startAfter(...qSpec.startAfter));
    }
    if (qSpec.limit !== undefined) {
      constraints.push(limit(qSpec.limit));
    }
    const q = query(collection(this.db, col), ...constraints);
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ ...d.data(), id: d.id } as T));
  }

  async transaction<R>(fn: (tx: Tx) => Promise<R>): Promise<R> {
    return runTransaction(this.db, async (t) => {
      const ref = (c: CollectionName, id: string) => doc(this.db, c, id);
      const strip = (d: Doc) => {
        const { id: _id, ...rest } = d;
        return rest;
      };
      const tx: Tx = {
        get: async <T extends Doc>(c: CollectionName, id: string) => {
          const s = await t.get(ref(c, id));
          return s.exists() ? ({ ...s.data(), id: s.id } as T) : null;
        },
        create: (c, id, data) => void t.set(ref(c, id), { ...strip(data), id }),
        set: (c, id, data) => void t.set(ref(c, id), { ...strip(data), id }),
        update: (c, id, patch) => void t.update(ref(c, id), patch),
        delete: (c, id) => void t.delete(ref(c, id)),
      };
      return fn(tx);
    }).catch((e: { code?: string; message?: string }) => {
      if (e?.code === 'already-exists') throw new StoreError('ALREADY_EXISTS', e.message ?? 'Document already exists');
      throw e;
    });
  }
}
