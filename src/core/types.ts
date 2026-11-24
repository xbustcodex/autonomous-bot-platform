/**
 * Core types for Autonomous Bot Platform.
 * Bots are independent programmable software workers.
 * AI is optional and never required for basic operation.
 */

export type UUID = string;

export type BotStatus =
  | 'created'
  | 'idle'
  | 'running'
  | 'paused'
  | 'error'
  | 'stopped'
  | 'terminated';

export type TaskStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'retrying'
  | 'timed_out';

export type ExecutionMode =
  | 'programmed'
  | 'programmed_with_ai'
  | 'ai_assisted'
  | 'ai_driven';

export interface BotConfig {
  id: UUID;
  name: string;
  description: string;
  purpose: string;
  objectives: string[];
  templateId?: string;
  mode: ExecutionMode;
  tools: string[];
  rules: Rule[];
  triggers: Trigger[];
  schedule?: ScheduleConfig;
  permissions: PermissionSet;
  resourceLimits: ResourceLimits;
  memory: MemoryConfig;
  ai?: AIConfig;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface Rule {
  id: string;
  name: string;
  condition: string;
  action: string;
  priority: number;
  enabled: boolean;
}

export interface Trigger {
  id: string;
  type: 'schedule' | 'event' | 'webhook' | 'manual' | 'bot_message';
  config: Record<string, unknown>;
  enabled: boolean;
}

export interface ScheduleConfig {
  cron?: string;
  rrule?: string;
  timezone?: string;
  enabled: boolean;
}

export interface PermissionSet {
  filesystem: { read: string[]; write: string[] };
  network: { allow: string[]; deny: string[] };
  shell: boolean;
  browser: boolean;
  canDelegate: boolean;
  canCreateBots: boolean;
  maxConcurrentTasks: number;
  requiresApproval: string[];
}

export interface ResourceLimits {
  maxCpuPercent?: number;
  maxMemoryMb?: number;
  maxTaskDurationMs: number;
  maxRetries: number;
  maxTasksPerHour: number;
}

export interface MemoryConfig {
  private: boolean;
  sharedNamespaces: string[];
  maxEntries: number;
  persist: boolean;
}

export interface AIConfig {
  enabled: boolean;
  provider?: string;
  model?: string;
  maxTokensPerTask?: number;
  budgetDaily?: number;
  freeOnly: boolean;
}

export interface BotRuntimeState {
  botId: UUID;
  status: BotStatus;
  currentTaskId?: UUID;
  lastHeartbeat: string;
  restartCount: number;
  metrics: BotMetrics;
  checkpoint?: string;
}

export interface BotMetrics {
  tasksCompleted: number;
  tasksFailed: number;
  totalRuntimeMs: number;
  aiInferences: number;
  lastError?: string;
}

export interface Task {
  id: UUID;
  botId: UUID;
  type: string;
  name: string;
  payload: Record<string, unknown>;
  status: TaskStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  scheduledAt?: string;
  startedAt?: string;
  completedAt?: string;
  result?: unknown;
  error?: string;
  parentTaskId?: UUID;
  workflowId?: UUID;
  checkpoint?: string;
  timeoutMs: number;
}

export interface WorkflowDefinition {
  id: UUID;
  name: string;
  description: string;
  version: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  variables: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowNode {
  id: string;
  type: 'trigger' | 'action' | 'condition' | 'loop' | 'parallel' | 'ai' | 'approval' | 'subworkflow';
  label: string;
  config: Record<string, unknown>;
  position?: { x: number; y: number };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  condition?: string;
  label?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  permissions: string[];
  timeoutMs: number;
  handler: string;
}

export interface AuditEntry {
  id: UUID;
  timestamp: string;
  actor: string;
  action: string;
  resource: string;
  details: Record<string, unknown>;
  success: boolean;
}

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'emergency_stop';
  bots: { total: number; running: number; error: number };
  tasks: { pending: number; running: number; failed: number };
  queueDepth: number;
  uptimeMs: number;
  aiEnabled: boolean;
  mcpEnabled: boolean;
  lastCheck: string;
}

export interface PlatformConfig {
  port: number;
  host: string;
  dataDir: string;
  logLevel: string;
  aiEnabled: boolean;
  aiFreeOnly: boolean;
  mcpEnabled: boolean;
  mcpPort: number;
  emergencyStop: boolean;
  maxConcurrentBots: number;
  maxTasksPerBot: number;
  defaultTaskTimeoutMs: number;
}
