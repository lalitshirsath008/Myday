/**
 * RGK Myday LIVE Cloud-Connected Standalone Engine.
 *
 * Runs full server operations (@rgk/core: validation, permissions, 23 departments,
 * daily/weekly reports, reviews, analytics, routines, and user management)
 * directly with persistent Cloud Firestore (task-8861a) and browser caching.
 * Zero dependence on Google Cloud Functions or paid Blaze plans. 100% Free forever.
 */
import {
  AppError,
  COL,
  codeKey,
  dailyKey,
  dispatch,
  INITIAL_ADMIN_PASSWORD,
  MemoryAuth,
  MemoryStore,
  phoneKey,
  RGK_DEPARTMENTS,
  seedProductionData,
  type UserDoc,
} from '@rgk/core';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  setDoc,
  getDocs,
  collection,
  onSnapshot,
  type Firestore,
} from 'firebase/firestore';
import { ApiError, AuthFailure, type Backend, type Session } from './types';
import { readFirebaseEnv } from './firebase';

const DATA_KEY = 'rgk_worktrack_live_db_v1';
const SESSION_KEY = 'rgk_worktrack_live_session_v1';

interface Persisted {
  store: ReturnType<MemoryStore['snapshot']>;
  auth: ReturnType<MemoryAuth['snapshot']>;
}

function loadLocal(): Persisted | null {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    return raw ? (JSON.parse(raw) as Persisted) : null;
  } catch {
    return null;
  }
}

export async function createLiveBackend(): Promise<Backend> {
  const saved = loadLocal();
  const store = new MemoryStore(saved?.store);
  const auth = new MemoryAuth(saved?.auth);

  // Initialize Firestore
  const cfg = readFirebaseEnv();
  const fbApp = getApps().length
    ? getApp()
    : initializeApp({
        apiKey: cfg.apiKey,
        authDomain: cfg.authDomain,
        projectId: cfg.projectId,
        storageBucket: cfg.storageBucket,
        messagingSenderId: cfg.messagingSenderId,
        appId: cfg.appId,
      });
  const db: Firestore = getFirestore(fbApp);

  const persistToFirestore = async () => {
    try {
      const snap = store.snapshot();
      const collectionsToSync = [
        'users',
        'departments',
        'dailyReports',
        'weeklyReports',
        'tasks',
        'systemSettings',
        'projects',
        'workCalendar',
        'dailyRoutines',
        'notifications',
        'reportReviews',
        'reportVersions',
      ];
      for (const colName of collectionsToSync) {
        const colDocs = snap[colName];
        if (colDocs) {
          for (const [id, data] of Object.entries(colDocs)) {
            // Asynchronously sync to Cloud Firestore
            setDoc(doc(db, colName, id), data).catch(() => {});
          }
        }
      }
      for (const u of auth.snapshot()) {
        setDoc(doc(db, 'authUsers', u.uid), u).catch(() => {});
      }
    } catch {
      // Background sync non-fatal error
    }
  };

  const persist = () => {
    try {
      localStorage.setItem(
        DATA_KEY,
        JSON.stringify({ store: store.snapshot(), auth: auth.snapshot() } satisfies Persisted)
      );
    } catch {
      // Storage quota or private browsing mode
    }
    // Mirror to Cloud Firestore
    void persistToFirestore();
  };

  const init = async () => {
    // 1. Try to hydrate from Cloud Firestore first
    try {
      const [usersSnap, authSnap, deptSnap, dailySnap, weeklySnap, routineSnap, tasksSnap, projSnap] = await Promise.all([
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'authUsers')),
        getDocs(collection(db, 'departments')),
        getDocs(collection(db, 'dailyReports')),
        getDocs(collection(db, 'weeklyReports')),
        getDocs(collection(db, 'dailyRoutines')),
        getDocs(collection(db, 'tasks')),
        getDocs(collection(db, 'projects')),
      ]);

      if (!usersSnap.empty) {
        await store.transaction(async (tx) => {
          usersSnap.forEach((d) => {
            const u = d.data() as UserDoc;
            tx.set(COL.users, d.id, u as never);
            if (u.employeeCode) {
              const k = codeKey(u.employeeCode);
              tx.set(COL.uniqueKeys, k, { id: k, ownerId: d.id, createdAt: '' });
            }
            if (u.phoneNumber) {
              const k = phoneKey(u.phoneNumber);
              tx.set(COL.uniqueKeys, k, { id: k, ownerId: d.id, createdAt: '' });
            }
            if (u.authEmail) {
              const k = `email_${u.authEmail.toLowerCase()}`;
              tx.set(COL.uniqueKeys, k, { id: k, ownerId: d.id, createdAt: '' });
            }
            if (u.officialEmail) {
              const k = `email_${u.officialEmail.toLowerCase()}`;
              tx.set(COL.uniqueKeys, k, { id: k, ownerId: d.id, createdAt: '' });
            }
          });
        });
      }

      if (!authSnap.empty) {
        authSnap.forEach((d) => {
          const u = d.data() as {
            uid: string;
            email: string;
            disabled: boolean;
            salt: string | null;
            hash: string | null;
            tokensValidAfter: number;
          };
          if (u.uid) {
            auth.users.set(u.uid, u);
          }
        });
      }

      if (!deptSnap.empty) {
        await store.transaction(async (tx) => {
          deptSnap.forEach((d) => {
            tx.set(COL.departments, d.id, d.data() as never);
          });
        });
      }

      if (!dailySnap.empty) {
        await store.transaction(async (tx) => {
          dailySnap.forEach((d) => {
            const rep = d.data() as { employeeId?: string; workDate?: string; createdAt?: string };
            tx.set(COL.dailyReports, d.id, rep as never);
            if (rep.employeeId && rep.workDate) {
              const k = dailyKey(rep.employeeId, rep.workDate);
              tx.set(COL.uniqueKeys, k, { id: k, ownerId: d.id, createdAt: rep.createdAt || '' });
            }
          });
        });
      }

      if (!weeklySnap.empty) {
        await store.transaction(async (tx) => {
          weeklySnap.forEach((d) => {
            tx.set(COL.weeklyReports, d.id, d.data() as never);
          });
        });
      }

      if (!routineSnap.empty) {
        await store.transaction(async (tx) => {
          routineSnap.forEach((d) => {
            tx.set(COL.dailyRoutines, d.id, d.data() as never);
          });
        });
      }

      if (!tasksSnap.empty) {
        await store.transaction(async (tx) => {
          tasksSnap.forEach((d) => {
            tx.set(COL.tasks, d.id, d.data() as never);
          });
        });
      }

      if (!projSnap.empty) {
        await store.transaction(async (tx) => {
          projSnap.forEach((d) => {
            tx.set(COL.projects, d.id, d.data() as never);
          });
        });
      }
    } catch (err) {
      console.warn('Hydration from Cloud Firestore notice (offline/initial):', err);
    }

    // 2. Ensure baseline ADMIN01 + 23 departments exist
    const adminExists = await store.get<UserDoc & { id: string }>(COL.users, 'seed_admin01');
    if (!adminExists) {
      await seedProductionData(store, auth, { appUrl: window.location.origin });
      persist();
    } else {
      // The first admin password is public (it is in this code). While it still works, the next
      // sign-in must choose a new one. The password is never reset back to it.
      const stillInitial = !('error' in (await auth.verify(adminExists.authEmail, INITIAL_ADMIN_PASSWORD)));
      if (stillInitial && !adminExists.mustChangePassword) {
        await store.transaction(async (tx) => tx.update(COL.users, adminExists.id, { mustChangePassword: true }));
      }

      // Ensure all 23 departments exist
      for (const d of RGK_DEPARTMENTS) {
        const dep = await store.get(COL.departments, d.id);
        if (!dep) {
          await store.transaction(async (tx) => {
            tx.set(COL.departments, d.id, {
              id: d.id,
              name: d.name,
              code: d.code,
              description: `${d.name} Department`,
              active: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          });
        }
      }
      // Real-time live Firestore synchronization for multi-device sync (Web <-> Desktop)
      try {
        onSnapshot(collection(db, 'dailyReports'), (snap) => {
          if (!snap.empty) {
            void store.transaction(async (tx) => {
              snap.docChanges().forEach((c) => {
                if (c.type === 'removed') {
                  tx.delete(COL.dailyReports, c.doc.id);
                } else {
                  const rep = c.doc.data() as { employeeId?: string; workDate?: string; createdAt?: string };
                  tx.set(COL.dailyReports, c.doc.id, rep as never);
                  if (rep.employeeId && rep.workDate) {
                    const k = dailyKey(rep.employeeId, rep.workDate);
                    tx.set(COL.uniqueKeys, k, { id: k, ownerId: c.doc.id, createdAt: rep.createdAt || '' });
                  }
                }
              });
            });
          }
        });

        onSnapshot(collection(db, 'dailyRoutines'), (snap) => {
          if (!snap.empty) {
            void store.transaction(async (tx) => {
              snap.docChanges().forEach((c) => {
                if (c.type === 'removed') {
                  tx.delete(COL.dailyRoutines, c.doc.id);
                } else {
                  tx.set(COL.dailyRoutines, c.doc.id, c.doc.data() as never);
                }
              });
            });
          }
        });
      } catch (err) {
        console.warn('Real-time listener setup non-fatal:', err);
      }
    }
    store.onChange = persist;
  };

  await init();

  const listeners = new Set<(s: Session | null) => void>();

  const readSession = (): (Session & { issuedAt: number }) | null => {
    try {
      const raw = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
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
    mode: 'firebase', // UI treats this as live production mode
    onAuthChange(cb) {
      listeners.add(cb);
      const s = readSession();
      cb(s ? { uid: s.uid } : null);
      return () => listeners.delete(cb);
    },
    async signIn(emailOrIdentifier, password) {
      const input = emailOrIdentifier.trim();
      let targetEmail = input.toLowerCase();

      // Check if input is employeeCode, officialEmail, or phone number
      let allUsers = await store.query<UserDoc & { id: string }>(COL.users);
      let matchedUser = allUsers.find(
        (u) =>
          u.employeeCode?.toUpperCase() === input.toUpperCase() ||
          u.phoneNumber === input ||
          u.authEmail?.toLowerCase() === input.toLowerCase() ||
          (u.officialEmail && u.officialEmail.toLowerCase() === input.toLowerCase())
      );

      // If user isn't found in memory store yet (e.g. fresh session on desktop or another client), fetch from Firestore
      if (!matchedUser) {
        try {
          const freshUsersSnap = await getDocs(collection(db, 'users'));
          if (!freshUsersSnap.empty) {
            await store.transaction(async (tx) => {
              freshUsersSnap.forEach((d) => {
                const u = d.data() as UserDoc;
                tx.set(COL.users, d.id, u as never);
                if (u.employeeCode) tx.set(COL.uniqueKeys, codeKey(u.employeeCode), { id: codeKey(u.employeeCode), ownerId: d.id, createdAt: '' });
                if (u.phoneNumber) tx.set(COL.uniqueKeys, phoneKey(u.phoneNumber), { id: phoneKey(u.phoneNumber), ownerId: d.id, createdAt: '' });
                if (u.authEmail) tx.set(COL.uniqueKeys, `email_${u.authEmail.toLowerCase()}`, { id: `email_${u.authEmail.toLowerCase()}`, ownerId: d.id, createdAt: '' });
                if (u.officialEmail) tx.set(COL.uniqueKeys, `email_${u.officialEmail.toLowerCase()}`, { id: `email_${u.officialEmail.toLowerCase()}`, ownerId: d.id, createdAt: '' });
              });
            });
            allUsers = await store.query<UserDoc & { id: string }>(COL.users);
            matchedUser = allUsers.find(
              (u) =>
                u.employeeCode?.toUpperCase() === input.toUpperCase() ||
                u.phoneNumber === input ||
                u.authEmail?.toLowerCase() === input.toLowerCase() ||
                (u.officialEmail && u.officialEmail.toLowerCase() === input.toLowerCase())
            );
          }
        } catch {
          // Ignore
        }
      }

      if (matchedUser) {
        targetEmail = matchedUser.authEmail.toLowerCase();
      }

      let r = await auth.verify(targetEmail, password);

      // Not found here: the account may have been created or changed on another device.
      if ('error' in r) {
        try {
          const authSnap = await getDocs(collection(db, 'authUsers'));
          authSnap.forEach((d) => {
            const u = d.data() as {
              uid: string;
              email: string;
              disabled: boolean;
              salt: string | null;
              hash: string | null;
              tokensValidAfter: number;
            };
            if (u.uid) auth.users.set(u.uid, u);
          });
          r = await auth.verify(targetEmail, password);
        } catch {
          // Ignore
        }
      }

      if ('error' in r) {
        throw new AuthFailure(r.error === 'auth/user-disabled' ? 'user-disabled' : 'invalid-credential');
      }
      const sess = JSON.stringify({ uid: r.uid, issuedAt: Date.now() });
      localStorage.setItem(SESSION_KEY, sess);
      sessionStorage.setItem(SESSION_KEY, sess);
      emit();
    },
    async signOut() {
      localStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(SESSION_KEY);
      emit();
    },
    async call(op, payload) {
      const session = readSession();
      const actor = session ? await store.get<UserDoc & { id: string }>(COL.users, session.uid) : null;

      // Ensure fresh dailyReport and routines when loading My Day
      if (actor && (op === 'daily.getForDate' || op === 'routine.get')) {
        const p = payload as { workDate?: string } | undefined;
        const workDate = p?.workDate;
        const targetKey = workDate ? dailyKey(actor.id, workDate) : null;
        const hasKey = targetKey ? await store.get(COL.uniqueKeys, targetKey) : true;
        if (!hasKey) {
          try {
            const freshDaily = await getDocs(collection(db, 'dailyReports'));
            await store.transaction(async (tx) => {
              freshDaily.forEach((d) => {
                const rep = d.data() as { employeeId?: string; workDate?: string; createdAt?: string };
                tx.set(COL.dailyReports, d.id, rep as never);
                if (rep.employeeId && rep.workDate) {
                  const k = dailyKey(rep.employeeId, rep.workDate);
                  tx.set(COL.uniqueKeys, k, { id: k, ownerId: d.id, createdAt: rep.createdAt || '' });
                }
              });
            });
          } catch {
            // Non-fatal
          }
        }
      }
      try {
        const result = await dispatch(
          {
            store,
            auth,
            now: () => new Date(),
            actor,
            correlationId: crypto.randomUUID(),
            appUrl: window.location.origin,
          },
          op,
          payload,
        );
        persist();
        return JSON.parse(JSON.stringify(result ?? null));
      } catch (e) {
        if (e instanceof AppError) throw new ApiError(e.code, e.message, e.details);
        console.error('Operation error:', op, e);
        throw new ApiError('internal', 'Unexpected error executing operation.');
      }
    },
    async sendPasswordReset(_email) {
      // In live standalone, reset is confirmed immediately
    },
    async confirmPasswordReset(_oobCode, newPassword) {
      try {
        const session = readSession();
        if (session) {
          await auth.setPassword(session.uid, newPassword);
          persist();
        }
      } catch (e) {
        throw new ApiError('failed-precondition', 'Could not update password.', e);
      }
    },
    async changePassword(currentPassword, newPassword) {
      const session = readSession();
      if (!session) throw new ApiError('unauthenticated', 'Please sign in again.');
      const user = await store.get<UserDoc & { id: string }>(COL.users, session.uid);
      const r = user ? await auth.verify(user.authEmail, currentPassword) : { error: 'auth/invalid-credential' as const };
      if ('error' in r) throw new ApiError('invalid-credential', 'Your current password is incorrect.');
      await auth.setPassword(session.uid, newPassword);
      const sess = JSON.stringify({ uid: session.uid, issuedAt: Date.now() });
      localStorage.setItem(SESSION_KEY, sess);
      sessionStorage.setItem(SESSION_KEY, sess);
      persist();
    },
  };
}
