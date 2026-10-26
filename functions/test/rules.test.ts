/**
 * Firestore Security Rules tests. Requires the Firestore emulator (Java 21+):
 *   firebase emulators:exec --only firestore "npm run test:rules"
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, collection, getDocs, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, describe, it } from 'vitest';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-rgk-worktrack-rules',
    firestore: { rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8') },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users/u1'), { id: 'u1', role: 'EMPLOYEE' });
    await setDoc(doc(ctx.firestore(), 'dailyReports/r1'), { id: 'r1', employeeId: 'u1' });
    await setDoc(doc(ctx.firestore(), 'auditLogs/a1'), { id: 'a1' });
  });
});

afterAll(async () => env?.cleanup());

describe('direct client access is denied', () => {
  it('denies unauthenticated reads', async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'users/u1')));
  });
  it('denies an employee reading even their own report directly', async () => {
    await assertFails(getDoc(doc(env.authenticatedContext('u1').firestore(), 'dailyReports/r1')));
  });
  it('denies role escalation by writing the user profile', async () => {
    await assertFails(updateDoc(doc(env.authenticatedContext('u1').firestore(), 'users/u1'), { role: 'SUPER_ADMIN' }));
  });
  it('denies listing or editing audit logs', async () => {
    const db = env.authenticatedContext('u1', { role: 'SUPER_ADMIN' }).firestore();
    await assertFails(getDocs(collection(db, 'auditLogs')));
    await assertFails(setDoc(doc(db, 'auditLogs/a1'), { tampered: true }));
  });
});
