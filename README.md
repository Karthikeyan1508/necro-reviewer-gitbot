# NecroReview 👻

**Resurrect a repository's best reviewers as ghost bots, and let them review new PRs in their own voice.**

NecroReview mines a repo's real review history, shapes the top reviewers into *ghosts* (personas with their tone, priorities, and verbatim past comments), and runs them as live coding agents through [GitBot HQ](https://github.com) — or through a deterministic offline brain when no agent is available. Their findings are collected into a council verdict, ranked on a Hall of Fame, and surfaced in a control-room UI.

```
        ┌──────────────┐    gh CLI     ┌──────────────────┐
        │  fetch-github │ ────────────▶ │ review comments, │
        │  -data.ts     │               │ commits, PR diff │
        └──────┬───────┘               └─────────┬────────┘
               ▼                                 ▼
        ┌──────────────┐              ┌──────────────────┐
        │ build ghosts │              │  build-fix-index │
        │  (persona)   │              │   (fix patterns) │
        └──────┬───────┘              └─────────┬────────┘
               ▼                                 ▼
        ┌──────────────┐                        │
        │ provision-   │  POST /bots   ┌────────▼────────┐
        │ ghosts.ts    │ ────────────▶ │    GitBot HQ    │
        └──────┬───────┘               │ (codex/claude)  │
               │                       └────────┬────────┘
               ▼                                │  POST /chat (thread)
        ┌───────────────────────────────────────▼────────┐
        │            Bridge (Express + Socket.IO)        │
        │   POST /api/review -> create thread -> run      │
        │   ghosts -> council verdict -> Hall of Fame     │
        └───────────────────────┬────────────────────────┘
                                ▼
                       Control room UI (port 4000)
```

## What it does

- **Resurrect reviewers** — pull real PR review comments and commits, rank reviewers, and build one ghost per top reviewer (AriPerkkio, JReinhold, kasperpeulen, ndelangen, valentinpalkovic…) plus a synthetic **Ghost of Future You** that speaks from fix-pattern history.
- **Review like them** — each ghost runs in `plan` permission mode with read-only tools, reviews the PR diff, and files a finding with a file/line anchor, severity, vote, and confidence.
- **Render a verdict** — the council converts findings into `APPROVED` / `REQUEST_CHANGES` / `BLOCKED` (one `block` vetoes).
- **Remember and rank** — every run updates the Hall of Fame: resurrections, findings, votes, bug predictions, accuracy.
- **Séance** — ask any ghost a question; it answers from its own archived review comments with citations.

## Setup

Requires **Node ≥ 20** and, for live mode, a [GitBot HQ](https://github.com) install plus one agent (`claude-code`, `codex`, or `opencode`) that is authenticated.

```bash
# 1. Install workspace dependencies
npm install

# 2. Build the data: fetch repo history, derive the ghost personas, index fix patterns
npm run bootstrap

# 3. (Optional) re-fetch the demo PR diff explicitly
npm run data -- --pr=36417
```

Configuration lives in `.env` (copy from `.env.example`). The repository ships a **bundled offline demo**: real Storybook PR **#36417** (`Core: Build preview navigator with DOM APIs instead of innerHTML`) with its diff at `data/fixtures/pr-36417.diff`, so the demo runs with **zero network and zero tokens**.

## Run

```bash
# Start GitBot HQ (live mode) — http://localhost:3000
gitbot start -p 3000        # or however you run GitBot

# Register the ghosts as bots guarded by the machine-setup gate
npm run bots

# Start the bridge (the "stage") — http://localhost:4001/health
npm run start               # or: npm run dev:bridge

# Start the control room UI — http://localhost:4000
npm run dev:ui
```

Open **http://localhost:4000**, press **Summon council**, and watch the ghosts review PR #36417.

### Modes

| Mode | How | When |
|------|-----|------|
| `offline` | Deterministic ghost brain (`NRR_MODE=offline`) | No network / no agent login |
| `live` | Real Codex/Claude Code sessions through GitBot HQ | Agent authenticated, GitBot running |
| *(unset)* | Try live, fall back to offline automatically | Default |

## Bridge API

| Endpoint | Returns |
|----------|---------|
| `GET  /health` | `{ status, mode: live\|offline-fallback, gitbotHealthy }` |
| `GET  /api/ghosts` | All resurrected personas |
| `GET  /api/pr` | Demo PR metadata + diff |
| `GET  /api/fix-index` | Fix-pattern index stats |
| `GET  /api/hall-of-fame` | Leaderboard |
| `POST /api/review` | Runs the council; returns findings + verdict |
| `POST /api/seance` | Asks one ghost a question (`{ ghostId, question }`) |

## Demo run-through (under 8 minutes)

1. `npm run dev:ui` → open `http://localhost:4000`
2. Review room → **Summon council** (live or offline)
3. Ghosts stream findings as they review the bundled PR #36417 diff
4. Council verdict appears
5. **Séance** tab → pick a ghost, ask a question, watch it answer from its own history
6. **Hall of Fame** tab → refreshed leaderboard with the run just performed

## Data layout

```
data/
  raw/        review-comments.json · commits.json · pr-meta.json · pr-<n>.diff
  fixtures/   demo-pr.diff (bundled offline PR #36417 diff)
  personas/   ghost-<id>.json · manifest.json
  index/      fix-index.json
  hall-of-fame.json
```

## Verified live end-to-end

- Typecheck passes for `core`, `bridge`, `ui`; **87/87** core unit tests pass.
- `npm run bots` registers all 6 ghosts with GitBot, each marked `setup: complete`.
- `POST /api/review` returns `mode: "live"` with findings produced by real Codex sessions (each with a live session id), a `REQUEST_CHANGES` council verdict, and a Hall of Fame run persisted (`data/hall-of-fame.json`).