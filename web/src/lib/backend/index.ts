import { createFirebaseBackend, readFirebaseEnv } from './firebase';
import { createLiveBackend } from './live';
import type { Backend } from './types';

export type BackendInit =
  | { status: 'ready'; backend: Backend }
  | { status: 'setup-required'; reason: string };

/**
 * RGK WorkTrack Production Backend.
 * Uses live persistent standalone engine by default (100% Free, zero cloud bill / Blaze plan required).
 * Switches to Firebase Cloud Functions only if explicitly configured via VITE_BACKEND=firebase.
 */
export async function initBackend(): Promise<BackendInit> {
  const backendChoice = import.meta.env.VITE_BACKEND;
  if (backendChoice === 'firebase') {
    const cfg = readFirebaseEnv();
    return { status: 'ready', backend: createFirebaseBackend(cfg) };
  }
  const backend = await createLiveBackend();
  return { status: 'ready', backend };
}

export * from './types';
