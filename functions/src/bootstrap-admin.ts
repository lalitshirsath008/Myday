/**
 * Creates the FIRST Super Admin in a real project and prints a one-time activation link.
 * Runs with your own Google credentials (Application Default Credentials):
 *
 *   gcloud auth application-default login
 *   GCLOUD_PROJECT=<project-id> APP_URL=https://<your-host> npm run bootstrap-admin -w functions -- \
 *     --code SA001 --name "Full Name" --phone 98XXXXXXXX [--email you@rgkgroup.net] [--department IT]
 *
 * Refuses to run if a Super Admin already exists. Everything after that is done in the app.
 */
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { COL, defaultSettings, employeeCode, phoneNumber, randomToken, RGK_DEPARTMENTS, sha256Hex, syntheticEmail } from '@rgk/core';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const code = employeeCode.parse(arg('code'));
  const name = arg('name');
  const phone = phoneNumber.parse(arg('phone'));
  const email = arg('email')?.toLowerCase() ?? null;
  const password = arg('password');
  const deptName = arg('department') ?? 'IT';
  const appUrl = process.env.APP_URL || arg('app-url') || 'http://localhost:5173';
  if (!name) throw new Error('--name is required');

  const keyFile = arg('key') || process.env.GOOGLE_APPLICATION_CREDENTIALS || (existsSync('serviceAccountKey.json') ? 'serviceAccountKey.json' : existsSync('../serviceAccountKey.json') ? '../serviceAccountKey.json' : null);
  if (keyFile) {
    const serviceAccount = JSON.parse(readFileSync(keyFile, 'utf8'));
    initializeApp({ credential: cert(serviceAccount) });
  } else {
    initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'task-8861a' });
  }

  const db = getFirestore();
  const admins = await db.collection(COL.users).where('role', '==', 'SUPER_ADMIN').limit(1).get();
  if (!admins.empty) throw new Error('A Super Admin already exists. Use the app to add more administrators.');

  const now = new Date().toISOString();

  // A brand-new database gets the standard RGK department list.
  const anyDept = await db.collection(COL.departments).limit(1).get();
  if (anyDept.empty) {
    const batch = db.batch();
    for (const d of RGK_DEPARTMENTS) batch.set(db.collection(COL.departments).doc(d.id), { id: d.id, name: d.name, code: d.code, description: '', active: true, createdAt: now, updatedAt: now });
    await batch.commit();
    console.log(`Created ${RGK_DEPARTMENTS.length} departments.`);
  }

  const uid = randomUUID().replace(/-/g, '');
  const known = RGK_DEPARTMENTS.find((d) => d.name.toLowerCase() === deptName.toLowerCase() || d.code.toLowerCase() === deptName.toLowerCase());
  const deptId = known?.id ?? `dept_${deptName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  const authEmail = email ?? syntheticEmail(code);
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const normalized = name.toLowerCase().replace(/\s+/g, ' ').trim();
  const status = password ? 'ACTIVE' : 'PENDING_ACTIVATION';
  const activatedAt = password ? now : null;

  await db.runTransaction(async (tx) => {
    const settingsRef = db.collection(COL.systemSettings).doc('general');
    const deptRef = db.collection(COL.departments).doc(deptId);
    const [settingsSnap, deptSnap] = await Promise.all([tx.get(settingsRef), tx.get(deptRef)]);
    if (!settingsSnap.exists) tx.set(settingsRef, { ...defaultSettings(now), id: 'general' });
    if (!deptSnap.exists) tx.set(deptRef, { id: deptId, name: deptName, code: deptName.toUpperCase().slice(0, 12), description: '', active: true, createdAt: now, updatedAt: now });
    for (const k of [`code_${code}`, `phone_${phone}`, `email_${authEmail}`]) tx.create(db.collection(COL.uniqueKeys).doc(k), { id: k, ownerId: uid, createdAt: now });
    tx.create(db.collection(COL.users).doc(uid), {
      id: uid, employeeCode: code, fullName: name, normalizedName: normalized, searchTokens: [...new Set(normalized.split(' ').flatMap((w) => [...w].map((_, i) => w.slice(0, i + 1))).concat(code.toLowerCase()))].slice(0, 200),
      phoneNumber: phone, officialEmail: email, authEmail, departmentId: deptId, designation: 'Administrator', role: 'SUPER_ADMIN',
      primaryReportingManagerId: null, secondaryReviewerId: null, accountStatus: status, joinedAt: password ? now.slice(0, 10) : null,
      activatedAt, deactivatedAt: null, alternatePhone: '', location: '', createdAt: now, updatedAt: now, createdBy: null,
    });
    if (!password) {
      tx.create(db.collection(COL.activationTokens).doc(tokenHash), { id: tokenHash, userId: uid, purpose: 'ACTIVATION', expiresAt: new Date(Date.now() + 72 * 3600_000).toISOString(), usedAt: null, createdAt: now, createdBy: 'BOOTSTRAP' });
    }
    const auditId = randomUUID();
    tx.create(db.collection(COL.auditLogs).doc(auditId), { id: auditId, actorId: null, actorName: 'Bootstrap script', actorRole: 'SYSTEM', action: 'SUPER_ADMIN_BOOTSTRAPPED', entityType: 'user', entityId: uid, timestamp: now, reason: '', beforeSnapshot: null, afterSnapshot: { employeeCode: code }, requestCorrelationId: auditId });
  });

  if (password) {
    await getAuth().createUser({ uid, email: authEmail, password, disabled: false });
    console.log(`\n🎉 Super Admin ${code} created successfully!`);
    console.log(`- Employee Code / Username: ${code}`);
    console.log(`- Mobile Number:           ${phone}`);
    console.log(`- Sign-in Email:           ${authEmail}`);
    console.log(`- Status:                  ACTIVE`);
    console.log(`\nYou can now log in immediately with code "${code}" (or phone "${phone}") and your password!\n`);
  } else {
    await getAuth().createUser({ uid, email: authEmail, disabled: true });
    console.log(`\nSuper Admin ${code} created. Open this one-time link within 72 hours to set the password:\n\n  ${appUrl.replace(/\/$/, '')}/activate?token=${token}\n`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
