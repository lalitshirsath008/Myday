import { createLiveBackend } from './live';
import type { Backend } from './types';

export type BackendInit =
  | { status: 'ready'; backend: Backend }
  | { status: 'setup-required'; reason: string };

/**
 * RGK WorkTrack 100% Free Production Backend.
 * Always initializes the live persistent standalone engine.
 * Never calls non-deployed Cloud Functions or requires Blaze plan.
 */
export async function initBackend(): Promise<BackendInit> {
  const backend = await createLiveBackend();
  return { status: 'ready', backend };
}

export * from './types';
