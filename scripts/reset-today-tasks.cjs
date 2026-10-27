const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, deleteDoc } = require('firebase/firestore');
const fs = require('node:fs');
const path = require('node:path');

const cfg = {
  apiKey: 'AIzaSyA9aMBFpGQpL5rpAunqIWUD7fSjXdu8h8Q',
  authDomain: 'rgk-myday-app.firebaseapp.com',
  projectId: 'rgk-myday-app',
  storageBucket: 'rgk-myday-app.firebasestorage.app',
  messagingSenderId: '387946926063',
  appId: '1:387946926063:web:29df7e60dea199ad84b01a'
};

const app = initializeApp(cfg);
const db = getFirestore(app);

async function cleanFirestore() {
  console.log('--- Cleaning Firestore Today Tasks & Reports ---');
  
  // 1. Tasks
  const tasksSnap = await getDocs(collection(db, 'tasks'));
  console.log(`Found ${tasksSnap.size} tasks in Firestore.`);
  for (const d of tasksSnap.docs) {
    await deleteDoc(doc(db, 'tasks', d.id));
    console.log(`Deleted task: ${d.id}`);
  }

  // 2. Daily reports for today (2026-10-27)
  const dailySnap = await getDocs(collection(db, 'dailyReports'));
  console.log(`Found ${dailySnap.size} daily reports in Firestore.`);
  for (const d of dailySnap.docs) {
    const data = d.data();
    if (data.workDate === '2026-10-27') {
      await deleteDoc(doc(db, 'dailyReports', d.id));
      console.log(`Deleted today's daily report: ${d.id} (${data.employeeId})`);
    }
  }

  // 3. Daily routines for today
  const routineSnap = await getDocs(collection(db, 'dailyRoutines'));
  console.log(`Found ${routineSnap.size} daily routines in Firestore.`);
  for (const d of routineSnap.docs) {
    const data = d.data();
    if (data.date === '2026-10-27') {
      await deleteDoc(doc(db, 'dailyRoutines', d.id));
      console.log(`Deleted today's routine: ${d.id}`);
    }
  }

  // 4. Notifications
  const notifSnap = await getDocs(collection(db, 'notifications'));
  console.log(`Found ${notifSnap.size} notifications in Firestore.`);
  for (const d of notifSnap.docs) {
    await deleteDoc(doc(db, 'notifications', d.id));
    console.log(`Deleted notification: ${d.id}`);
  }

  console.log('--- Cleaning Local /tmp SQL Cache ---');
  try {
    const tmpSql = path.join('/tmp', 'rgk_myday_backup.sql.json');
    if (fs.existsSync(tmpSql)) {
      const data = JSON.parse(fs.readFileSync(tmpSql, 'utf8'));
      data.tables.tasks = {};
      data.tables.dailyReports = {};
      data.tables.dailyRoutines = {};
      data.tables.notifications = {};
      data.firebaseSyncQueue = [];
      fs.writeFileSync(tmpSql, JSON.stringify(data), 'utf8');
      console.log('Reset /tmp SQL cache.');
    }
  } catch (e) {
    console.log('No /tmp file or error:', e.message);
  }

  console.log('--- Cleaning Desktop AppData Storage ---');
  try {
    const appData = process.env.APPDATA;
    if (appData) {
      const desktopDir = path.join(appData, 'rgk-worktrack-desktop');
      const lsDir = path.join(desktopDir, 'Local Storage');
      const idbDir = path.join(desktopDir, 'IndexedDB');
      const ssDir = path.join(desktopDir, 'Session Storage');
      
      if (fs.existsSync(lsDir)) {
        fs.rmSync(lsDir, { recursive: true, force: true });
        console.log('Cleared Desktop Local Storage.');
      }
      if (fs.existsSync(idbDir)) {
        fs.rmSync(idbDir, { recursive: true, force: true });
        console.log('Cleared Desktop IndexedDB.');
      }
      if (fs.existsSync(ssDir)) {
        fs.rmSync(ssDir, { recursive: true, force: true });
        console.log('Cleared Desktop Session Storage.');
      }
    }
  } catch (e) {
    console.warn('Desktop cache clear non-fatal:', e.message);
  }

  console.log('ALL TASKS, REPORTS, AND NOTIFICATIONS RESET TO 0!');
  process.exit(0);
}

cleanFirestore().catch(e => {
  console.error('Clean error:', e);
  process.exit(1);
});
