# Evidence Engine

**An MCP server that shows its reasoning — not just its answers.** Every tool
call returns a recommendation *plus* the weighted evidence trail that produced
it, so you can see *why*, not just *what*.

First tool: **Night Window** (`plan_shoot_window`) — an astrophotography shoot
planner that reasons across cloud cover, moon phase, and light pollution, and
surfaces the evidence behind every recommendation.

## Demo

**Live:** https://evidence-engine.fly.dev  ·  Try a location, watch the evidence
ledger explain the call.

```jsonc
// plan_shoot_window({ location: "Death Valley", target: "milky_way" }) →
{
  "recommendation": {
    "best_window": "2026-07-14, 11:00PM–2:00AM",
    "confidence": "high",
    "summary": "Strong milky way conditions: the factors align, led by cloud cover (2% average during dark hours)."
  },
  "evidence": [
    { "factor": "moon_phase",   "value": "new moon, 0% illumination, up 12% of dark hours", "weight": "high",   "source": "calculated",     "score": 0.98, "dominant": false },
    { "factor": "cloud_cover",  "value": "2% average during dark hours on the best night",   "weight": "high",   "source": "open-meteo",     "score": 0.98, "dominant": true  },
    { "factor": "bortle_class", "value": "2 (truly dark site) — nearest reference: Death Valley, 6 km away", "weight": "medium", "source": "static dataset", "score": 0.89 }
  ]
}
```

## Architecture — three consumers, one core

```
core/         — pure TS reasoning engine, no transport logic. The actual product.
mcp-server/   — thin MCP SDK wrapper (Streamable HTTP) over /core
demo-client/  — thin web UI, same /core logic via plain REST
evals/        — scenario harness, runs against /core directly
```

The MCP protocol is a *transport*, not the product. Keeping `/core`
transport-agnostic means the same engine is reachable two ways — as a real MCP
server (add it to Claude Desktop/Code as a remote connector) and as a plain web
demo (no MCP client required) — with the evals exercising that engine directly,
no transport in the loop.

## Technical decisions

- **Evidence over authority.** The output is the weighted evidence trail, not a
  black-box verdict. Each factor carries its sub-score, weight, and source, and
  the trail flags the one factor that most *drove* — or most *capped* — the
  recommendation.
- **A blocking-cap on top of the weighted score.** A plain weighted sum can hide
  one catastrophic factor behind two good ones (clear skies + new moon read as a
  confident Milky Way shoot even in Manhattan). Any factor scoring below a
  threshold caps confidence — to `low` if it carries high weight for the target,
  `medium` if medium. See `core/engine.ts`.
- **Moon phase is calculated, not fetched** (truncated Meeus series in
  `core/astronomy/`) — you can't order a full moon from an API. It's unit-tested
  against known 2026 new/full moon dates.
- **Light pollution is a static curated dataset** (`core/data/bortle-sites.csv`),
  the one deliberate simplification — nearest-match Bortle class over known
  dark-sky sites and metros. A live VIIRS-based lookup is the obvious next step,
  cut from this build on purpose rather than half-built.
- **Graceful degradation.** If the weather API fails after retries, the engine
  still recommends on moon + light pollution alone and flags the reduced
  confidence, rather than erroring out.
- **Production-minded:** request timeouts + retry with backoff, per-IP rate
  limiting on both endpoints, and one structured JSON log line per tool call
  (request id, inputs, latency, per-source success/fail, confidence).

## Evals

`npm run evals` runs the engine against fixed scenarios that inject fixture
weather / geocoding / Bortle class (moon phase stays real, anchored to actual
2026 lunar dates) and checks the reasoning lands the right confidence and flags
the right dominant/blocking factor:

| Scenario | Expected |
|---|---|
| Full moon, clear skies — Milky Way | `low`, moon is the blocking factor |
| Full moon, clear skies — Moon target | `high`, same night flips to ideal |
| New moon, heavy cloud — Milky Way | `low`, cloud cover is blocking |
| New moon, clear, dark site — Milky Way | `high`, all factors aligned |
| Urban Bortle 8, otherwise perfect | `medium`, light pollution flagged regardless |

## Run it locally

```bash
npm install
npm start          # serves demo + REST + MCP on http://localhost:8787
npm test           # moon-math unit tests
npm run evals      # reasoning eval report
npm run typecheck
```

Endpoints:
- `GET  /` — demo web client
- `POST /api/plan` — REST, body `{ "location": "...", "target": "...", "date_range": "..." }`
- `ALL  /mcp` — Streamable HTTP MCP endpoint

## Connect it as a remote MCP server

**Claude Code (CLI):**

```bash
claude mcp add --transport http evidence-engine https://evidence-engine.fly.dev/mcp
```

**Claude Desktop** — add to your MCP config (Settings → Developer → Edit Config):

```jsonc
{
  "mcpServers": {
    "evidence-engine": {
      "type": "streamable-http",
      "url": "https://evidence-engine.fly.dev/mcp"
    }
  }
}
```

Then ask Claude to plan a shoot window for a location — it calls the tool and
gets back the recommendation plus the full evidence trail.

## Deploy

Runs on Fly.io, scale-to-zero (boots on demand, ~$0 while idle). Full rationale,
cost model, and the deploy runbook live in [`docs/deploy-notes.md`](docs/deploy-notes.md).

```bash
fly deploy         # build image, boot the machine, live URL
fly logs           # stream the structured tool-call logs
```
