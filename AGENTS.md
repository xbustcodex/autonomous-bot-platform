# AGENTS.md

## Core rule

**The bot is the machine. AI is an optional tool.**

- Creating a bot must instantiate a programmable software worker, not an AI persona.
- Default mode is `programmed` (no AI inference).
- AI providers start disabled (`AI_ENABLED=false`).
- Never require an inference request for routine programmed operations.

## Working with this codebase

- Prefer TypeScript + Node.js.
- Persistence: SQLite first (`src/storage/database.ts`).
- Task execution: `src/core/executor` + `src/core/queue`.
- Bot creation: `src/bots/factory/bot-factory.ts`.
- Templates with real handlers: `src/bots/templates/index.ts`.
- Acceptance tests: `scripts/acceptance-test.ts`.

When extending, keep the separation between Bot, optional AI agent, AI model, and Bot Controller.
