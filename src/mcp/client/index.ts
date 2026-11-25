/**
 * MCP Client — lets bots call external MCP servers.
 * Supports Streamable HTTP (URL) and optional SDK Client when installed.
 */

export interface McpClientOptions {
  url: string;
  token?: string;
  timeoutMs?: number;
}

export interface RemoteTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export class McpClient {
  private url: string;
  private token?: string;
  private timeoutMs: number;
  private sessionId?: string;

  constructor(opts: McpClientOptions) {
    this.url = opts.url.replace(/\/$/, '');
    this.token = opts.token;
    this.timeoutMs = opts.timeoutMs ?? 30000;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    if (this.sessionId) h['Mcp-Session-Id'] = this.sessionId;
    return h;
  }

  private async post(body: unknown): Promise<any> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const sid = res.headers.get('mcp-session-id');
      if (sid) this.sessionId = sid;
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 400)}`);
      }
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('text/event-stream')) {
        const text = await res.text();
        const dataLine = text.split('\n').find((l) => l.startsWith('data:'));
        if (dataLine) return JSON.parse(dataLine.slice(5).trim());
        return { raw: text };
      }
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  async initialize(): Promise<any> {
    const result = await this.post({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'autonomous-bot-platform', version: '0.1.0' },
      },
    });
    try {
      await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    } catch {
      /* optional */
    }
    return result?.result ?? result;
  }

  async listTools(): Promise<RemoteTool[]> {
    const res = await this.post({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });
    return (res?.result?.tools ?? res?.tools ?? []) as RemoteTool[];
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const res = await this.post({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name, arguments: args },
    });
    if (res?.error) throw new Error(res.error.message ?? JSON.stringify(res.error));
    const content = res?.result?.content;
    if (Array.isArray(content)) {
      const text = content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n');
      try {
        return JSON.parse(text);
      } catch {
        return text || res.result;
      }
    }
    return res?.result ?? res;
  }
}

const clients = new Map<string, McpClient>();

export function registerExternalMcp(name: string, opts: McpClientOptions): McpClient {
  const c = new McpClient(opts);
  clients.set(name, c);
  return c;
}

export function getExternalMcp(name: string): McpClient | undefined {
  return clients.get(name);
}

export function listExternalMcp(): string[] {
  return [...clients.keys()];
}

export async function botCallExternalMcp(
  serverName: string,
  toolName: string,
  args: Record<string, unknown> = {}
): Promise<unknown> {
  const client = clients.get(serverName);
  if (!client) {
    throw new Error(`Unknown external MCP server: ${serverName}. Register with registerExternalMcp().`);
  }
  return client.callTool(toolName, args);
}
