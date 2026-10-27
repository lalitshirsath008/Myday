const { initializeApp } = require('firebase/app');
const { getFirestore, doc, setDoc } = require('firebase/firestore');

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

const SEED_USERS = {
  "seed_admin01": {
    "id": "seed_admin01",
    "employeeCode": "ADMIN01",
    "fullName": "RGK Admin",
    "normalizedName": "rgk admin",
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
    "createdAt": "2026-10-26T12:58:21.412Z",
    "updatedAt": new Date().toISOString()
  },
  "ef508b278b8a492498cbef6b2dcb41dc": {
    "id": "ef508b278b8a492498cbef6b2dcb41dc",
    "employeeCode": "RGK376",
    "fullName": "Saurabh Arun Patil",
    "normalizedName": "saurabh arun patil",
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
    "createdAt": "2026-10-26T12:29:37.683Z",
    "updatedAt": new Date().toISOString()
  },
  "6c37f41fe4b14fcaac35f235c7e06190": {
    "id": "6c37f41fe4b14fcaac35f235c7e06190",
    "employeeCode": "RGK428",
    "fullName": "Lalit Sanjay Shirsath",
    "normalizedName": "lalit sanjay shirsath",
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
    "createdAt": "2026-10-27T04:37:46.047Z",
    "updatedAt": new Date().toISOString()
  },
  "e1c8ea3e545e44a0850ba0e7c5b023ab": {
    "id": "e1c8ea3e545e44a0850ba0e7c5b023ab",
    "employeeCode": "RGK123",
    "fullName": "Devendra Devidas Gangurde",
    "normalizedName": "devendra devidas gangurde",
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
    "createdAt": "2026-10-27T07:43:25.325Z",
    "updatedAt": new Date().toISOString()
  }
};

const DEPARTMENTS = [
  { id: 'dept_mgmt', name: 'Management', code: 'MGMT' },
  { id: 'dept_mda', name: 'Marketing & Data Analytics', code: 'MDA' },
  { id: 'dept_prod', name: 'Production', code: 'PROD' },
  { id: 'dept_qa', name: 'Quality Assurance', code: 'QA' },
  { id: 'dept_maint', name: 'Maintenance', code: 'MAINT' },
  { id: 'dept_store', name: 'Store & Warehouse', code: 'STORE' },
  { id: 'dept_dispatch', name: 'Dispatch', code: 'DISP' },
  { id: 'dept_purchase', name: 'Purchase', code: 'PURCH' },
  { id: 'dept_acc', name: 'Accounts & Finance', code: 'ACC' },
  { id: 'dept_hr', name: 'Human Resources', code: 'HR' },
  { id: 'dept_admin', name: 'Administration', code: 'ADMIN' },
  { id: 'dept_sales', name: 'Sales & Marketing', code: 'SALES' },
  { id: 'dept_design', name: 'Design & Development', code: 'DESIGN' },
  { id: 'dept_it', name: 'Information Technology', code: 'IT' },
  { id: 'dept_sec', name: 'Security', code: 'SEC' },
  { id: 'dept_safety', name: 'EHS & Safety', code: 'EHS' },
  { id: 'dept_legal', name: 'Legal & Compliance', code: 'LEGAL' },
  { id: 'dept_audit', name: 'Internal Audit', code: 'AUDIT' },
  { id: 'dept_cs', name: 'Customer Support', code: 'CS' },
  { id: 'dept_rnd', name: 'Research & Development', code: 'RND' },
  { id: 'dept_planning', name: 'Production Planning', code: 'PPC' },
  { id: 'dept_logistics', name: 'Logistics', code: 'LOG' },
  { id: 'dept_tool', name: 'Tool Room', code: 'TOOL' }
];

async function seed() {
  console.log('Seeding rgk-myday-app Firestore...');

  // 1. Auth Users
  for (const [uid, authData] of Object.entries(SEED_AUTH)) {
    await setDoc(doc(db, 'authUsers', uid), authData);
    console.log(`Seeded authUser: ${authData.email} (${uid})`);
  }

  // 2. Users
  for (const [uid, userData] of Object.entries(SEED_USERS)) {
    await setDoc(doc(db, 'users', uid), userData);
    console.log(`Seeded user: ${userData.fullName} (${userData.employeeCode})`);
  }

  // 3. Departments
  for (const dept of DEPARTMENTS) {
    await setDoc(doc(db, 'departments', dept.id), {
      ...dept,
      description: `${dept.name} Department`,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
  console.log(`Seeded ${DEPARTMENTS.length} departments.`);

  console.log('SUCCESSFULLY SEEDED NEW FIRESTORE DATABASE!');
}

seed().then(() => process.exit(0)).catch(e => { console.error('Seed error:', e); process.exit(1); });
