import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  confirmPasswordReset,
  connectAuthEmulator,
  EmailAuthProvider,
  getAuth,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
} from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { ApiError, AuthFailure, type Backend } from './types';

export interface FirebaseEnv {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
  region: string;
  useEmulators: boolean;
}

export function readFirebaseEnv(): FirebaseEnv {
  const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : ({} as Record<string, string>);
  return {
    apiKey: env.VITE_FIREBASE_API_KEY || 'AIzaSyDeZeLTNEVQcfNLFwymHEDxL2DnBfuy3FA',
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'task-8861a.firebaseapp.com',
    projectId: env.VITE_FIREBASE_PROJECT_ID || 'task-8861a',
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || 'task-8861a.firebasestorage.app',
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '783521347645',
    appId: env.VITE_FIREBASE_APP_ID || '1:783521347645:web:40df826eb1c32c5acf5254',
    region: env.VITE_FIREBASE_FUNCTIONS_REGION || 'asia-south1',
    useEmulators: env.VITE_USE_EMULATORS === 'true',
  };
}

function mapAuthError(e: unknown): AuthFailure {
  const code = (e as { code?: string }).code ?? '';
  if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email'].includes(code)) return new AuthFailure('invalid-credential');
  if (code === 'auth/user-disabled') return new AuthFailure('user-disabled');
  if (code === 'auth/too-many-requests') return new AuthFailure('too-many-requests');
  if (code === 'auth/network-request-failed') return new AuthFailure('network');
  return new AuthFailure('unknown');
}

export function createFirebaseBackend(cfg: FirebaseEnv): Backend {
  const app: FirebaseApp = initializeApp({
    apiKey: cfg.apiKey,
    authDomain: cfg.authDomain,
    projectId: cfg.projectId,
    storageBucket: cfg.storageBucket,
    messagingSenderId: cfg.messagingSenderId,
    appId: cfg.appId,
  });
  const auth = getAuth(app);
  const functions = getFunctions(app, cfg.region);
  if (cfg.useEmulators) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  }
  const api = httpsCallable<{ op: string; payload: unknown }, unknown>(functions, 'api', { timeout: 120_000 });

  return {
    mode: 'firebase',
    onAuthChange: (cb) => onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid } : null)),
    async signIn(email, password) {
      try {
        await signInWithEmailAndPassword(auth, email, password);
      } catch (e) {
        throw mapAuthError(e);
      }
    },
    signOut: () => signOut(auth),
    async call(op, payload) {
      try {
        return (await api({ op, payload })).data;
      } catch (e) {
        const err = e as { code?: string; message?: string; details?: unknown };
        const code = (err.code ?? 'internal').replace(/^functions\//, '');
        throw new ApiError(code, code === 'unavailable' ? 'Cannot reach the server. Check your connection and try again.' : (err.message ?? 'Request failed'), err.details);
      }
    },
    async sendPasswordReset(email) {
      try {
        await sendPasswordResetEmail(auth, email, { url: `${window.location.origin}/login` });
      } catch (e) {
        // Never reveal whether an account exists; only surface rate limiting.
        if ((e as { code?: string }).code === 'auth/too-many-requests') throw mapAuthError(e);
      }
    },
    async confirmPasswordReset(oobCode, newPassword) {
      try {
        await confirmPasswordReset(auth, oobCode, newPassword);
      } catch (e) {
        throw new ApiError('failed-precondition', 'This reset link is invalid or has expired. Request a new one.', e);
      }
    },
    async changePassword(currentPassword, newPassword) {
      const user = auth.currentUser;
      if (!user?.email) throw new ApiError('unauthenticated', 'Please sign in again.');
      try {
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
        await updatePassword(user, newPassword);
      } catch (e) {
        const f = mapAuthError(e);
        throw new ApiError(f.reason, f.reason === 'invalid-credential' ? 'Your current password is incorrect.' : 'Could not change the password. Try again.');
      }
    },
  };
}
