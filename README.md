# Evidence Engine

A real, working MCP server that shows its reasoning — not just its answers.

First tool: **Night Window** (`plan_shoot_window`), an astrophotography shoot planner that reasons across weather, moon phase, and light pollution, and surfaces the weighted evidence behind every recommendation.

> 🚧 Under active construction — full README (architecture, demo, technical decisions) lands with the first release.

## Layout

```
core/         — pure TS reasoning engine, no transport logic
mcp-server/   — thin MCP SDK wrapper (Streamable HTTP)
demo-client/  — thin web UI, same core logic via REST
evals/        — scenario runner + pass/fail scoring
docs/         — architecture notes, demo GIF
```
