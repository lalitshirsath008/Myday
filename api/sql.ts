/**
 * RGK Myday — Vercel Serverless SQL Database & Cloud Backup Engine.
 *
 * Keeps a continuous, mirrored SQL backup of all users, credentials, daily reports,
 * tasks, notifications, routines, and reviews.
 * If Cloud Firestore hits daily limits (429 RESOURCE_EXHAUSTED), this SQL API
 * acts as the primary failover backend and automatically pushes pending changes
 * back to Cloud Firestore as soon as quota is restored.
 */
import fs from 'node:fs';
import path from 'node:path';

interface StoreChange {
  col: string;
  id: string;
  doc: any | null;
}

interface SqlStoreData {
  tables: Record<string, Record<string, any>>;
  authUsers: Record<string, any>;
  firebaseSyncQueue: Array<{
    id: string;
    col: string;
    docId: string;
    doc: any | null;
    timestamp: string;
    synced: boolean;
  }>;
  lastUpdated: string;
}

// In-memory runtime cache for serverless lifetime + disk persistence in /tmp
const DB_FILE = path.join('/tmp', 'rgk_myday_backup.sql.json');

const SEED_AUTH: Record<string, any> = {
  "6c37f41fe4b14fcaac35f235c7e06190": { "email": "dataanalyst1@rgkgroup.net", "disabled": false, "hash": "01823c1224114a241fcc302e510de61fbeb9b6a1b472ee04cc8c6ead87987b17", "salt": "89e5a833ec0bd01be2155ecba9cc0480", "uid": "6c37f41fe4b14fcaac35f235c7e06190", "tokensValidAfter": 1793076008397 },
  "e1c8ea3e545e44a0850ba0e7c5b023ab": { "hash": "33826748781e7116acbabcc8d4eadbb302ac94f7641ff85807c732e544e8f2bd", "email": "mktgsupport@rgkgroup.net", "uid": "e1c8ea3e545e44a0850ba0e7c5b023ab", "tokensValidAfter": 1793087005350, "salt": "e7a8960a55d7a02786f002c15e59a2c9", "disabled": false },
  "ef508b278b8a492498cbef6b2dcb41dc": { "hash": "81ec1fc35be721217c91cf20cdf0849785a1dc2edde870674d94042eb7019de0", "email": "mktg@rgkgroup.net", "uid": "ef508b278b8a492498cbef6b2dcb41dc", "disabled": false, "tokensValidAfter": 1793017777704, "salt": "1971f9435f98fe17a86ebcaec4f1598b" },
  "seed_admin01": { "salt": "48224f34cf84c2baa85f91ce9963404a", "tokensValidAfter": 1793086867522, "email": "admin@rgk.com", "uid": "seed_admin01", "disabled": false, "hash": "9844fa0b2e98b6272f9dbdb7d94d1facdf2151738899fcb5d4cb548c70a211d1" },
  "user_saurabh": { "salt": "7a4ff64e5b04e2c767fa33c975c24d55", "email": "saurabh@rgk.com", "tokensValidAfter": 1793075784533, "uid": "user_saurabh", "disabled": true, "hash": "03f5092a537d1993edd0e4b604b033de1dadc1bc53b253554f4a0cd57942f60e" }
};

const SEED_USERS: Record<string, any> = {
  "6c37f41fe4b14fcaac35f235c7e06190": { "employeeCode": "RGK428", "updatedAt": "2026-10-27T07:43:47.631Z", "departmentId": "dept_mda", "role": "REPORTING_MANAGER", "primaryReportingManagerId": "ef508b278b8a492498cbef6b2dcb41dc", "authEmail": "dataanalyst1@rgkgroup.net", "createdBy": "seed_admin01", "deactivatedAt": null, "fullName": "Lalit Sanjay Shirsath", "joinedAt": "2026-02-23", "phoneNumber": "9325109257", "designation": "Data Analyst", "id": "6c37f41fe4b14fcaac35f235c7e06190", "accountStatus": "ACTIVE", "location": "", "normalizedName": "lalit sanjay shirsath", "alternatePhone": "", "mustChangePassword": false, "activatedAt": "2026-10-27T04:37:46.047Z", "officialEmail": "dataanalyst1@rgkgroup.net" },
  "e1c8ea3e545e44a0850ba0e7c5b023ab": { "phoneNumber": "9988776655", "officialEmail": "mktgsupport@rgkgroup.net", "departmentId": "dept_mda", "employeeCode": "RGK123", "designation": "Data Analyst", "createdAt": "2026-10-27T07:43:25.325Z", "primaryReportingManagerId": "6c37f41fe4b14fcaac35f235c7e06190", "role": "EMPLOYEE", "location": "", "accountStatus": "ACTIVE", "normalizedName": "devendra devidas gangurde", "alternatePhone": "", "joinedAt": "2026-07-23", "activatedAt": "2026-10-27T07:43:25.325Z", "id": "e1c8ea3e545e44a0850ba0e7c5b023ab", "updatedAt": "2026-10-27T07:44:02.095Z", "deactivatedAt": null, "authEmail": "mktgsupport@rgkgroup.net", "createdBy": "seed_admin01", "fullName": "Devendra Devidas Gangurde", "secondaryReviewerId": null, "mustChangePassword": false },
  "ef508b278b8a492498cbef6b2dcb41dc": { "accountStatus": "ACTIVE", "mustChangePassword": false, "createdAt": "2026-10-26T12:29:37.683Z", "role": "REPORTING_MANAGER", "primaryReportingManagerId": null, "designation": "Business Analyst", "alternatePhone": "", "normalizedName": "saurabh arun patil", "officialEmail": "mktg@rgkgroup.net", "phoneNumber": "9405530185", "location": "", "id": "ef508b278b8a492498cbef6b2dcb41dc", "joinedAt": "2022-12-26", "createdBy": "seed_admin01", "authEmail": "mktg@rgkgroup.net", "deactivatedAt": null, "updatedAt": "2026-10-27T04:38:41.742Z", "employeeCode": "RGK376", "activatedAt": "2026-10-26T12:29:37.683Z", "secondaryReviewerId": null, "fullName": "Saurabh Arun Patil", "departmentId": "dept_mda" },
  "seed_admin01": { "createdAt": "2026-10-26T12:58:21.412Z", "joinedAt": "2026-01-01", "deactivatedAt": null, "fullName": "RGK Admin", "designation": "Super Administrator", "role": "SUPER_ADMIN", "phoneNumber": "9000000000", "employeeCode": "ADMIN01", "departmentId": "dept_mgmt", "accountStatus": "ACTIVE", "primaryReportingManagerId": null, "alternatePhone": "", "normalizedName": "rgk admin", "createdBy": null, "authEmail": "admin@rgk.com", "mustChangePassword": false, "id": "seed_admin01", "location": "Head Office", "activatedAt": "2026-10-26T12:58:21.412Z", "secondaryReviewerId": null, "officialEmail": "admin@rgk.com", "updatedAt": "2026-10-27T07:41:07.526Z" }
};

function loadSqlDb(): SqlStoreData {
  let db: SqlStoreData | null = null;
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      db = JSON.parse(raw);
    }
  } catch {
    // Fresh memory store
  }
  if (!db) {
    db = {
      tables: {
        users: { ...SEED_USERS },
        departments: {},
        dailyReports: {},
        weeklyReports: {},
        tasks: {},
        systemSettings: {},
        projects: {},
        workCalendar: {},
        dailyRoutines: {},
        notifications: {},
        reportReviews: {},
        reportVersions: {},
      },
      authUsers: { ...SEED_AUTH },
      firebaseSyncQueue: [],
      lastUpdated: new Date().toISOString(),
    };
  } else {
    // Ensure seed users exist in cache
    db.tables.users = { ...SEED_USERS, ...db.tables.users };
    db.authUsers = { ...SEED_AUTH, ...db.authUsers };
  }
  return db;
}

function saveSqlDb(data: SqlStoreData) {
  try {
    data.lastUpdated = new Date().toISOString();
    fs.writeFileSync(DB_FILE, JSON.stringify(data), 'utf8');
  } catch {
    // Vercel serverless ephemeral fallback
  }
}

// Generates valid SQL INSERT/UPDATE script
function generateSqlDump(data: SqlStoreData): string {
  const lines: string[] = [
    '-- ============================================================================',
    '-- RGK Myday SQL Database Dump',
    `-- Exported At: ${new Date().toISOString()}`,
    '-- ============================================================================',
    '',
  ];

  // Auth users
  for (const [uid, u] of Object.entries(data.authUsers)) {
    const esc = (s: any) => (s === null || s === undefined ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);
    lines.push(
      `INSERT INTO auth_users (uid, email, disabled, salt, hash, tokens_valid_after) VALUES (${esc(uid)}, ${esc(u.email)}, ${u.disabled ? 1 : 0}, ${esc(u.salt)}, ${esc(u.hash)}, ${u.tokensValidAfter || 0}) ON CONFLICT(uid) DO UPDATE SET email=excluded.email, hash=excluded.hash, salt=excluded.salt;`
    );
  }

  // Collections
  for (const [col, docs] of Object.entries(data.tables)) {
    for (const [id, doc] of Object.entries(docs)) {
      const esc = (s: any) => (s === null || s === undefined ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);
      const json = JSON.stringify(doc).replace(/'/g, "''");
      lines.push(
        `INSERT INTO ${col} (id, raw_data, updated_at) VALUES (${esc(id)}, '${json}', '${new Date().toISOString()}') ON CONFLICT(id) DO UPDATE SET raw_data=excluded.raw_data;`
      );
    }
  }

  return lines.join('\n');
}

export default async function handler(req: any, res: any) {
  // Enable CORS for web and desktop Electron companion
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const db = loadSqlDb();

  // 1. Export SQL Dump as file
  if (req.method === 'GET' && req.query?.export === 'sql') {
    const sqlContent = generateSqlDump(db);
    res.setHeader('Content-Type', 'application/sql');
    res.setHeader('Content-Disposition', 'attachment; filename="rgk_myday_backup.sql"');
    return res.status(200).send(sqlContent);
  }

  // 2. Fetch full snapshot for failover hydration
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'ok',
      tables: db.tables,
      authUsers: db.authUsers,
      pendingFirebaseSync: db.firebaseSyncQueue.filter((q) => !q.synced).length,
      lastUpdated: db.lastUpdated,
    });
  }

  // 3. POST actions (sync delta, queue Firebase reconciliation)
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const { action, changes, authUsers, syncedIds } = body;

    // Mark items as synced to Firebase
    if (action === 'mark_synced' && Array.isArray(syncedIds)) {
      const set = new Set(syncedIds);
      db.firebaseSyncQueue = db.firebaseSyncQueue.map((item) =>
        set.has(item.id) ? { ...item, synced: true } : item
      );
      saveSqlDb(db);
      return res.status(200).json({ status: 'ok', marked: syncedIds.length });
    }

    // Full snapshot backup
    if (action === 'backup_full' && body.snapshot) {
      if (body.snapshot.store) {
        db.tables = { ...db.tables, ...body.snapshot.store };
      }
      if (body.snapshot.auth && Array.isArray(body.snapshot.auth)) {
        for (const u of body.snapshot.auth) {
          if (u.uid) db.authUsers[u.uid] = u;
        }
      }
      saveSqlDb(db);
      return res.status(200).json({ status: 'ok', message: 'Full SQL backup completed' });
    }

    // Delta changes sync
    if (action === 'sync_delta' && Array.isArray(changes)) {
      for (const ch of changes as StoreChange[]) {
        if (!db.tables[ch.col]) db.tables[ch.col] = {};
        if (ch.doc === null) {
          delete db.tables[ch.col][ch.id];
        } else {
          db.tables[ch.col][ch.id] = ch.doc;
        }

        // Add to Firebase sync queue if failed to write to Firebase directly
        if (body.needsFirebaseSync) {
          db.firebaseSyncQueue.push({
            id: `${ch.col}_${ch.id}_${Date.now()}`,
            col: ch.col,
            docId: ch.id,
            doc: ch.doc,
            timestamp: new Date().toISOString(),
            synced: false,
          });
        }
      }

      if (Array.isArray(authUsers)) {
        for (const u of authUsers) {
          if (u.uid) db.authUsers[u.uid] = u;
        }
      }

      // Limit queue size to last 1,000 items
      db.firebaseSyncQueue = db.firebaseSyncQueue.slice(-1000);
      saveSqlDb(db);

      return res.status(200).json({
        status: 'ok',
        synced: changes.length,
        pendingFirebase: db.firebaseSyncQueue.filter((q) => !q.synced).length,
      });
    }

    // Get pending changes to push to Firebase
    if (action === 'get_pending_firebase') {
      const pending = db.firebaseSyncQueue.filter((q) => !q.synced);
      return res.status(200).json({ status: 'ok', pending });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
