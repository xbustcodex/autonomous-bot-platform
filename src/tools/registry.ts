/**
 * Native tool registry.
 * Tools are callable by programmed workflows without AI.
 */

import type { ToolDefinition } from '../core/types.js';

type ToolHandler = (input: unknown, ctx: { botId: string; permissions: any }) => Promise<unknown>;

const tools = new Map<string, { def: ToolDefinition; handler: ToolHandler }>();

export function registerTool(def: ToolDefinition, handler: ToolHandler): void {
  tools.set(def.name, { def, handler });
}

export function getTool(name: string) {
  return tools.get(name);
}

export function listTools(): ToolDefinition[] {
  return [...tools.values()].map(t => t.def);
}

export async function invokeTool(
  name: string,
  input: unknown,
  ctx: { botId: string; permissions: any }
): Promise<unknown> {
  const t = tools.get(name);
  if (!t) throw new Error(`Unknown tool: ${name}`);
  for (const p of t.def.permissions) {
    if (p === 'shell' && !ctx.permissions.shell) throw new Error('Shell permission denied');
    if (p === 'browser' && !ctx.permissions.browser) throw new Error('Browser permission denied');
  }
  return t.handler(input, ctx);
}

registerTool(
  {
    name: 'http.fetch',
    description: 'HTTP GET (fixture-friendly)',
    inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    permissions: ['network'],
    timeoutMs: 15000,
    handler: 'builtin',
  },
  async (input) => {
    const { url } = input as { url: string };
    return { url, status: 200, body: `fixture response for ${url}`, at: new Date().toISOString() };
  }
);

registerTool(
  {
    name: 'fs.list',
    description: 'List directory under allowed paths',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    permissions: ['filesystem'],
    timeoutMs: 5000,
    handler: 'builtin',
  },
  async (input, ctx) => {
    const p = (input as any).path ?? './data';
    return { path: p, entries: [], note: 'sandboxed list' };
  }
);

registerTool(
  {
    name: 'echo',
    description: 'Echo input (test tool)',
    inputSchema: { type: 'object' },
    permissions: [],
    timeoutMs: 1000,
    handler: 'builtin',
  },
  async (input) => ({ echoed: input })
);

registerTool(
  {
    name: 'mcp.call',
    description: 'Call a tool on a registered external MCP server',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string' },
        tool: { type: 'string' },
        args: { type: 'object' },
      },
      required: ['server', 'tool'],
    },
    permissions: ['network'],
    timeoutMs: 30000,
    handler: 'builtin',
  },
  async (input) => {
    const { botCallExternalMcp } = await import('../mcp/client/index.js');
    const { server, tool, args } = input as { server: string; tool: string; args?: Record<string, unknown> };
    return botCallExternalMcp(server, tool, args ?? {});
  }
);
