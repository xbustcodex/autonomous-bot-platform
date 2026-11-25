/**
 * Native execution engine.
 * Runs programmed tasks without any AI requirement.
 * Supports checkpointing, timeouts, retries via queue.
 */

import { EventEmitter } from 'eventemitter3';
import { TaskQueue } from '../queue/task-queue.js';
import type { Task, BotConfig, ExecutionMode } from '../types.js';
import { getDb } from '../../storage/database.js';
import { v4 as uuidv4 } from 'uuid';

export type TaskHandler = (task: Task, bot: BotConfig, ctx: ExecutionContext) => Promise<unknown>;

export interface ExecutionContext {
  botId: string;
  taskId: string;
  checkpoint: (data: unknown) => void;
  log: (msg: string, data?: unknown) => void;
  memory: {
    get: (key: string, ns?: string) => unknown;
    set: (key: string, value: unknown, ns?: string) => void;
  };
  tools: Record<string, (input: unknown) => Promise<unknown>>;
  emit: (event: string, data?: unknown) => void;
}

export class Executor extends EventEmitter {
  private queue: TaskQueue;
  private handlers = new Map<string, TaskHandler>();
  private running = false;
  private workers = new Map<string, { abort: AbortController; promise: Promise<void> }>();
  private dataDir: string;
  private pollIntervalMs: number;
  private maxConcurrent: number;

  constructor(opts: { dataDir?: string; pollIntervalMs?: number; maxConcurrent?: number } = {}) {
    super();
    this.dataDir = opts.dataDir ?? './data';
    this.queue = new TaskQueue(this.dataDir);
    this.pollIntervalMs = opts.pollIntervalMs ?? 200;
    this.maxConcurrent = opts.maxConcurrent ?? 20;
  }

  registerHandler(type: string, handler: TaskHandler): void {
    this.handlers.set(type, handler);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.emit('started');
    this.loop();
  }

  stop(): void {
    this.running = false;
    for (const w of this.workers.values()) w.abort.abort();
    this.workers.clear();
    this.emit('stopped');
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        if (this.workers.size < this.maxConcurrent) {
          const task = this.queue.claimNext();
          if (task) {
            this.runTask(task);
          }
        }
      } catch (err) {
        this.emit('error', err);
      }
      await sleep(this.pollIntervalMs);
    }
  }

  private runTask(task: Task): void {
    const abort = new AbortController();
    const promise = this.execute(task, abort.signal)
      .catch((err) => {
        this.queue.fail(task.id, err instanceof Error ? err.message : String(err));
        this.emit('task:failed', task, err);
      })
      .finally(() => {
        this.workers.delete(task.id);
      });
    this.workers.set(task.id, { abort, promise });
  }

  private async execute(task: Task, signal: AbortSignal): Promise<void> {
    const handler = this.handlers.get(task.type);
    if (!handler) {
      this.queue.fail(task.id, `No handler for task type: ${task.type}`, false);
      return;
    }

    const bot = this.loadBot(task.botId);
    if (!bot) {
      this.queue.fail(task.id, `Bot not found: ${task.botId}`, false);
      return;
    }

    if (bot.mode === 'programmed' && task.type.startsWith('ai.')) {
      this.queue.fail(task.id, 'AI tasks disabled in programmed mode', false);
      return;
    }

    const timeout = setTimeout(() => {
      this.queue.fail(task.id, 'timeout');
    }, task.timeoutMs);

    const ctx: ExecutionContext = {
      botId: bot.id,
      taskId: task.id,
      checkpoint: (data) => {
        getDb(this.dataDir).prepare('UPDATE tasks SET checkpoint = ? WHERE id = ?')
          .run(JSON.stringify(data), task.id);
      },
      log: (msg, data) => this.emit('log', { botId: bot.id, taskId: task.id, msg, data }),
      memory: {
        get: (key, ns = 'default') => {
          const row = getDb(this.dataDir).prepare(
            'SELECT value FROM bot_memory WHERE bot_id = ? AND namespace = ? AND key = ?'
          ).get(bot.id, ns, key) as { value: string } | undefined;
          return row ? JSON.parse(row.value) : undefined;
        },
        set: (key, value, ns = 'default') => {
          const now = new Date().toISOString();
          getDb(this.dataDir).prepare(`
            INSERT INTO bot_memory (id, bot_id, namespace, key, value, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(bot_id, namespace, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
          `).run(uuidv4(), bot.id, ns, key, JSON.stringify(value), now, now);
        },
      },
      tools: {},
      emit: (event, data) => this.emit(event, { botId: bot.id, taskId: task.id, data }),
    };

    try {
      if (signal.aborted) throw new Error('aborted');
      const result = await handler(task, bot, ctx);
      clearTimeout(timeout);
      this.queue.complete(task.id, result);
      this.emit('task:completed', task, result);
      this.bumpMetrics(bot.id, true);
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }

  private loadBot(botId: string): BotConfig | null {
    const row = getDb(this.dataDir).prepare('SELECT * FROM bots WHERE id = ?').get(botId) as any;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      purpose: row.purpose,
      objectives: row.objectives ? JSON.parse(row.objectives) : [],
      templateId: row.template_id,
      mode: row.mode as ExecutionMode,
      tools: row.tools ? JSON.parse(row.tools) : [],
      rules: row.rules ? JSON.parse(row.rules) : [],
      triggers: row.triggers ? JSON.parse(row.triggers) : [],
      schedule: row.schedule ? JSON.parse(row.schedule) : undefined,
      permissions: row.permissions ? JSON.parse(row.permissions) : defaultPermissions(),
      resourceLimits: row.resource_limits ? JSON.parse(row.resource_limits) : defaultLimits(),
      memory: row.memory ? JSON.parse(row.memory) : { private: true, sharedNamespaces: [], maxEntries: 1000, persist: true },
      ai: row.ai ? JSON.parse(row.ai) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
    };
  }

  private bumpMetrics(botId: string, success: boolean): void {
    const db = getDb(this.dataDir);
    const state = db.prepare('SELECT metrics FROM bot_state WHERE bot_id = ?').get(botId) as { metrics: string } | undefined;
    const metrics = state?.metrics ? JSON.parse(state.metrics) : { tasksCompleted: 0, tasksFailed: 0, totalRuntimeMs: 0, aiInferences: 0 };
    if (success) metrics.tasksCompleted += 1;
    else metrics.tasksFailed += 1;
    db.prepare(`
      INSERT INTO bot_state (bot_id, status, last_heartbeat, restart_count, metrics, updated_at)
      VALUES (?, 'idle', ?, 0, ?, ?)
      ON CONFLICT(bot_id) DO UPDATE SET metrics = excluded.metrics, last_heartbeat = excluded.last_heartbeat, updated_at = excluded.updated_at
    `).run(botId, new Date().toISOString(), JSON.stringify(metrics), new Date().toISOString());
  }

  getQueue(): TaskQueue {
    return this.queue;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function defaultPermissions() {
  return {
    filesystem: { read: ['./data'], write: ['./data'] },
    network: { allow: [], deny: [] },
    shell: false,
    browser: false,
    canDelegate: true,
    canCreateBots: false,
    maxConcurrentTasks: 5,
    requiresApproval: ['shell', 'destructive'],
  };
}

function defaultLimits() {
  return {
    maxTaskDurationMs: 300000,
    maxRetries: 3,
    maxTasksPerHour: 1000,
  };
}
