# MCP Integration

## Server (platform → external AI hosts)

### Streamable HTTP (JSON-RPC)

- URL: `http://127.0.0.1:3847/mcp` (same process as the dashboard)
- Auth: `Authorization: Bearer <token>`
- Methods: `initialize`, `tools/list`, `tools/call`, `ping`

Bootstrap token is printed once on first start if `MCP_AUTH_TOKEN` is unset and `MCP_AUTH_DISABLED` is not `true`.

Create more tokens:

```bash
curl -s -X POST http://127.0.0.1:3847/mcp/tokens \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"claude","scopes":["bots:read","bots:write","tasks:read","tasks:write","health:read"]}'
```

### stdio (Claude Desktop / Cursor)

```bash
npm install
MCP_AUTH_DISABLED=true DATA_DIR=./data npx tsx src/mcp/server/stdio-entry.ts
```

Requires `@modelcontextprotocol/sdk` and `zod`.

## Client (bots → external MCP servers)

```ts
import { registerExternalMcp, botCallExternalMcp } from './mcp/client/index.js';

registerExternalMcp('weather', {
  url: 'http://127.0.0.1:3000/mcp',
  token: process.env.WEATHER_MCP_TOKEN,
});

await botCallExternalMcp('weather', 'get_forecast', { city: 'Sydney' });
```

Bot tool: `mcp.call` with `{ server, tool, args }`.

## Scopes

| Scope | Tools |
|-------|--------|
| bots:read | list_bots, get_bot_details |
| bots:write | create_bot, start_bot, pause_bot, stop_bot |
| tasks:read | get_task_status, get_task_result |
| tasks:write | submit_task |
| logs:read | get_bot_logs |
| health:read | get_system_health, list_available_tools |
| metrics:read | get_execution_metrics |

## Env

| Variable | Meaning |
|----------|---------|
| MCP_ENABLED | default true |
| MCP_PATH | default `/mcp` |
| MCP_AUTH_TOKEN | static bearer (optional) |
| MCP_AUTH_DISABLED | skip auth (dev only) |
