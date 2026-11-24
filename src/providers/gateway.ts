/**
 * Optional AI intelligence gateway.
 * Default: disabled. Never auto-switches to paid providers.
 */

export interface ProviderConfig {
  id: string;
  baseUrl: string;
  apiKeyEnv?: string;
  free: boolean;
  models: string[];
}

export class AIGateway {
  private enabled: boolean;
  private freeOnly: boolean;
  private inferenceCount = 0;

  constructor(opts: { enabled?: boolean; freeOnly?: boolean } = {}) {
    this.enabled = opts.enabled ?? false;
    this.freeOnly = opts.freeOnly ?? true;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getInferenceCount(): number {
    return this.inferenceCount;
  }

  async complete(_prompt: string, _opts?: { model?: string }): Promise<string> {
    if (!this.enabled) {
      throw new Error('AI gateway is disabled. Set AI_ENABLED=true to use optional AI.');
    }
    // Placeholder: real providers would be plugged here with rate limits & budgets
    this.inferenceCount += 1;
    return '[AI gateway placeholder — no live provider configured]';
  }

  /** Validate AI output before it can trigger executable actions */
  validateActionProposal(proposal: unknown): { ok: boolean; reason?: string } {
    if (!proposal || typeof proposal !== 'object') {
      return { ok: false, reason: 'invalid proposal' };
    }
    // Enforce that AI cannot bypass permissions — caller must still check bot permissions
    return { ok: true };
  }
}

export const defaultGateway = new AIGateway({
  enabled: process.env.AI_ENABLED === 'true',
  freeOnly: process.env.AI_FREE_ONLY !== 'false',
});
