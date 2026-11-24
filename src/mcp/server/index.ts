/**
 * MCP Server — exposes platform tools to external AI systems.
 * External clients can submit tasks, disconnect, and retrieve results later.
 */

import { Supervisor } from '../../core/supervisor/supervisor.js';

export const MCP_TOOLS = [
  { name: 'list_bots', description: 'List registered bots' },
  { name: 'get_bot_details', description: 'Get bot by id' },
  { name: 'create_bot', description: 'Create a programmed bot' },
  { name: 'start_bot', description: 'Start / resume a bot' },
  { name: 'pause_bot', description: 'Pause a bot' },
  { name: 'stop_bot', description: 'Stop a bot' },
  { name: 'submit_task', description: 'Submit a task to a bot' },
  { name: 'get_task_status', description: 'Get task status' },
  { name: 'get_task_result', description: 'Get task result' },
  { name: 'get_bot_logs', description: 'Get recent bot activity' },
  { name: 'list_available_tools', description: 'List platform tools' },
  { name: 'get_system_health', description: 'System health' },
  { name: 'get_execution_metrics', description: 'Execution metrics' },
];

export function createMcpHandler(supervisor: Supervisor) {
  return {
    listTools: () => MCP_TOOLS,
    async callTool(name: string, args: Record<string, unknown>) {
      switch (name) {
        case 'list_bots':
          return supervisor.getFactory().list().map(b => ({ id: b.id, name: b.name, mode: b.mode }));
        case 'get_bot_details':
          return supervisor.getFactory().get(String(args.id));
        case 'create_bot':
          return supervisor.getFactory().create({
            name: String(args.name ?? 'mcp-bot'),
            templateId: args.templateId as string | undefined,
            mode: 'programmed',
            aiEnabled: false,
          });
        case 'submit_task':
          return supervisor.submitTask(
            String(args.botId),
            String(args.type ?? 'test.noop'),
            String(args.name ?? 'mcp-task'),
            (args.payload as any) ?? {}
          );
        case 'get_task_status':
        case 'get_task_result':
          return supervisor.getQueue().get(String(args.taskId));
        case 'get_system_health':
          return supervisor.getHealth();
        case 'list_available_tools':
          return MCP_TOOLS;
        default:
          throw new Error(`Unknown MCP tool: ${name}`);
      }
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('MCP server stub — tools:', MCP_TOOLS.map(t => t.name).join(', '));
  console.log('Wire to @modelcontextprotocol/sdk for full stdio/HTTP transport.');
}
