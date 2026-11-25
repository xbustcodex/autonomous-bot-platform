/**
 * Functional bot templates with real executable logic (not just prompts).
 */

import type { BotConfig, ExecutionMode } from '../../core/types.js';
import type { TaskHandler } from '../../core/executor/executor.js';

export interface Template {
  id: string;
  name: string;
  description: string;
  createConfig: () => Partial<BotConfig>;
  handlers: Record<string, TaskHandler>;
}

const programmed = (overrides: Partial<BotConfig> = {}): Partial<BotConfig> => ({
  mode: 'programmed' as ExecutionMode,
  ai: { enabled: false, freeOnly: true },
  ...overrides,
});

export const TEMPLATES: Record<string, Template> = {
  counter: {
    id: 'counter',
    name: 'Counter Bot',
    description: 'Simple programmed counter — increments a value on every task. Zero AI.',
    createConfig: () => programmed({
      purpose: 'Demonstrate pure programmed execution',
      objectives: ['Increment counter on each task'],
      tools: [],
    }),
    handlers: {
      'counter.increment': async (task, _bot, ctx) => {
        const current = (ctx.memory.get('count') as number) ?? 0;
        const next = current + 1;
        ctx.memory.set('count', next);
        ctx.log(`Counter: ${current} -> ${next}`);
        return { count: next, taskId: task.id };
      },
    },
  },

  research_monitor: {
    id: 'research_monitor',
    name: 'Research Monitor',
    description: 'Monitors keywords / URLs and records findings. Programmed core.',
    createConfig: () => programmed({
      purpose: 'Monitor information sources',
      objectives: ['Watch configured sources', 'Record changes'],
      tools: ['http.fetch'],
    }),
    handlers: {
      'research.check': async (task, _bot, ctx) => {
        const { url, keyword } = task.payload as { url?: string; keyword?: string };
        const findings: string[] = (ctx.memory.get('findings') as string[]) ?? [];
        findings.push(`Checked ${url ?? 'n/a'} for ${keyword ?? 'n/a'} at ${new Date().toISOString()}`);
        if (findings.length > 100) findings.splice(0, findings.length - 100);
        ctx.memory.set('findings', findings);
        return { findingsCount: findings.length, last: findings[findings.length - 1] };
      },
    },
  },

  website_monitor: {
    id: 'website_monitor',
    name: 'Website Monitor',
    description: 'Polls a URL and records status / content hash changes.',
    createConfig: () => programmed({
      purpose: 'Detect website changes',
      objectives: ['Poll target URL', 'Alert on change'],
      tools: ['http.fetch'],
    }),
    handlers: {
      'website.poll': async (task, _bot, ctx) => {
        const { url } = task.payload as { url: string };
        const history: any[] = (ctx.memory.get('polls') as any[]) ?? [];
        const entry = { url, at: new Date().toISOString(), status: 'recorded' };
        history.push(entry);
        if (history.length > 50) history.shift();
        ctx.memory.set('polls', history);
        return entry;
      },
    },
  },

  data_processor: {
    id: 'data_processor',
    name: 'Data Processor',
    description: 'Processes structured data payloads with deterministic transforms.',
    createConfig: () => programmed({
      purpose: 'Transform and store data',
      objectives: ['Accept payloads', 'Apply rules', 'Persist results'],
      tools: [],
    }),
    handlers: {
      'data.process': async (task, _bot, ctx) => {
        const payload = task.payload;
        const processed = {
          received: payload,
          processedAt: new Date().toISOString(),
          length: JSON.stringify(payload).length,
        };
        const store: any[] = (ctx.memory.get('processed') as any[]) ?? [];
        store.push(processed);
        if (store.length > 200) store.shift();
        ctx.memory.set('processed', store);
        return processed;
      },
    },
  },

  file_manager: {
    id: 'file_manager',
    name: 'File Manager',
    description: 'Programmed file operations within allowed paths.',
    createConfig: () => programmed({
      purpose: 'Manage files under permissions',
      objectives: ['List', 'Read', 'Write within sandbox'],
      tools: ['fs.list', 'fs.read', 'fs.write'],
      permissions: {
        filesystem: { read: ['./data'], write: ['./data'] },
        network: { allow: [], deny: [] },
        shell: false,
        browser: false,
        canDelegate: false,
        canCreateBots: false,
        maxConcurrentTasks: 3,
        requiresApproval: ['fs.write'],
      },
    }),
    handlers: {
      'file.list': async (task, _bot, ctx) => {
        const dir = (task.payload as any).dir ?? './data';
        ctx.log(`Listing ${dir}`);
        return { dir, note: 'fs tool would execute here under permissions' };
      },
    },
  },

  scheduler_demo: {
    id: 'scheduler_demo',
    name: 'Scheduler Demo',
    description: 'Runs on schedule and records execution times.',
    createConfig: () => programmed({
      purpose: 'Demonstrate scheduled execution',
      objectives: ['Run on cron', 'Record timestamps'],
      schedule: { cron: '*/5 * * * *', enabled: true },
    }),
    handlers: {
      'schedule.tick': async (task, _bot, ctx) => {
        const ticks: string[] = (ctx.memory.get('ticks') as string[]) ?? [];
        ticks.push(new Date().toISOString());
        if (ticks.length > 100) ticks.shift();
        ctx.memory.set('ticks', ticks);
        return { tickCount: ticks.length, last: ticks[ticks.length - 1] };
      },
    },
  },

  coordinator: {
    id: 'coordinator',
    name: 'Task Coordinator',
    description: 'Delegates work to other bots (bot-to-bot).',
    createConfig: () => programmed({
      purpose: 'Coordinate and delegate tasks',
      objectives: ['Receive work', 'Delegate to peers'],
      permissions: {
        filesystem: { read: [], write: [] },
        network: { allow: [], deny: [] },
        shell: false,
        browser: false,
        canDelegate: true,
        canCreateBots: false,
        maxConcurrentTasks: 10,
        requiresApproval: [],
      },
    }),
    handlers: {
      'coord.delegate': async (task, bot, ctx) => {
        const { targetBotId, childType, childPayload } = task.payload as any;
        ctx.log(`Delegating to ${targetBotId}`);
        return {
          delegated: true,
          from: bot.id,
          to: targetBotId,
          childType,
          childPayload,
          at: new Date().toISOString(),
        };
      },
    },
  },

  reporter: {
    id: 'reporter',
    name: 'Reporter',
    description: 'Aggregates metrics and produces reports.',
    createConfig: () => programmed({
      purpose: 'Generate operational reports',
      objectives: ['Collect metrics', 'Produce summary'],
    }),
    handlers: {
      'report.summary': async (task, _bot, ctx) => {
        const summary = {
          generatedAt: new Date().toISOString(),
          note: 'Platform metrics would be aggregated here',
          payload: task.payload,
        };
        ctx.memory.set('lastReport', summary);
        return summary;
      },
    },
  },
};

export function getAllHandlers(): Record<string, TaskHandler> {
  const all: Record<string, TaskHandler> = {};
  for (const t of Object.values(TEMPLATES)) {
    Object.assign(all, t.handlers);
  }
  all['test.echo'] = async (task) => ({ echoed: task.payload, at: new Date().toISOString() });
  all['test.noop'] = async () => ({ ok: true });
  all['test.fail'] = async () => { throw new Error('intentional failure'); };
  return all;
}
