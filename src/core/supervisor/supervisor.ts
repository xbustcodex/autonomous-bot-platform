/**
 * Native supervisor — monitors bots, assigns work, recovers failures.
 * Fully programmed; does not require AI.
 */

import { EventEmitter } from 'eventemitter3';
import { BotFactory } from '../../bots/factory/bot-factory.js';
import { Executor } from '../executor/executor.js';
import { TaskQueue } from '../queue/task-queue.js';
import { getAllHandlers } from '../../bots/templates/index.js';
import { getDb } from '../../storage/database.js';
import type { SystemHealth } from '../types.js';
import { v4 as uuidv4 } from 'uuid';

export class Supervisor extends EventEmitter {
  private factory: BotFactory;
  private executor: Executor;
  private queue: TaskQueue;
  private dataDir: string;
  private emergencyStop = false;
  private startedAt = Date.now();
  private healthInterval?: ReturnType<typeof setInterval>;

  constructor(dataDir = './data') {
    super();
    this.dataDir = dataDir;
    this.factory = new BotFactory(dataDir);
    this.executor = new Executor({ dataDir, maxConcurrent: 30 });
    this.queue = this.executor.getQueue();

    const handlers = getAllHandlers();
    for (const [type, handler] of Object.entries(handlers)) {
      this.executor.registerHandler(type, handler);
    }
  }

  async start(): Promise<void> {
    const meta = getDb(this.dataDir).prepare('SELECT value FROM platform_meta WHERE key = ?').get('emergency_stop') as { value: string } | undefined;
    this.emergencyStop = meta?.value === 'true';

    if (this.emergencyStop) {
      this.emit('emergency_stop');
      return;
    }

    await this.executor.start();
    this.healthInterval = setInterval(() => this.heartbeat(), 5000);
    this.emit('started');
  }

  stop(): void {
    this.executor.stop();
    if (this.healthInterval) clearInterval(this.healthInterval);
    this.emit('stopped');
  }

  setEmergencyStop(on: boolean): void {
    this.emergencyStop = on;
    getDb(this.dataDir).prepare(`
      INSERT INTO platform_meta (key, value) VALUES ('emergency_stop', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(on ? 'true' : 'false');
    if (on) {
      this.executor.stop();
      this.emit('emergency_stop');
    } else {
      this.executor.start();
    }
  }

  isEmergencyStopped(): boolean {
    return this.emergencyStop;
  }

  getDataDir(): string {
    return this.dataDir;
  }

  getFactory(): BotFactory {
    return this.factory;
  }

  getExecutor(): Executor {
    return this.executor;
  }

  getQueue(): TaskQueue {
    return this.queue;
  }

  submitTask(botId: string, type: string, name: string, payload: Record<string, unknown> = {}, opts: { priority?: number; scheduledAt?: string } = {}) {
    if (this.emergencyStop) throw new Error('Emergency stop active');
    return this.queue.enqueue({
      botId,
      type,
      name,
      payload,
      priority: opts.priority ?? 0,
      scheduledAt: opts.scheduledAt,
      maxAttempts: 3,
      timeoutMs: 300000,
    });
  }

  getHealth(): SystemHealth {
    const bots = this.factory.list();
    const counts = this.queue.countByStatus();
    return {
      status: this.emergencyStop ? 'emergency_stop' : 'healthy',
      bots: {
        total: bots.length,
        running: bots.filter(b => (b as any).status === 'running').length,
        error: bots.filter(b => (b as any).status === 'error').length,
      },
      tasks: {
        pending: (counts['pending'] ?? 0) + (counts['queued'] ?? 0),
        running: counts['running'] ?? 0,
        failed: counts['failed'] ?? 0,
      },
      queueDepth: (counts['pending'] ?? 0) + (counts['queued'] ?? 0) + (counts['retrying'] ?? 0),
      uptimeMs: Date.now() - this.startedAt,
      aiEnabled: false,
      mcpEnabled: true,
      lastCheck: new Date().toISOString(),
    };
  }

  private heartbeat(): void {
    const now = new Date().toISOString();
    getDb(this.dataDir).prepare(`
      UPDATE bot_state SET last_heartbeat = ? WHERE status = 'idle' OR status = 'running'
    `).run(now);
    this.emit('heartbeat', this.getHealth());
  }

  audit(actor: string, action: string, resource: string, details: Record<string, unknown>, success: boolean): void {
    getDb(this.dataDir).prepare(`
      INSERT INTO audit_log (id, timestamp, actor, action, resource, details, success)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), new Date().toISOString(), actor, action, resource, JSON.stringify(details), success ? 1 : 0);
  }
}
