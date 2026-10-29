const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, setDoc } = require('firebase/firestore');

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

async function inspect() {
  console.log('--- Inspecting task-8861a Firestore ---');
  const cols = ['users', 'authUsers', 'departments', 'tasks', 'dailyReports', 'dailyRoutines', 'notifications'];
  for (const c of cols) {
    try {
      const snap = await getDocs(collection(db, c));
      console.log(`Collection [${c}]: ${snap.size} documents`);
      if (c === 'users') {
        snap.forEach(d => {
          const u = d.data();
          console.log(`  User ${d.id}: ${u.fullName} (${u.authEmail}, ${u.role}) - tokens: ${Array.isArray(u.searchTokens) ? u.searchTokens.length : 'MISSING'}`);
        });
      }
      if (c === 'authUsers') {
        snap.forEach(d => {
          const a = d.data();
          console.log(`  AuthUser ${d.id}: ${a.email} (disabled: ${a.disabled})`);
        });
      }
    } catch (e) {
      console.error(`Error querying [${c}]:`, e.message);
    }
  }
}

inspect().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
