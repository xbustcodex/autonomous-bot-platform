# Autonomous Bot Platform

**The bot is the machine. AI is an optional tool.**

A production-oriented platform for creating, managing, executing and monitoring independent **programmable software bots**. The core runtime operates fully without any AI language model.

## Principles

- Creating a bot instantiates a genuine programmable worker with its own config and state — **not** an AI agent.
- Default execution mode is `programmed` (deterministic, zero inference).
- AI is optional, disabled by default, and never required for core operation.
- Platform remains fully operational when every AI provider is disconnected.

## Features

- Native execution engine (event-driven, scheduled, queues, retries, checkpointing)
- Independent software workers with persistent state (SQLite)
- Bot factory + functional templates (counter, research, website monitor, data processor, coordinator, …)
- Persistent task queue with priority, delay, exponential backoff, duplicate prevention
- Native supervisor (health, recovery, emergency stop, audit)
- Optional AI gateway (provider-agnostic, free-only preference, rate limits)
- MCP server tool surface for external AI systems
- REST API + minimal dark dashboard
- Acceptance test harness targeting 10 bots / 1000 programmed tasks

## Quick start

```bash
npm install
cp .env.example .env
npx tsx src/index.ts
```

- Dashboard: http://127.0.0.1:3847
- Health: http://127.0.0.1:3847/health
- WebSocket: ws://127.0.0.1:3847/ws

## Acceptance tests (AI disabled)

```bash
npx tsx scripts/acceptance-test.ts
```

Creates 10 independent bots, runs 1000 programmed tasks, verifies persistence, scheduling, emergency stop, duplicate prevention, and more.

## Architecture

```
Control Plane (Web)
        │
Bot Controller / API
        │
┌───────┬───────────────┐
│ Execution     │ Task Queues  │ Optional AI
│ Engine        │ (SQLite)     │ Gateway
└───────┴───────────────┘
        │
   Bot Workers (independent)
```

See `src/core/types.ts`, `FINAL_REPORT.md`, and `PROGRESS.md` for details.

## Project layout

- `src/core/` — runtime, executor, supervisor, queue, types
- `src/bots/` — factory, templates, workers
- `src/storage/` — SQLite layer
- `src/tools/` — tool registry
- `src/providers/` — optional AI gateway
- `src/mcp/` — MCP client/server surfaces
- `scripts/acceptance-test.ts` — mandatory acceptance suite

## Status

Core programmable runtime, queue, supervisor, factory, templates, API, optional AI gate, and MCP tool surface are implemented in source. See `FINAL_REPORT.md` for verification status and remaining work.

## License

MIT
