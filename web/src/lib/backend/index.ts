import type { Backend } from './types';

export type BackendInit =
  | { status: 'ready'; backend: Backend }
  | { status: 'setup-required'; reason: string };

/**
 * Pick the backend from build-time configuration or user choice.
 * Defaults to demo so the app works immediately out-of-the-box on Vercel without broken screens.
 */
export async function initBackend(): Promise<BackendInit> {
  const savedMode = typeof window !== 'undefined' ? (localStorage.getItem('rgk_backend_mode') as 'firebase' | 'demo' | null) : null;
  const mode = savedMode ?? (import.meta.env.VITE_BACKEND === 'firebase' ? 'firebase' : 'demo');
  if (mode === 'demo') {
    const { createDemoBackend } = await import('./demo');
    return { status: 'ready', backend: await createDemoBackend() };
  }
  const { createFirebaseBackend, readFirebaseEnv } = await import('./firebase');
  const cfg = readFirebaseEnv();
  return { status: 'ready', backend: createFirebaseBackend(cfg) };
}

export * from './types';
