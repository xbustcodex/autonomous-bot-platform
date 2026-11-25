/**
 * Persistent task queue backed by SQLite.
 * No Redis required. Supports priority, delayed, retry, duplicate prevention.
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../../storage/database.js';
import type { Task, TaskStatus } from '../types.js';

export class TaskQueue {
  private dataDir: string;

  constructor(dataDir = './data') {
    this.dataDir = dataDir;
    getDb(dataDir);
  }

  enqueue(partial: Omit<Task, 'id' | 'createdAt' | 'status' | 'attempts'> & { id?: string }): Task {
    const db = getDb(this.dataDir);
    const now = new Date().toISOString();
    const task: Task = {
      id: partial.id ?? uuidv4(),
      botId: partial.botId,
      type: partial.type,
      name: partial.name,
      payload: partial.payload ?? {},
      status: 'pending',
      priority: partial.priority ?? 0,
      attempts: 0,
      maxAttempts: partial.maxAttempts ?? 3,
      createdAt: now,
      scheduledAt: partial.scheduledAt,
      timeoutMs: partial.timeoutMs ?? 300000,
      parentTaskId: partial.parentTaskId,
      workflowId: partial.workflowId,
    };

    const existing = db.prepare(`
      SELECT id FROM tasks
      WHERE bot_id = ? AND type = ? AND name = ? AND status IN ('pending','queued','running')
      LIMIT 1
    `).get(task.botId, task.type, task.name) as { id: string } | undefined;

    if (existing) {
      return this.get(existing.id)!;
    }

    db.prepare(`
      INSERT INTO tasks (
        id, bot_id, type, name, payload, status, priority, attempts, max_attempts,
        created_at, scheduled_at, parent_task_id, workflow_id, timeout_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id, task.botId, task.type, task.name, JSON.stringify(task.payload),
      task.status, task.priority, task.attempts, task.maxAttempts,
      task.createdAt, task.scheduledAt ?? null, task.parentTaskId ?? null,
      task.workflowId ?? null, task.timeoutMs
    );

    return task;
  }

  claimNext(botId?: string): Task | null {
    const db = getDb(this.dataDir);
    const now = new Date().toISOString();

    const row = botId
      ? db.prepare(`
          SELECT * FROM tasks
          WHERE status IN ('pending', 'queued')
            AND (scheduled_at IS NULL OR scheduled_at <= ?)
            AND bot_id = ?
          ORDER BY priority DESC, created_at ASC
          LIMIT 1
        `).get(now, botId) as any
      : db.prepare(`
          SELECT * FROM tasks
          WHERE status IN ('pending', 'queued')
            AND (scheduled_at IS NULL OR scheduled_at <= ?)
          ORDER BY priority DESC, created_at ASC
          LIMIT 1
        `).get(now) as any;

    if (!row) return null;

    const updated = db.prepare(`
      UPDATE tasks SET status = 'running', started_at = ?, attempts = attempts + 1
      WHERE id = ? AND status IN ('pending', 'queued')
    `).run(now, row.id);

    if (updated.changes === 0) return null;

    return this.rowToTask(row);
  }

  complete(taskId: string, result: unknown): void {
    const db = getDb(this.dataDir);
    db.prepare(`
      UPDATE tasks SET status = 'completed', completed_at = ?, result = ?, error = NULL
      WHERE id = ?
    `).run(new Date().toISOString(), JSON.stringify(result), taskId);
  }

  fail(taskId: string, error: string, retry = true): void {
    const db = getDb(this.dataDir);
    const task = this.get(taskId);
    if (!task) return;

    if (retry && task.attempts < task.maxAttempts) {
      const delayMs = Math.min(60000, 1000 * Math.pow(2, task.attempts));
      const scheduled = new Date(Date.now() + delayMs).toISOString();
      db.prepare(`
        UPDATE tasks SET status = 'pending', error = ?, scheduled_at = ?
        WHERE id = ?
      `).run(error, scheduled, taskId);
    } else {
      db.prepare(`
        UPDATE tasks SET status = 'failed', completed_at = ?, error = ?
        WHERE id = ?
      `).run(new Date().toISOString(), error, taskId);
    }
  }

  cancel(taskId: string): void {
    getDb(this.dataDir).prepare(`
      UPDATE tasks SET status = 'cancelled', completed_at = ?
      WHERE id = ? AND status IN ('pending','queued','running','retrying')
    `).run(new Date().toISOString(), taskId);
  }

  get(taskId: string): Task | null {
    const row = getDb(this.dataDir).prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
    return row ? this.rowToTask(row) : null;
  }

  listByBot(botId: string, limit = 100): Task[] {
    const rows = getDb(this.dataDir).prepare(`
      SELECT * FROM tasks WHERE bot_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(botId, limit) as any[];
    return rows.map(r => this.rowToTask(r));
  }

  countByStatus(): Record<string, number> {
    const rows = getDb(this.dataDir).prepare(`
      SELECT status, COUNT(*) as cnt FROM tasks GROUP BY status
    `).all() as { status: string; cnt: number }[];
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = r.cnt;
    return out;
  }

  private rowToTask(row: any): Task {
    return {
      id: row.id,
      botId: row.bot_id,
      type: row.type,
      name: row.name,
      payload: row.payload ? JSON.parse(row.payload) : {},
      status: row.status as TaskStatus,
      priority: row.priority,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      createdAt: row.created_at,
      scheduledAt: row.scheduled_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      result: row.result ? JSON.parse(row.result) : undefined,
      error: row.error,
      parentTaskId: row.parent_task_id,
      workflowId: row.workflow_id,
      checkpoint: row.checkpoint,
      timeoutMs: row.timeout_ms,
    };
  }
}
