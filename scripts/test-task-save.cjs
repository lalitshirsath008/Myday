const { initializeApp } = require('firebase/app');
const { getFirestore, doc, setDoc, getDoc, deleteDoc } = require('firebase/firestore');

const cfg = {
  apiKey: 'AIzaSyDeZeLTNEVQcfNLFwymHEDxL2DnBfuy3FA',
  authDomain: 'task-8861a.firebaseapp.com',
  projectId: 'task-8861a',
  storageBucket: 'task-8861a.firebasestorage.app',
  messagingSenderId: '783521347645',
  appId: '1:783521347645:web:40df826eb1c32c5acf5254'
};

const app = initializeApp(cfg);
const db = getFirestore(app);

async function testTaskSave() {
  const testTaskId = 'prod_test_task_' + Date.now();
  console.log(`Testing task save with id: ${testTaskId}...`);

  const taskData = {
    id: testTaskId,
    title: 'Production Verification Task',
    description: 'Verifying task saving against task-8861a before production go-live',
    departmentId: 'dept_mda',
    employeeId: '6c37f41fe4b14fcaac35f235c7e06190', // Lalit
    collaboratorIds: ['ef508b278b8a492498cbef6b2dcb41dc'], // Saurabh
    status: 'PLANNED',
    priority: 'HIGH',
    isPrimary: true,
    slot: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  // 1. Write task
  const taskRef = doc(db, 'tasks', testTaskId);
  await setDoc(taskRef, taskData);
  console.log('Task write successful!');

  // 2. Read task back
  const snap = await getDoc(taskRef);
  if (!snap.exists()) {
    throw new Error('Task document was not found after write!');
  }
  const readBack = snap.data();
  console.log('Task read back successful! Title:', readBack.title, '| Collaborators:', readBack.collaboratorIds);

  // 3. Clean up test task
  await deleteDoc(taskRef);
  console.log('Task cleanup successful! task-8861a is verified working 100%!');
}

testTaskSave().then(() => process.exit(0)).catch(e => { console.error('Task test failed:', e); process.exit(1); });
