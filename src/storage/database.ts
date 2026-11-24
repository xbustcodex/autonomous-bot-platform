/**
 * SQLite storage layer — primary persistence.
 * Designed for easy migration path to PostgreSQL.
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

let db: Database.Database | null = null;

export function getDb(dataDir = './data'): Database.Database {
  if (db) return db;
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'platform.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function migrate(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS bots (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      purpose TEXT,
      objectives TEXT,
      template_id TEXT,
      mode TEXT NOT NULL DEFAULT 'programmed',
      tools TEXT,
      rules TEXT,
      triggers TEXT,
      schedule TEXT,
      permissions TEXT,
      resource_limits TEXT,
      memory TEXT,
      ai TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'created'
    );

    CREATE TABLE IF NOT EXISTS bot_state (
      bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      current_task_id TEXT,
      last_heartbeat TEXT,
      restart_count INTEGER DEFAULT 0,
      metrics TEXT,
      checkpoint TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      payload TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      priority INTEGER DEFAULT 0,
      attempts INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 3,
      created_at TEXT NOT NULL,
      scheduled_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      result TEXT,
      error TEXT,
      parent_task_id TEXT,
      workflow_id TEXT,
      checkpoint TEXT,
      timeout_ms INTEGER DEFAULT 300000
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_bot ON tasks(bot_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_scheduled ON tasks(scheduled_at) WHERE scheduled_at IS NOT NULL;

    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      version INTEGER DEFAULT 1,
      nodes TEXT,
      edges TEXT,
      variables TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bot_memory (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL,
      namespace TEXT NOT NULL DEFAULT 'default',
      key TEXT NOT NULL,
      value TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(bot_id, namespace, key)
    );

    CREATE TABLE IF NOT EXISTS shared_memory (
      id TEXT PRIMARY KEY,
      namespace TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(namespace, key)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      resource TEXT,
      details TEXT,
      success INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(timestamp);

    CREATE TABLE IF NOT EXISTS execution_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id TEXT,
      metric_name TEXT NOT NULL,
      metric_value REAL,
      recorded_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS secrets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      encrypted_value TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS platform_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

export function resetDbForTests(dataDir = './data/test'): void {
  closeDb();
  const dbPath = path.join(dataDir, 'platform.db');
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  getDb(dataDir);
}
