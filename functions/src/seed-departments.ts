import { existsSync, readFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { COL, RGK_DEPARTMENTS } from '@rgk/core';

async function main() {
  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS || (existsSync('serviceAccountKey.json') ? 'serviceAccountKey.json' : existsSync('../serviceAccountKey.json') ? '../serviceAccountKey.json' : null);
  if (keyFile) {
    const serviceAccount = JSON.parse(readFileSync(keyFile, 'utf8'));
    initializeApp({ credential: cert(serviceAccount) });
  } else {
    initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'task-8861a' });
  }

  const db = getFirestore();
  const now = new Date().toISOString();
  const batch = db.batch();

  console.log(`Syncing ${RGK_DEPARTMENTS.length} RGK departments into Firestore...`);
  for (const d of RGK_DEPARTMENTS) {
    const ref = db.collection(COL.departments).doc(d.id);
    batch.set(ref, {
      id: d.id,
      name: d.name,
      code: d.code,
      description: '',
      active: true,
      createdAt: now,
      updatedAt: now,
    }, { merge: true });
    console.log(` - [${d.code}] ${d.name}`);
  }

  await batch.commit();
  console.log(`\nSuccessfully saved all ${RGK_DEPARTMENTS.length} departments to Firestore!`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
