import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'

let db: Database.Database | null = null

const MIGRATIONS: string[] = [
  // Migration 1: initial schema
  `
  CREATE TABLE IF NOT EXISTS agents (
    id         TEXT PRIMARY KEY,
    version    INTEGER NOT NULL DEFAULT 1,
    name       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    provider   TEXT NOT NULL,  -- JSON: ProviderConfig
    system_prompt TEXT NOT NULL DEFAULT '',
    graph      TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}', -- JSON: graph
    code_blocks TEXT NOT NULL DEFAULT '[]',  -- JSON: CodeBlock[]
    permissions TEXT NOT NULL DEFAULT '{}',  -- JSON: ToolPermissions
    tags       TEXT NOT NULL DEFAULT '[]',   -- JSON: string[]
    audit_enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL  -- JSON encoded value
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts         TEXT NOT NULL DEFAULT (datetime('now','utc')),
    agent_id   TEXT NOT NULL,
    run_id     TEXT NOT NULL,
    event_type TEXT NOT NULL,
    tool       TEXT,
    payload    TEXT,    -- JSON, secrets redacted before storing
    outcome    TEXT NOT NULL DEFAULT 'success',
    error      TEXT
  );

  -- Index for common audit log queries
  CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_log(agent_id);
  CREATE INDEX IF NOT EXISTS idx_audit_run   ON audit_log(run_id);
  CREATE INDEX IF NOT EXISTS idx_audit_ts    ON audit_log(ts);
  `
]

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.')
  }
  return db
}

export function initDb(): Database.Database {
  const userDataPath = app.getPath('userData')
  const dbDir = path.join(userDataPath, 'data')

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }

  const dbPath = path.join(dbDir, 'agentbuilder.db')
  db = new Database(dbPath)

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL')
  // Enable foreign keys
  db.pragma('foreign_keys = ON')
  // Secure delete (overwrite deleted pages with zeros)
  db.pragma('secure_delete = ON')

  runMigrations(db)

  return db
}

function runMigrations(database: Database.Database): void {
  // Create migration tracking table
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now','utc'))
    )
  `)

  const getVersion = database.prepare('SELECT MAX(version) as v FROM schema_migrations')
  const result = getVersion.get() as { v: number | null }
  const currentVersion = result.v ?? 0

  for (let i = currentVersion; i < MIGRATIONS.length; i++) {
    const migrationVersion = i + 1
    database.transaction(() => {
      database.exec(MIGRATIONS[i])
      database
        .prepare('INSERT INTO schema_migrations (version) VALUES (?)')
        .run(migrationVersion)
    })()
    console.log(`[db] Applied migration ${migrationVersion}`)
  }
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
