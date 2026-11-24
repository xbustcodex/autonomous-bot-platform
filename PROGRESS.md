# Autonomous Bot Platform — Implementation Progress

## Status: IN PROGRESS (continuous single-pass build)

### Milestone 1 — Native runtime + persistence
- [x] Project structure
- [ ] package.json + deps
- [ ] tsconfig
- [ ] SQLite schema + storage layer
- [ ] Core types (Bot, Task, Workflow, ExecutionState)
- [ ] Durable queue + executor
- [ ] Basic supervisor
- [ ] Checkpoint / recovery
- [ ] Unit tests for 1000 programmed tasks (AI disabled)

### Milestone 2 — Bot factory, registry, templates
- [ ] Factory
- [ ] Registry
- [ ] Functional templates (research, monitor, browser, etc.)

### Milestone 3 — Supervisor, scheduler, queues
- [ ] Full supervisor
- [ ] Scheduler
- [ ] Event system
- [ ] Bot-to-bot

### Milestone 4 — Tools + workflows
- [ ] Tool registry
- [ ] Workflow engine + visual format
- [ ] Playwright / shell tools

### Milestone 5 — Optional AI gateway
- [ ] Provider abstraction
- [ ] Rate limits / free-only
- [ ] Modes

### Milestone 6 — MCP
- [ ] Client
- [ ] Server + tools

### Milestone 7 — UI
- [ ] Web dashboard
- [ ] Desktop shell

### Milestone 8 — Security + acceptance tests
- [ ] Permissions, audit, emergency stop
- [ ] Full acceptance suite

### Milestone 9 — Packaging
- [ ] After tests pass

## Notes
- AI providers start DISABLED by default.
- Prefer SQLite-backed durable queue (no Redis required for core).
- All bots are programmable workers first.
