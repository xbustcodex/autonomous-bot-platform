/**
 * MCP protocol transports: stdio + Streamable HTTP (with bearer auth).
 *
 * Prefer @modelcontextprotocol/sdk when installed; otherwise a JSON-RPC
 * HTTP shim is used so the platform still works without the dependency.
 */

import type { Express, Request, Response, NextFunction } from 'express';
import { Supervisor } from '../../core/supervisor/supervisor.js';
import { createMcpHandler, MCP_TOOLS } from './index.js';
import { authenticateBearer, createMcpToken, listMcpTokens, revokeMcpToken } from '../auth.js';

function textResult(data: unknown) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return {
    content: [{ type: 'text' as const, text }],
    structuredContent: data,
  };
}

/** Attach MCP routes to the main Express app (Streamable HTTP–style JSON-RPC). */
export function attachMcpHttp(
  app: Express,
  supervisor: Supervisor,
  opts: { path?: string } = {}
): void {
  const base = opts.path ?? '/mcp';
  const handler = createMcpHandler(supervisor);
  const dataDir = supervisor.getDataDir();

  const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const auth = authenticateBearer(dataDir, req.headers.authorization);
    if (!auth.ok) {
      res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: auth.reason ?? 'Unauthorized' },
        id: null,
      });
      return;
    }
    (req as any).mcpAuth = auth;
    next();
  };

  app.post(base, authMiddleware, async (req: Request, res: Response) => {
    try {
      const body = req.body ?? {};
      const id = body.id ?? null;
      const method = body.method as string | undefined;

      if (method === 'initialize') {
        res.json({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'autonomous-bot-platform', version: '0.1.0' },
          },
        });
        return;
      }

      if (method === 'notifications/initialized' || method === 'initialized') {
        res.status(202).end();
        return;
      }

      if (method === 'tools/list') {
        res.json({
          jsonrpc: '2.0',
          id,
          result: {
            tools: MCP_TOOLS.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
            })),
          },
        });
        return;
      }

      if (method === 'tools/call') {
        const name = body.params?.name as string;
        const args = (body.params?.arguments ?? {}) as Record<string, unknown>;
        const auth = authenticateBearer(dataDir, req.headers.authorization, name);
        if (!auth.ok) {
          res.status(403).json({
            jsonrpc: '2.0',
            id,
            error: { code: -32003, message: auth.reason ?? 'Forbidden' },
          });
          return;
        }
        try {
          const result = await handler.callTool(name, args);
          res.json({ jsonrpc: '2.0', id, result: textResult(result) });
        } catch (e: any) {
          res.json({
            jsonrpc: '2.0',
            id,
            error: { code: -32000, message: e?.message ?? String(e) },
          });
        }
        return;
      }

      if (method === 'ping') {
        res.json({ jsonrpc: '2.0', id, result: {} });
        return;
      }

      res.json({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
    } catch (e: any) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: e?.message ?? String(e) },
        id: null,
      });
    }
  });

  app.post(`${base}/tokens`, authMiddleware, (req: Request, res: Response) => {
    const { name, scopes, expiresAt } = req.body ?? {};
    const created = createMcpToken(dataDir, {
      name: name ?? 'mcp-token',
      scopes,
      expiresAt,
    });
    res.status(201).json({
      token: created.token,
      ...created.record,
      warning: 'Store this token securely; it will not be shown again.',
    });
  });

  app.get(`${base}/tokens`, authMiddleware, (_req: Request, res: Response) => {
    res.json(listMcpTokens(dataDir));
  });

  app.delete(`${base}/tokens/:id`, authMiddleware, (req: Request, res: Response) => {
    const ok = revokeMcpToken(dataDir, req.params.id);
    res.status(ok ? 204 : 404).end();
  });

  app.get(base, (_req: Request, res: Response) => {
    res.json({
      name: 'autonomous-bot-platform',
      version: '0.1.0',
      transport: 'streamable-http-jsonrpc',
      path: base,
      auth: process.env.MCP_AUTH_DISABLED === 'true' ? 'disabled' : 'bearer',
      tools: MCP_TOOLS.map((t) => t.name),
    });
  });
}

/** Start MCP over stdio using the official SDK when available. */
export async function startMcpStdio(supervisor: Supervisor): Promise<void> {
  const handler = createMcpHandler(supervisor);

  try {
    const sdk = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const stdioMod = await import('@modelcontextprotocol/sdk/server/stdio.js');
    const { z } = await import('zod');

    const server = new sdk.McpServer({
      name: 'autonomous-bot-platform',
      version: '0.1.0',
    });

    for (const tool of MCP_TOOLS) {
      const shape: Record<string, any> = {};
      const props = (tool.inputSchema as any)?.properties ?? {};
      const required: string[] = (tool.inputSchema as any)?.required ?? [];
      for (const [key, schema] of Object.entries(props) as [string, any][]) {
        let field: any = z.any();
        if (schema?.type === 'string') field = z.string();
        else if (schema?.type === 'number') field = z.number();
        else if (schema?.type === 'object') field = z.record(z.any());
        if (!required.includes(key)) field = field.optional();
        if (schema?.description) field = field.describe(schema.description);
        shape[key] = field;
      }
      const inputSchema = Object.keys(shape).length ? z.object(shape) : z.object({});

      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema },
        async (args: Record<string, unknown>) => {
          try {
            const result = await handler.callTool(tool.name, args ?? {});
            return textResult(result);
          } catch (e: any) {
            return {
              isError: true,
              content: [{ type: 'text', text: e?.message ?? String(e) }],
            };
          }
        }
      );
    }

    const transport = new stdioMod.StdioServerTransport();
    await server.connect(transport);
    console.error('MCP stdio server connected (SDK)');
  } catch (err: any) {
    console.error(
      'MCP stdio requires @modelcontextprotocol/sdk and zod.',
      'Install: npm install @modelcontextprotocol/sdk zod',
      err?.message ?? err
    );
    process.exit(1);
  }
}

export { createMcpHandler, MCP_TOOLS };
