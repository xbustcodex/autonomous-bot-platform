/**
 * Bot Factory — creates independent programmable software workers.
 * Creating a bot does NOT create an AI agent unless explicitly requested.
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../../storage/database.js';
import type { BotConfig, ExecutionMode, PermissionSet, ResourceLimits } from '../../core/types.js';
import { TEMPLATES } from '../templates/index.js';

export class BotFactory {
  private dataDir: string;

  constructor(dataDir = './data') {
    this.dataDir = dataDir;
    getDb(dataDir);
  }

  create(opts: {
    name: string;
    description?: string;
    purpose?: string;
    objectives?: string[];
    templateId?: string;
    mode?: ExecutionMode;
    tools?: string[];
    permissions?: Partial<PermissionSet>;
    resourceLimits?: Partial<ResourceLimits>;
    aiEnabled?: boolean;
  }): BotConfig {
    const now = new Date().toISOString();
    const id = uuidv4();

    let base: Partial<BotConfig> = {};
    if (opts.templateId && TEMPLATES[opts.templateId]) {
      base = TEMPLATES[opts.templateId].createConfig();
    }

    const config: BotConfig = {
      id,
      name: opts.name,
      description: opts.description ?? base.description ?? '',
      purpose: opts.purpose ?? base.purpose ?? '',
      objectives: opts.objectives ?? base.objectives ?? [],
      templateId: opts.templateId,
      mode: opts.mode ?? base.mode ?? 'programmed',
      tools: opts.tools ?? base.tools ?? [],
      rules: base.rules ?? [],
      triggers: base.triggers ?? [],
      schedule: base.schedule,
      permissions: {
        filesystem: { read: ['./data'], write: ['./data'] },
        network: { allow: [], deny: [] },
        shell: false,
        browser: false,
        canDelegate: true,
        canCreateBots: false,
        maxConcurrentTasks: 5,
        requiresApproval: ['shell', 'destructive'],
        ...base.permissions,
        ...opts.permissions,
      },
      resourceLimits: {
        maxTaskDurationMs: 300000,
        maxRetries: 3,
        maxTasksPerHour: 1000,
        ...base.resourceLimits,
        ...opts.resourceLimits,
      },
      memory: base.memory ?? { private: true, sharedNamespaces: [], maxEntries: 1000, persist: true },
      ai: opts.aiEnabled
        ? { enabled: true, freeOnly: true }
        : { enabled: false, freeOnly: true },
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    if (!opts.aiEnabled) {
      config.mode = 'programmed';
      config.ai = { enabled: false, freeOnly: true };
    }

    const db = getDb(this.dataDir);
    db.prepare(`
      INSERT INTO bots (
        id, name, description, purpose, objectives, template_id, mode, tools,
        rules, triggers, schedule, permissions, resource_limits, memory, ai,
        created_at, updated_at, version, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      config.id, config.name, config.description, config.purpose,
      JSON.stringify(config.objectives), config.templateId ?? null, config.mode,
      JSON.stringify(config.tools), JSON.stringify(config.rules),
      JSON.stringify(config.triggers), config.schedule ? JSON.stringify(config.schedule) : null,
      JSON.stringify(config.permissions), JSON.stringify(config.resourceLimits),
      JSON.stringify(config.memory), JSON.stringify(config.ai),
      config.createdAt, config.updatedAt, config.version, 'created'
    );

    db.prepare(`
      INSERT INTO bot_state (bot_id, status, last_heartbeat, restart_count, metrics, updated_at)
      VALUES (?, 'idle', ?, 0, ?, ?)
    `).run(config.id, now, JSON.stringify({ tasksCompleted: 0, tasksFailed: 0, totalRuntimeMs: 0, aiInferences: 0 }), now);

    return config;
  }

  clone(sourceId: string, newName: string): BotConfig | null {
    const source = this.get(sourceId);
    if (!source) return null;
    return this.create({
      name: newName,
      description: source.description,
      purpose: source.purpose,
      objectives: [...source.objectives],
      templateId: source.templateId,
      mode: source.mode,
      tools: [...source.tools],
      permissions: source.permissions,
      resourceLimits: source.resourceLimits,
      aiEnabled: source.ai?.enabled ?? false,
    });
  }

  get(id: string): BotConfig | null {
    const row = getDb(this.dataDir).prepare('SELECT * FROM bots WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToConfig(row);
  }

  list(): BotConfig[] {
    const rows = getDb(this.dataDir).prepare('SELECT * FROM bots ORDER BY created_at DESC').all() as any[];
    return rows.map(r => this.rowToConfig(r));
  }

  updateStatus(id: string, status: string): void {
    getDb(this.dataDir).prepare('UPDATE bots SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, new Date().toISOString(), id);
  }

  delete(id: string): void {
    getDb(this.dataDir).prepare('DELETE FROM bots WHERE id = ?').run(id);
  }

  private rowToConfig(row: any): BotConfig {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      purpose: row.purpose,
      objectives: row.objectives ? JSON.parse(row.objectives) : [],
      templateId: row.template_id,
      mode: row.mode,
      tools: row.tools ? JSON.parse(row.tools) : [],
      rules: row.rules ? JSON.parse(row.rules) : [],
      triggers: row.triggers ? JSON.parse(row.triggers) : [],
      schedule: row.schedule ? JSON.parse(row.schedule) : undefined,
      permissions: row.permissions ? JSON.parse(row.permissions) : {},
      resourceLimits: row.resource_limits ? JSON.parse(row.resource_limits) : {},
      memory: row.memory ? JSON.parse(row.memory) : {},
      ai: row.ai ? JSON.parse(row.ai) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
    } as BotConfig;
  }
}
