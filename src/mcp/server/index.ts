/**
 * MCP Server — exposes platform tools to external AI systems.
 * External clients can submit tasks, disconnect, and retrieve results later.
 *
 * This module is the tool surface. Wire to @modelcontextprotocol/sdk for
 * stdio / Streamable HTTP transport when the SDK is installed.
 */

import { Supervisor } from '../../core/supervisor/supervisor.js';
import { getDb } from '../../storage/database.js';

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

/** Full MCP tool catalogue — every entry has a working handler */
export const MCP_TOOLS: McpToolDef[] = [
  {
    name: 'list_bots',
    description: 'List registered bots (id, name, mode, status)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_bot_details',
    description: 'Get full bot configuration by id',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Bot id' } },
      required: ['id'],
    },
  },
  {
    name: 'create_bot',
    description:
      'Create a programmed software bot (never creates an AI agent). Optional templateId.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        purpose: { type: 'string' },
        templateId: { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'start_bot',
    description: 'Start or resume a bot (status → running)',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'pause_bot',
    description: 'Pause a bot (status → paused); new tasks are not claimed for it',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'stop_bot',
    description: 'Stop a bot (status → stopped)',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'submit_task',
    description:
      'Submit a task to a bot. Returns task id immediately; poll get_task_result later.',
    inputSchema: {
      type: 'object',
      properties: {
        botId: { type: 'string' },
        type: { type: 'string' },
        name: { type: 'string' },
        payload: { type: 'object' },
        priority: { type: 'number' },
        scheduledAt: { type: 'string', description: 'ISO timestamp for delayed execution' },
      },
      required: ['botId', 'type'],
    },
  },
  {
    name: 'get_task_status',
    description: 'Get current status of a task by id',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
    },
  },
  {
    name: 'get_task_result',
    description: 'Get task result (or error) once completed/failed',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
    },
  },
  {
    name: 'get_bot_logs',
    description: 'Recent audit events and tasks for a bot',
    inputSchema: {
      type: 'object',
      properties: {
        botId: { type: 'string' },
        limit: { type: 'number', description: 'Max entries (default 50)' },
      },
      required: ['botId'],
    },
  },
  {
    name: 'list_available_tools',
    description: 'List this MCP server tool catalogue',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_system_health',
    description: 'Platform health: bots, queue, uptime, emergency stop',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_execution_metrics',
    description:
      'Execution metrics: per-bot counters and global task status counts. Optional botId filter.',
    inputSchema: {
      type: 'object',
      properties: {
        botId: { type: 'string', description: 'If set, return only this bot metrics' },
      },
    },
  },
];

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (v === undefined || v === null || String(v).trim() === '') {
    throw new Error(`Missing required argument: ${key}`);
  }
  return String(v);
}

function botStateRow(dataDir: string, botId: string): any | null {
  return (
    (getDb(dataDir)
      .prepare('SELECT * FROM bot_state WHERE bot_id = ?')
      .get(botId) as any | undefined) ?? null
  );
}

function setBotStatus(supervisor: Supervisor, botId: string, status: string) {
  const factory = supervisor.getFactory();
  const bot = factory.get(botId);
  if (!bot) throw new Error(`Bot not found: ${botId}`);
  factory.updateStatus(botId, status);

  const dataDir = supervisor.getDataDir();
  const now = new Date().toISOString();
  getDb(dataDir)
    .prepare(
      `INSERT INTO bot_state (bot_id, status, last_heartbeat, restart_count, metrics, updated_at)
       VALUES (?, ?, ?, 0, '{}', ?)
       ON CONFLICT(bot_id) DO UPDATE SET status = excluded.status, last_heartbeat = excluded.last_heartbeat, updated_at = excluded.updated_at`
    )
    .run(botId, status, now, now);

  supervisor.audit('mcp', `bot_${status}`, botId, { status }, true);
  return { id: botId, name: bot.name, status };
}

export function createMcpHandler(supervisor: Supervisor) {
  const dataDir = supervisor.getDataDir();

  return {
    listTools: () => MCP_TOOLS,

    async callTool(name: string, args: Record<string, unknown> = {}) {
      switch (name) {
        case 'list_bots': {
          const bots = supervisor.getFactory().list();
          return bots.map((b) => {
            const state = botStateRow(dataDir, b.id);
            return {
              id: b.id,
              name: b.name,
              mode: b.mode,
              templateId: b.templateId,
              status: state?.status ?? (b as any).status ?? 'unknown',
              aiEnabled: b.ai?.enabled ?? false,
            };
          });
        }

        case 'get_bot_details': {
          const id = requireString(args, 'id');
          const bot = supervisor.getFactory().get(id);
          if (!bot) throw new Error(`Bot not found: ${id}`);
          const state = botStateRow(dataDir, id);
          return { ...bot, runtime: state };
        }

        case 'create_bot': {
          const name = requireString(args, 'name');
          const bot = supervisor.getFactory().create({
            name,
            description: args.description ? String(args.description) : undefined,
            purpose: args.purpose ? String(args.purpose) : undefined,
            templateId: args.templateId ? String(args.templateId) : undefined,
            mode: 'programmed',
            aiEnabled: false,
          });
          supervisor.audit('mcp', 'create_bot', bot.id, { name: bot.name }, true);
          return {
            id: bot.id,
            name: bot.name,
            mode: bot.mode,
            templateId: bot.templateId,
            aiEnabled: false,
            note: 'Created as programmed worker — no AI agent attached',
          };
        }

        case 'start_bot': {
          const id = requireString(args, 'id');
          return setBotStatus(supervisor, id, 'running');
        }

        case 'pause_bot': {
          const id = requireString(args, 'id');
          return setBotStatus(supervisor, id, 'paused');
        }

        case 'stop_bot': {
          const id = requireString(args, 'id');
          return setBotStatus(supervisor, id, 'stopped');
        }

        case 'submit_task': {
          const botId = requireString(args, 'botId');
          const type = requireString(args, 'type');
          if (!supervisor.getFactory().get(botId)) {
            throw new Error(`Bot not found: ${botId}`);
          }
          const task = supervisor.submitTask(
            botId,
            type,
            args.name ? String(args.name) : type,
            (args.payload as Record<string, unknown>) ?? {},
            {
              priority: typeof args.priority === 'number' ? args.priority : 0,
              scheduledAt: args.scheduledAt ? String(args.scheduledAt) : undefined,
            }
          );
          supervisor.audit('mcp', 'submit_task', task.id, { botId, type }, true);
          return {
            taskId: task.id,
            botId: task.botId,
            type: task.type,
            status: task.status,
            note: 'Poll get_task_status / get_task_result with this taskId',
          };
        }

        case 'get_task_status': {
          const taskId = requireString(args, 'taskId');
          const task = supervisor.getQueue().get(taskId);
          if (!task) throw new Error(`Task not found: ${taskId}`);
          return {
            taskId: task.id,
            botId: task.botId,
            type: task.type,
            name: task.name,
            status: task.status,
            attempts: task.attempts,
            createdAt: task.createdAt,
            startedAt: task.startedAt,
            completedAt: task.completedAt,
            error: task.error,
          };
        }

        case 'get_task_result': {
          const taskId = requireString(args, 'taskId');
          const task = supervisor.getQueue().get(taskId);
          if (!task) throw new Error(`Task not found: ${taskId}`);
          return {
            taskId: task.id,
            status: task.status,
            result: task.result,
            error: task.error,
            completedAt: task.completedAt,
            ready:
              task.status === 'completed' ||
              task.status === 'failed' ||
              task.status === 'cancelled' ||
              task.status === 'timed_out',
          };
        }

        case 'get_bot_logs': {
          const botId = requireString(args, 'botId');
          const limit = Math.min(
            200,
            Math.max(1, typeof args.limit === 'number' ? args.limit : 50)
          );
          const db = getDb(dataDir);

          const audits = db
            .prepare(
              `SELECT id, timestamp, actor, action, resource, details, success
               FROM audit_log
               WHERE resource = ? OR details LIKE ?
               ORDER BY timestamp DESC
               LIMIT ?`
            )
            .all(botId, `%${botId}%`, limit) as any[];

          const tasks = supervisor.getQueue().listByBot(botId, limit).map((t) => ({
            kind: 'task',
            id: t.id,
            type: t.type,
            name: t.name,
            status: t.status,
            createdAt: t.createdAt,
            completedAt: t.completedAt,
            error: t.error,
          }));

          return {
            botId,
            audit: audits.map((a) => ({
              kind: 'audit',
              id: a.id,
              timestamp: a.timestamp,
              actor: a.actor,
              action: a.action,
              resource: a.resource,
              details: a.details ? JSON.parse(a.details) : null,
              success: !!a.success,
            })),
            tasks,
          };
        }

        case 'list_available_tools':
          return MCP_TOOLS;

        case 'get_system_health':
          return supervisor.getHealth();

        case 'get_execution_metrics': {
          const db = getDb(dataDir);
          const queueCounts = supervisor.getQueue().countByStatus();
          const health = supervisor.getHealth();

          if (args.botId) {
            const botId = String(args.botId);
            const state = botStateRow(dataDir, botId);
            const tasks = supervisor.getQueue().listByBot(botId, 500);
            const byStatus: Record<string, number> = {};
            for (const t of tasks) {
              byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
            }
            return {
              botId,
              runtime: state
                ? {
                    status: state.status,
                    lastHeartbeat: state.last_heartbeat,
                    restartCount: state.restart_count,
                    metrics: state.metrics ? JSON.parse(state.metrics) : {},
                  }
                : null,
              taskCounts: byStatus,
              recentTaskCount: tasks.length,
            };
          }

          const allStates = db
            .prepare(
              'SELECT bot_id, status, metrics, last_heartbeat, restart_count FROM bot_state'
            )
            .all() as any[];

          return {
            global: {
              queueCounts,
              health,
            },
            bots: allStates.map((s) => ({
              botId: s.bot_id,
              status: s.status,
              lastHeartbeat: s.last_heartbeat,
              restartCount: s.restart_count,
              metrics: s.metrics ? JSON.parse(s.metrics) : {},
            })),
          };
        }

        default:
          throw new Error(`Unknown MCP tool: ${name}`);
      }
    },
  };
}

export type McpHandler = ReturnType<typeof createMcpHandler>;

/** Standalone smoke entry — lists tools; full transport needs the MCP SDK */
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('MCP tool surface ready.');
  console.log('Tools:', MCP_TOOLS.map((t) => t.name).join(', '));
  console.log(
    'Wire with @modelcontextprotocol/sdk (stdio or Streamable HTTP) for protocol transport.'
  );
}
