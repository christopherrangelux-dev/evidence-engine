# Deploy notes — Evidence Engine on Fly.io

Written as a review *before* deploying (first server setup). Nothing here is
provisioned yet. Read top-to-bottom; the decision points are called out.

---

## 1. Why this even needs a server

Everything else in this workspace (Portfolio, Recipes) is a **static site**:
pre-built HTML/CSS/JS files that GitHub Pages hands out for free. No code runs
— the files just sit there.

Evidence Engine is different. It runs **live Node code on every request**:

- resolve the location (Open-Meteo geocoding)
- fetch the hourly weather forecast (Open-Meteo)
- compute moon phase/altitude, score the nights, build the evidence trail

That code has to be *running somewhere* — a machine that stays on, listens on
a port, and answers requests. GitHub Pages fundamentally can't do that. That's
the whole reason we need a host. This is the first "real server" in the
workspace.

---

## 2. What actually gets provisioned

One small Linux VM ("Machine" in Fly's terms) running our Node process,
reachable at `https://evidence-engine.fly.dev` (or similar). It serves three
routes, all the *same* core engine:

| Route        | Who hits it                                              |
|--------------|---------------------------------------------------------|
| `/`          | The web demo — a recruiter clicks a link, no install    |
| `/api/plan`  | Plain REST — what the demo UI calls under the hood      |
| `/mcp`       | The MCP endpoint — added as a remote connector in Claude Desktop/Code |

**No database, no disk, no volume.** The server holds no state — it fetches
weather fresh each call and computes everything in memory. This matters a lot
for cost (see §4): the thing that keeps costing money on idle cloud servers is
attached storage, and we have none.

Two files make this happen (we write them in Phase 7, not yet):

- **`Dockerfile`** — a recipe that packages the app into a container image:
  "start from Node 20, copy the code in, run `npm install`, launch the
  server." Fly builds this image and runs it. You don't need to understand
  Docker deeply; it's ~10 lines and standard for a Node app.
- **`fly.toml`** — Fly's config: which region, machine size, port, and the
  **auto-stop policy** (the cost lever in §4).

---

## 3. What it costs (current pricing, verified July 2026)

Fly.io **ended its free tier in 2024**. It's now pure pay-as-you-go: you put a
card on file and pay for what you use. There is **no monthly minimum forced on
you** by Fly itself (some third-party writeups say "~$5/mo practical minimum,"
but that assumes always-on apps with storage and traffic — not our case).

Raw rates for the smallest machine:

| Item                                   | Cost                     |
|----------------------------------------|--------------------------|
| `shared-cpu-1x`, 256MB RAM, always-on  | **~$2.02 / month**       |
| `shared-cpu-1x`, 512MB RAM, always-on  | **~$3.32 / month**       |
| Outbound bandwidth (North America)     | **$0.02 / GB**           |
| A **stopped** machine (CPU + RAM)      | **$0.00** (not billed)   |
| Storage volume, per GB, per month      | $0.15 — **we have none** |

Our outbound traffic is tiny (a JSON call to Open-Meteo per request, a small
HTML/JSON response back). At portfolio-demo traffic, bandwidth is effectively
$0. **So the entire cost question reduces to: is the machine running or
stopped?**

---

## 4. The one real decision: auto-stop vs. always-warm

Fly Machines support **auto-stop / auto-start** (`auto_stop_machines` +
`min_machines_running = 0` in `fly.toml`). With it on:

- After ~a few minutes of no traffic, Fly **stops** the machine.
- A stopped machine bills **nothing** for CPU/RAM (and we have no volume, so
  nothing at all).
- The next incoming request **cold-starts** it in ~1–2 seconds, then it serves
  normally.

> Note: an earlier version of Fly's own docs page implied machines don't
> auto-stop by default — that's about the *default*, not the capability.
> Auto-stop is a first-class, supported `fly.toml` setting. We turn it on
> deliberately.

So the two postures:

| Posture                         | `fly.toml`                              | Cost at low traffic | Tradeoff                         |
|---------------------------------|-----------------------------------------|---------------------|----------------------------------|
| **Scale-to-zero** (recommended) | `min_machines_running = 0`, auto-stop   | **~$0–1 / month**   | First visit after idle waits 1–2s |
| **Always-warm**                 | `min_machines_running = 1`, no auto-stop| **~$2 / month**     | No cold-start delay, ever         |

### My recommendation for *this* project

**Start with scale-to-zero.** Reasons:

1. This is a portfolio demo — traffic is bursty and low. Paying to keep a CPU
   warm 24/7 for a page that gets visited a few times a week is the wrong
   default for a first server you're learning on.
2. The cold start is ~1–2s, *once*, and only after real idle. A recruiter
   clicking your link mid-review won't notice; if they linger, the second
   request is instant.
3. It caps your worst case near zero while you learn the platform. You can
   flip to always-warm later by changing one line and redeploying — no
   rebuild, no data migration (there's no data).

The one place cold-start hurts is the **MCP connector** use: if someone wires
`/mcp` into Claude and the first tool call eats a 1–2s spin-up, that's a slightly
janky first impression. But it's one call, and honestly fine for a demo/lab
tool. If this ever becomes something you actively rely on, flip to warm.

**Net: scale-to-zero, 256MB, single machine, one region near you.** Realistic
monthly bill: **pennies to ~$1**, worst-case ~$2 if it ends up busier than
expected.

---

## 5. Spend safety (first-server nerves — reasonable)

The thing to internalize: **there is no runaway-cost path here.** No autoscaling
to many machines, no per-request pricing, no expensive managed database. The
bill is bounded by "one tiny machine's running hours + trivial bandwidth."

Still, belt-and-suspenders:

- **Set a spending / usage alert** in the Fly dashboard (Billing → alerts) —
  e.g. notify me if the month crosses $5. Given the model above, that alert
  should essentially never fire; if it does, something's wrong (a redeploy loop,
  a machine stuck on) and you'll want to know.
- **One machine, one region.** Don't let a config scale `min_machines_running`
  above 1 or add regions unless you decide to.
- **`fly logs` and `fly status`** show exactly what's running at any time. If
  you ever wonder "is something costing me money right now," those answer it.
- Worst realistic case if you deployed it and forgot about it for a year with
  always-on by mistake: ~$24. With scale-to-zero: ~$0. That's the whole risk
  envelope.

---

## 6. What the deploy day actually looks like (Phase 7 preview)

Rough sequence, so there are no surprises when we do it:

1. `brew install flyctl` — Fly's CLI (`fly` / `flyctl`).
2. `fly auth signup` (or `login`) — creates the account, **card on file**.
   This is the step that commits you to the pay-as-you-go relationship.
3. Add `Dockerfile` + `fly.toml` to the repo (I write these; you review).
4. `fly launch --no-deploy` — Fly detects the app, generates config; we edit
   the auto-stop / machine-size settings before anything runs.
5. `fly deploy` — builds the image, boots the machine, gives you a live URL.
6. Smoke-test the three routes; wire `/mcp` into Claude Desktop as the payoff
   demo.
7. Set the billing alert (§5).

Deploys after that are just `fly deploy` (or we can wire a GitHub Action later,
like the SPA projects — optional, not needed to ship).

---

## 7. Decisions locked

- **Posture: scale-to-zero.** `fly.toml` will set `min_machines_running = 0`
  with auto-stop, 256MB `shared-cpu-1x`, single region near the user. Accept the
  1–2s cold start after idle; flip to always-warm later is a one-line change.
- **Billing alert: $5/month** threshold in the Fly dashboard (Billing → alerts),
  set right after the first deploy. Given the cost model it should never fire.
- **Account: user creates the Fly account** (card on file) at deploy time —
  that's the one step that can't be pre-done here. Everything up to
  `fly auth signup` is free to explore.

When ready, Phase 7 = write `Dockerfile` + `fly.toml` (scale-to-zero preset),
then walk the sequence in §6 together, ending with the billing alert.
