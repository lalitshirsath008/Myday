/**
 * Seeds the LOCAL Firebase emulators with clearly-labelled fictional test data.
 * Refuses to run unless both emulator hosts are set, so it can never touch a real project.
 *
 *   firebase emulators:start   (in another terminal)
 *   npm run seed:emulator
 */
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { DEMO_PASSWORD, seedDemoData } from '@rgk/core';
import { FirebaseAuthAdmin } from './adminAuth';
import { FirestoreStore } from './firestoreStore';

async function main() {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
    process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
    console.log(`Using emulators at ${process.env.FIRESTORE_EMULATOR_HOST} and ${process.env.FIREBASE_AUTH_EMULATOR_HOST}`);
  }
  initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? 'demo-rgk-worktrack' });
  const db = getFirestore();
  const existing = await db.collection('users').limit(1).get();
  if (!existing.empty) {
    console.error('The emulator already has users. Restart the emulators (data is not persisted by default) and try again.');
    process.exit(1);
  }
  const result = await seedDemoData(new FirestoreStore(db), new FirebaseAuthAdmin(getAuth()), { appUrl: process.env.APP_URL ?? 'http://localhost:5173' });
  console.log('\nSeeded TEST data. Sign in with any employee code below and password', DEMO_PASSWORD);
  for (const [key, u] of Object.entries(result.users)) console.log(`  ${u.code.padEnd(8)} ${u.role.padEnd(18)} (${key})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
