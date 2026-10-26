/**
 * DEMO backend — runs the real server operations (validation, permissions, workflows, audit)
 * in the browser against fictional test data kept in this browser's localStorage.
 * It exists for UI testing and evaluation only; production builds use the Firebase backend.
 */
import { AppError, COL, dispatch, MemoryAuth, MemoryStore, seedDemoData, type UserDoc } from '@rgk/core';
import { ApiError, AuthFailure, type Backend, type Session } from './types';

const DATA_KEY = 'rgk-worktrack-demo-data-v4';
const SESSION_KEY = 'rgk-worktrack-demo-session';

interface Persisted {
  store: ReturnType<MemoryStore['snapshot']>;
  auth: ReturnType<MemoryAuth['snapshot']>;
}

function load(): Persisted | null {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    return raw ? (JSON.parse(raw) as Persisted) : null;
  } catch {
    return null;
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function createDemoBackend(): Promise<Backend> {
  let saved = load();
  let store = new MemoryStore(saved?.store);
  let auth = new MemoryAuth(saved?.auth);
  const persist = () => {
    try {
      localStorage.setItem(DATA_KEY, JSON.stringify({ store: store.snapshot(), auth: auth.snapshot() } satisfies Persisted));
    } catch {
      // Storage full or blocked: the demo keeps working in memory for this tab.
    }
  };
  const init = async () => {
    if (!saved) {
      await seedDemoData(store, auth, { appUrl: window.location.origin });
      persist();
    }
    store.onChange = persist;
  };
  await init();

  const listeners = new Set<(s: Session | null) => void>();
  const readSession = (): (Session & { issuedAt: number }) | null => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      const s = raw ? (JSON.parse(raw) as Session & { issuedAt: number }) : null;
      return s && auth.sessionValid(s.uid, s.issuedAt) ? s : null;
    } catch {
      return null;
    }
  };
  const emit = () => {
    const s = readSession();
    listeners.forEach((cb) => cb(s ? { uid: s.uid } : null));
  };

  return {
    mode: 'demo',
    onAuthChange(cb) {
      listeners.add(cb);
      const s = readSession();
      cb(s ? { uid: s.uid } : null);
      return () => listeners.delete(cb);
    },
    async signIn(email, password) {
      await delay(250);
      const r = await auth.verify(email, password);
      if ('error' in r) throw new AuthFailure(r.error === 'auth/user-disabled' ? 'user-disabled' : 'invalid-credential');
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ uid: r.uid, issuedAt: Date.now() }));
      emit();
    },
    async signOut() {
      sessionStorage.removeItem(SESSION_KEY);
      emit();
    },
    async call(op, payload) {
      await delay(120);
      const session = readSession();
      if (!session && sessionStorage.getItem(SESSION_KEY)) {
        sessionStorage.removeItem(SESSION_KEY);
        emit();
      }
      const actor = session ? await store.get<UserDoc & { id: string }>(COL.users, session.uid) : null;
      try {
        const result = await dispatch(
          { store, auth, now: () => new Date(), actor, correlationId: crypto.randomUUID(), appUrl: window.location.origin },
          op,
          payload,
        );
        persist();
        return JSON.parse(JSON.stringify(result ?? null));
      } catch (e) {
        if (e instanceof AppError) throw new ApiError(e.code, e.message, e.details);
        console.error(e);
        throw new ApiError('internal', 'Unexpected error in demo backend.');
      }
    },
    async sendPasswordReset() {
      await delay(200);
    },
    async confirmPasswordReset() {
      throw new ApiError('failed-precondition', 'Demo mode does not send reset emails. Ask the Super Admin for a set-password link.');
    },
    async changePassword(currentPassword, newPassword) {
      const session = readSession();
      if (!session) throw new ApiError('unauthenticated', 'Please sign in again.');
      const user = await store.get<UserDoc & { id: string }>(COL.users, session.uid);
      const r = user ? await auth.verify(user.authEmail, currentPassword) : { error: 'auth/invalid-credential' as const };
      if ('error' in r) throw new ApiError('invalid-credential', 'Your current password is incorrect.');
      await auth.setPassword(session.uid, newPassword);
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ uid: session.uid, issuedAt: Date.now() }));
      persist();
    },
    async resetDemoData() {
      localStorage.removeItem(DATA_KEY);
      sessionStorage.removeItem(SESSION_KEY);
      saved = null;
      store = new MemoryStore();
      auth = new MemoryAuth();
      await init();
      emit();
    },
  };
}
