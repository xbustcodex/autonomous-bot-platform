/**
 * MCP path authentication — scoped bearer tokens.
 * Tokens grant tool-level access; never bypass bot permissions.
 */

import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { getDb } from '../storage/database.js';

export interface McpTokenRecord {
  id: string;
  name: string;
  tokenHash: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  revoked: boolean;
}

const DEFAULT_SCOPES = [
  'bots:read',
  'bots:write',
  'tasks:read',
  'tasks:write',
  'health:read',
  'metrics:read',
  'logs:read',
];

export const TOOL_SCOPES: Record<string, string[]> = {
  list_bots: ['bots:read'],
  get_bot_details: ['bots:read'],
  create_bot: ['bots:write'],
  start_bot: ['bots:write'],
  pause_bot: ['bots:write'],
  stop_bot: ['bots:write'],
  submit_task: ['tasks:write'],
  get_task_status: ['tasks:read'],
  get_task_result: ['tasks:read'],
  get_bot_logs: ['logs:read'],
  list_available_tools: ['health:read'],
  get_system_health: ['health:read'],
  get_execution_metrics: ['metrics:read'],
};

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function ensureTable(dataDir: string): void {
  getDb(dataDir).exec(`
    CREATE TABLE IF NOT EXISTS mcp_tokens (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      prefix TEXT NOT NULL,
      scopes TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT,
      last_used_at TEXT,
      revoked INTEGER NOT NULL DEFAULT 0
    );
  `);
}

export function createMcpToken(
  dataDir: string,
  opts: { name: string; scopes?: string[]; expiresAt?: string } = { name: 'default' }
): { token: string; record: Omit<McpTokenRecord, 'tokenHash'> } {
  ensureTable(dataDir);
  const raw = `abp_${randomBytes(24).toString('base64url')}`;
  const id = randomBytes(8).toString('hex');
  const prefix = raw.slice(0, 12);
  const scopes = opts.scopes?.length ? opts.scopes : DEFAULT_SCOPES;
  const now = new Date().toISOString();
  getDb(dataDir)
    .prepare(
      `INSERT INTO mcp_tokens (id, name, token_hash, prefix, scopes, created_at, expires_at, revoked)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
    )
    .run(id, opts.name, hashToken(raw), prefix, JSON.stringify(scopes), now, opts.expiresAt ?? null);

  return {
    token: raw,
    record: {
      id,
      name: opts.name,
      prefix,
      scopes,
      createdAt: now,
      expiresAt: opts.expiresAt,
      revoked: false,
    },
  };
}

export function listMcpTokens(dataDir: string): Omit<McpTokenRecord, 'tokenHash'>[] {
  ensureTable(dataDir);
  const rows = getDb(dataDir)
    .prepare(
      `SELECT id, name, prefix, scopes, created_at, expires_at, last_used_at, revoked FROM mcp_tokens ORDER BY created_at DESC`
    )
    .all() as any[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    scopes: JSON.parse(r.scopes),
    createdAt: r.created_at,
    expiresAt: r.expires_at ?? undefined,
    lastUsedAt: r.last_used_at ?? undefined,
    revoked: !!r.revoked,
  }));
}

export function revokeMcpToken(dataDir: string, id: string): boolean {
  ensureTable(dataDir);
  const r = getDb(dataDir).prepare(`UPDATE mcp_tokens SET revoked = 1 WHERE id = ?`).run(id);
  return r.changes > 0;
}

export interface AuthResult {
  ok: boolean;
  reason?: string;
  scopes?: string[];
  tokenId?: string;
}

export function authenticateBearer(
  dataDir: string,
  authorizationHeader: string | undefined,
  toolName?: string
): AuthResult {
  ensureTable(dataDir);

  if (process.env.MCP_AUTH_DISABLED === 'true') {
    return { ok: true, scopes: DEFAULT_SCOPES, tokenId: 'dev-bypass' };
  }

  const envToken = process.env.MCP_AUTH_TOKEN;
  if (envToken && authorizationHeader) {
    const presented = authorizationHeader.replace(/^Bearer\s+/i, '').trim();
    if (presented && presented === envToken) {
      return { ok: true, scopes: DEFAULT_SCOPES, tokenId: 'env' };
    }
  }

  if (!authorizationHeader || !/^Bearer\s+/i.test(authorizationHeader)) {
    return { ok: false, reason: 'Missing or invalid Authorization header (Bearer required)' };
  }

  const presented = authorizationHeader.replace(/^Bearer\s+/i, '').trim();
  if (!presented) return { ok: false, reason: 'Empty bearer token' };

  const hash = hashToken(presented);
  const row = getDb(dataDir)
    .prepare(`SELECT id, scopes, expires_at, revoked FROM mcp_tokens WHERE token_hash = ?`)
    .get(hash) as any | undefined;

  if (!row) return { ok: false, reason: 'Invalid token' };
  if (row.revoked) return { ok: false, reason: 'Token revoked' };
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: 'Token expired' };
  }

  const scopes: string[] = JSON.parse(row.scopes);
  if (toolName) {
    const needed = TOOL_SCOPES[toolName] ?? [];
    const allowed =
      needed.length === 0 || needed.some((s) => scopes.includes(s) || scopes.includes('*'));
    if (!allowed) {
      return {
        ok: false,
        reason: `Token lacks scope for tool ${toolName} (need one of: ${needed.join(', ')})`,
        scopes,
      };
    }
  }

  getDb(dataDir)
    .prepare(`UPDATE mcp_tokens SET last_used_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), row.id);

  return { ok: true, scopes, tokenId: row.id };
}

export function safeCompare(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
