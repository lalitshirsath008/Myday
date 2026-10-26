import type { Backend } from './types';

export type BackendInit =
  | { status: 'ready'; backend: Backend }
  | { status: 'setup-required'; reason: string };

/**
 * Pick the backend from build-time configuration. Production never silently falls back to the
 * demo: without Firebase settings the app shows setup instructions instead.
 */
export async function initBackend(): Promise<BackendInit> {
  const mode = import.meta.env.VITE_BACKEND ?? 'firebase';
  if (mode === 'demo') {
    const { createDemoBackend } = await import('./demo');
    return { status: 'ready', backend: await createDemoBackend() };
  }
  const { createFirebaseBackend, readFirebaseEnv } = await import('./firebase');
  const cfg = readFirebaseEnv();
  if (!cfg) return { status: 'setup-required', reason: 'Firebase is not configured for this build (VITE_FIREBASE_* variables are missing).' };
  return { status: 'ready', backend: createFirebaseBackend(cfg) };
}

export * from './types';
