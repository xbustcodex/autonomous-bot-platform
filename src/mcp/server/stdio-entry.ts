/**
 * Standalone MCP stdio entry — for Claude Desktop / Cursor / other local hosts.
 *
 * Usage:
 *   MCP_AUTH_DISABLED=true npx tsx src/mcp/server/stdio-entry.ts
 *
 * Claude Desktop config example:
 * {
 *   "mcpServers": {
 *     "autonomous-bots": {
 *       "command": "npx",
 *       "args": ["tsx", "/path/to/src/mcp/server/stdio-entry.ts"],
 *       "env": { "DATA_DIR": "/path/to/data", "MCP_AUTH_DISABLED": "true" }
 *     }
 *   }
 * }
 */

import 'dotenv/config';
import { Supervisor } from '../../core/supervisor/supervisor.js';
import { getDb } from '../../storage/database.js';
import { startMcpStdio } from './transport.js';

const DATA_DIR = process.env.DATA_DIR ?? './data';

async function main() {
  getDb(DATA_DIR);
  const supervisor = new Supervisor(DATA_DIR);
  await supervisor.start();
  await startMcpStdio(supervisor);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
