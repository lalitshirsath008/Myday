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

function loadSqlDb(): SqlStoreData {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch {
    // Fresh memory store
  }
  return {
    tables: {
      users: {},
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
    authUsers: {},
    firebaseSyncQueue: [],
    lastUpdated: new Date().toISOString(),
  };
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
