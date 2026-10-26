import { randomUUID } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { defineBoolean, defineString } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { AppError, COL, dispatch, runReminders, type Ctx, type UserDoc } from '@rgk/core';
import { FirebaseAuthAdmin } from './adminAuth';
import { FirestoreStore } from './firestoreStore';

initializeApp();
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });
const store = new FirestoreStore(db);
const authAdmin = new FirebaseAuthAdmin(getAuth());

const REGION = 'asia-south1';
const APP_URL = defineString('APP_URL', { description: 'Public URL of the web app, used in activation links', default: 'http://localhost:5173' });
const ENFORCE_APP_CHECK = defineBoolean('ENFORCE_APP_CHECK', { description: 'Require Firebase App Check tokens on API calls', default: false });

function ctxFor(actor: UserDoc | null, correlationId: string): Ctx {
  return { store, auth: authAdmin, now: () => new Date(), actor, correlationId, appUrl: APP_URL.value() };
}

/**
 * The single API endpoint. Every read and write in the app goes through here so authorization is
 * enforced server-side: the caller's identity comes from the verified Firebase ID token, and their
 * role/status from their Firestore profile — never from the request body.
 */
export const api = onCall({ region: REGION, memory: '512MiB', timeoutSeconds: 120, enforceAppCheck: ENFORCE_APP_CHECK.value() }, async (req) => {
  const data = (req.data ?? {}) as { op?: unknown; payload?: unknown };
  if (typeof data.op !== 'string' || data.op.length > 80) throw new HttpsError('invalid-argument', 'Missing operation.');
  const correlationId = randomUUID();
  const actor = req.auth?.uid ? await store.get<UserDoc & { id: string }>(COL.users, req.auth.uid) : null;
  try {
    return await dispatch(ctxFor(actor, correlationId), data.op, data.payload);
  } catch (e) {
    if (e instanceof AppError) {
      if (e.code === 'internal') logger.error('api internal error', { op: data.op, uid: req.auth?.uid ?? null, correlationId, message: e.message });
      throw new HttpsError(e.code, e.message, e.details);
    }
    // Never echo unexpected error details (or request payloads, which may hold passwords) to the client or logs.
    logger.error('api unexpected error', { op: data.op, uid: req.auth?.uid ?? null, correlationId, error: (e as Error)?.message });
    throw new HttpsError('internal', `Something went wrong. Reference: ${correlationId}`);
  }
});

/** Hourly; the job itself only sends at the configured reminder time, and de-duplicates. */
export const reminders = onSchedule({ region: REGION, schedule: '5 * * * *', timeZone: 'Asia/Kolkata' }, async () => {
  const result = await runReminders(ctxFor(null, randomUUID()), { force: false });
  logger.info('reminders', result);
});
