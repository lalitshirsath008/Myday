import { createFirebaseBackend, readFirebaseEnv } from './firebase';
import type { Backend } from './types';

export type BackendInit =
  | { status: 'ready'; backend: Backend }
  | { status: 'setup-required'; reason: string };

/**
 * 100% Live Firebase Backend for RGK WorkTrack (task-8861a).
 */
export async function initBackend(): Promise<BackendInit> {
  const cfg = readFirebaseEnv();
  return { status: 'ready', backend: createFirebaseBackend(cfg) };
}

export * from './types';
