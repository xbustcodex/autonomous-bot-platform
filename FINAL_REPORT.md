# Autonomous Bot Platform — Final Development Report

**Project directory:** local `AutonomousBotPlatform`

**Repo:** https://github.com/xbustcodex/autonomous-bot-platform

## Implemented architecture

- Strict separation: Bot (programmable worker) ≠ AI agent ≠ AI model ≠ Controller
- Default mode: `programmed` (no AI required)
- SQLite primary store
- Persistent task queue with priority, delay, retry, duplicate prevention
- Native executor with handlers, checkpoint hooks, timeouts
- Bot factory + registry; creating a bot does not create an AI agent
- Functional templates with real handlers
- Native supervisor: health, emergency stop, audit
- Optional AI gateway (disabled by default)
- MCP server tool surface
- Tool registry with permission checks
- REST API + minimal dark dashboard
- Acceptance test script

## Launch

```bash
npm install
cp .env.example .env
npx tsx src/index.ts
```

Dashboard: http://127.0.0.1:3847

## Status

Core programmable foundation is in source. See README and PROGRESS for details. Runtime verification depends on successful `npm install` on a Node ≥20 host.

**Readiness: PARTIAL** — production claim not made until acceptance suite runs green.
