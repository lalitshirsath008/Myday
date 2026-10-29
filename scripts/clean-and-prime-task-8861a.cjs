const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, setDoc, deleteDoc } = require('firebase/firestore');

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

function normalizeName(name) {
  return (name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function searchTokens(u) {
  const tokens = new Set();
  const add = (word) => {
    if (!word) return;
    for (let i = 1; i <= Math.min(word.length, 15); i++) tokens.add(word.slice(0, i));
  };
  for (const w of normalizeName(u.fullName || '').split(' ')) if (w) add(w);
  if (u.employeeCode) add(u.employeeCode.toLowerCase());
  if (u.authEmail) {
    const emailPrefix = u.authEmail.split('@')[0];
    add(emailPrefix.toLowerCase());
  }
  for (const w of normalizeName(u.designation || '').split(' ')) if (w) add(w);
  return [...tokens].slice(0, 200);
}

const SEED_USERS = {
  "seed_admin01": {
    "id": "seed_admin01",
    "employeeCode": "ADMIN01",
    "fullName": "RGK Admin",
    "designation": "Super Administrator",
    "role": "SUPER_ADMIN",
    "departmentId": "dept_mgmt",
    "authEmail": "admin@rgk.com",
    "officialEmail": "admin@rgk.com",
    "phoneNumber": "9000000000",
    "alternatePhone": "",
    "accountStatus": "ACTIVE",
    "primaryReportingManagerId": null,
    "secondaryReviewerId": null,
    "location": "Head Office",
    "mustChangePassword": false,
    "joinedAt": "2026-01-01",
    "activatedAt": "2026-10-26T12:58:21.412Z",
    "createdAt": "2026-10-26T12:58:21.412Z"
  },
  "ef508b278b8a492498cbef6b2dcb41dc": {
    "id": "ef508b278b8a492498cbef6b2dcb41dc",
    "employeeCode": "RGK376",
    "fullName": "Saurabh Arun Patil",
    "designation": "Business Analyst",
    "role": "REPORTING_MANAGER",
    "departmentId": "dept_mda",
    "authEmail": "mktg@rgkgroup.net",
    "officialEmail": "mktg@rgkgroup.net",
    "phoneNumber": "9405530185",
    "alternatePhone": "",
    "accountStatus": "ACTIVE",
    "primaryReportingManagerId": null,
    "secondaryReviewerId": null,
    "location": "",
    "mustChangePassword": false,
    "joinedAt": "2022-12-26",
    "activatedAt": "2026-10-26T12:29:37.683Z",
    "createdAt": "2026-10-26T12:29:37.683Z"
  },
  "6c37f41fe4b14fcaac35f235c7e06190": {
    "id": "6c37f41fe4b14fcaac35f235c7e06190",
    "employeeCode": "RGK428",
    "fullName": "Lalit Sanjay Shirsath",
    "designation": "Data Analyst",
    "role": "REPORTING_MANAGER",
    "departmentId": "dept_mda",
    "authEmail": "dataanalyst1@rgkgroup.net",
    "officialEmail": "dataanalyst1@rgkgroup.net",
    "phoneNumber": "9325109257",
    "alternatePhone": "",
    "accountStatus": "ACTIVE",
    "primaryReportingManagerId": "ef508b278b8a492498cbef6b2dcb41dc",
    "secondaryReviewerId": null,
    "location": "",
    "mustChangePassword": false,
    "joinedAt": "2026-02-23",
    "activatedAt": "2026-10-27T04:37:46.047Z",
    "createdAt": "2026-10-27T04:37:46.047Z"
  },
  "e1c8ea3e545e44a0850ba0e7c5b023ab": {
    "id": "e1c8ea3e545e44a0850ba0e7c5b023ab",
    "employeeCode": "RGK123",
    "fullName": "Devendra Devidas Gangurde",
    "designation": "Data Analyst",
    "role": "EMPLOYEE",
    "departmentId": "dept_mda",
    "authEmail": "mktgsupport@rgkgroup.net",
    "officialEmail": "mktgsupport@rgkgroup.net",
    "phoneNumber": "9988776655",
    "alternatePhone": "",
    "accountStatus": "ACTIVE",
    "primaryReportingManagerId": "6c37f41fe4b14fcaac35f235c7e06190",
    "secondaryReviewerId": null,
    "location": "",
    "mustChangePassword": false,
    "joinedAt": "2026-07-23",
    "activatedAt": "2026-10-27T07:43:25.325Z",
    "createdAt": "2026-10-27T07:43:25.325Z"
  }
};

const SEED_AUTH = {
  "seed_admin01": {
    "uid": "seed_admin01",
    "email": "admin@rgk.com",
    "disabled": false,
    "hash": "9844fa0b2e98b6272f9dbdb7d94d1facdf2151738899fcb5d4cb548c70a211d1",
    "salt": "48224f34cf84c2baa85f91ce9963404a",
    "tokensValidAfter": Date.now()
  },
  "ef508b278b8a492498cbef6b2dcb41dc": {
    "uid": "ef508b278b8a492498cbef6b2dcb41dc",
    "email": "mktg@rgkgroup.net",
    "disabled": false,
    "hash": "81ec1fc35be721217c91cf20cdf0849785a1dc2edde870674d94042eb7019de0",
    "salt": "1971f9435f98fe17a86ebcaec4f1598b",
    "tokensValidAfter": Date.now()
  },
  "6c37f41fe4b14fcaac35f235c7e06190": {
    "uid": "6c37f41fe4b14fcaac35f235c7e06190",
    "email": "dataanalyst1@rgkgroup.net",
    "disabled": false,
    "hash": "01823c1224114a241fcc302e510de61fbeb9b6a1b472ee04cc8c6ead87987b17",
    "salt": "89e5a833ec0bd01be2155ecba9cc0480",
    "tokensValidAfter": Date.now()
  },
  "e1c8ea3e545e44a0850ba0e7c5b023ab": {
    "uid": "e1c8ea3e545e44a0850ba0e7c5b023ab",
    "email": "mktgsupport@rgkgroup.net",
    "disabled": false,
    "hash": "33826748781e7116acbabcc8d4eadbb302ac94f7641ff85807c732e544e8f2bd",
    "salt": "e7a8960a55d7a02786f002c15e59a2c9",
    "tokensValidAfter": Date.now()
  }
};

async function syncAndClean() {
  console.log('--- Cleaning old test data in task-8861a ---');
  // Clean dailyReports
  const drSnap = await getDocs(collection(db, 'dailyReports'));
  for (const d of drSnap.docs) {
    await deleteDoc(doc(db, 'dailyReports', d.id));
    console.log(`Deleted dailyReport: ${d.id}`);
  }

  // Clean dailyRoutines
  const rtSnap = await getDocs(collection(db, 'dailyRoutines'));
  for (const d of rtSnap.docs) {
    await deleteDoc(doc(db, 'dailyRoutines', d.id));
    console.log(`Deleted dailyRoutine: ${d.id}`);
  }

  // Clean user_saurabh dummy doc if present
  try {
    await deleteDoc(doc(db, 'users', 'user_saurabh'));
    await deleteDoc(doc(db, 'authUsers', 'user_saurabh'));
    console.log('Cleaned dummy user_saurabh');
  } catch (e) {
    // non-fatal
  }

  console.log('--- Ensuring users and searchTokens in task-8861a ---');
  for (const [uid, uData] of Object.entries(SEED_USERS)) {
    const tokens = searchTokens(uData);
    const norm = normalizeName(uData.fullName);
    await setDoc(doc(db, 'users', uid), {
      ...uData,
      searchTokens: tokens,
      normalizedName: norm,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    console.log(`Updated user ${uData.fullName} with ${tokens.length} search tokens.`);
  }

  for (const [uid, aData] of Object.entries(SEED_AUTH)) {
    await setDoc(doc(db, 'authUsers', uid), aData, { merge: true });
    console.log(`Updated authUser ${aData.email}`);
  }

  console.log('task-8861a is primed and clean for production!');
}

syncAndClean().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
