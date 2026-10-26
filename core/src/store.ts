import type { CollectionName } from './types';

export type WhereOp = '==' | 'in' | '>=' | '<=' | '>' | '<' | 'array-contains';
export type Filter = [field: string, op: WhereOp, value: unknown];
export type OrderBy = [field: string, dir: 'asc' | 'desc'];

export interface QuerySpec {
  where?: Filter[];
  orderBy?: OrderBy[];
  limit?: number;
  /** Values of the orderBy fields of the last document of the previous page. */
  startAfter?: unknown[];
}

export type Doc = { id: string };
/** Data accepted by writes: a typed document or a plain object literal. */
export type WriteData = Doc | ({ id: string } & Record<string, unknown>);

/**
 * Transaction handle. Like Firestore, all reads must happen before any write.
 */
export interface Tx {
  get<T extends Doc>(col: CollectionName, id: string): Promise<T | null>;
  /** Fails with ALREADY_EXISTS if the document exists. */
  create(col: CollectionName, id: string, data: WriteData): void;
  set(col: CollectionName, id: string, data: WriteData): void;
  update(col: CollectionName, id: string, patch: Record<string, unknown>): void;
  delete(col: CollectionName, id: string): void;
}

export interface Store {
  get<T extends Doc>(col: CollectionName, id: string): Promise<T | null>;
  getMany<T extends Doc>(col: CollectionName, ids: string[]): Promise<T[]>;
  query<T extends Doc>(col: CollectionName, q?: QuerySpec): Promise<T[]>;
  transaction<R>(fn: (tx: Tx) => Promise<R>): Promise<R>;
}

/** Split `in` queries into Firestore-sized chunks (max 30 values per `in`). */
export async function queryIn<T extends Doc>(
  store: Store,
  col: CollectionName,
  field: string,
  values: string[],
  rest: QuerySpec = {},
): Promise<T[]> {
  const unique = [...new Set(values)];
  const out: T[] = [];
  for (let i = 0; i < unique.length; i += 30) {
    const chunk = unique.slice(i, i + 30);
    out.push(...(await store.query<T>(col, { ...rest, where: [[field, 'in', chunk], ...(rest.where ?? [])] })));
  }
  return out;
}

export class StoreError extends Error {
  constructor(
    public readonly code: 'ALREADY_EXISTS' | 'NOT_FOUND' | 'READ_AFTER_WRITE',
    message: string,
  ) {
    super(message);
  }
}
