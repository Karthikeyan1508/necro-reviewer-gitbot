# NecroReview — Demo Runbook

> One page. Every command, every talking point, every fallback. Read this once before demo day.

**Pitch (10 seconds):**
> "Storybook's best reviewers left. Their knowledge left with them. NecroReview brings them back — as bots that review PRs in their voice, cite their past decisions, and predict what they would have caught. And it brings back one more ghost: Future You, the version of you who already fixed this bug."

## Stack & ports

| Thing | Port | How to check |
|-------|------|--------------|
| GitBot HQ | 3000 | `curl localhost:3000/bots` |
| NecroReview bridge | 4001 | `curl localhost:4001/health` → `"mode":"live"` |
| Control-room UI | 4000 | open `http://localhost:4000` |

## Pre-demo checklist (5 minutes)

```bash
# 1. Confirm services are listening
netstat -ano | findstr /R "3000 4000 4001"        # Windows

# 2. Start GitBot (the "backstage"), from the repo checkout you review with
gitbot start -p 3000

# 3. Register the ghost bots (idempotent; marks each `setup: complete`)
cd "C:\Users\This PC\gitbot-hackathon"
npm run bots

# 4. Start the bridge + UI
npm run start       # or npm run dev:bridge
npm run dev:ui      # another terminal
```

Verify: `curl localhost:4001/health` → `{"status":"ok","mode":"live","gitbotHealthy":true}`,
and `http://localhost:4000` renders the dashboard.

## Demo script (~6 minutes)

1. **Overview (0:30)**
   Say: *"Six ghosts, five resurrected from Storybook's real review history, one synthetic — Future You, built from 37 real fix/revert commits."*
   Metrics shown: personas, fix-index patterns (108), Hall of Fame runs.

2. **Summon the council (1:30)**
   Review tab → *Summon council*. Ghosts join one by one and stream real findings against
   **PR #36417** (`Core: Build preview navigator with DOM APIs instead of innerHTML`, bundled diff).
   Talking point: each ghost runs as a live Codex agent in `plan` mode — read-only, quoted history, JSON finding block parsed into the feed.

3. **Verdict (0:30)**
   Council tally → `APPROVED` / `REQUEST_CHANGES` / `BLOCKED` (one `block` vetoes). Future You cites the exact fix commit (`fc9d47c`) when it flags a repeated pattern.

4. **Séance (1:00)**
   Pick a ghost, ask *"Why did we choose this pattern?"* — it answers from its own archived review comments, citations included.

5. **Hall of Fame (0:30)**
   Leaderboard with resurrections, findings, accuracy. *"Every run updates the board — it just counted this one."*

Total live path **measured at ~2–3 minutes** for all six ghosts (well under the 8-minute budget).

## Fallbacks

| If… | Do… |
|-----|-----|
| GitBot is not running / unreachable | Nothing. The bridge reports `mode: offline-fallback` and reviews run on the deterministic ghost brain. Demo proceeds identically (`/api/review` returns findings + verdict). Optionally `NRR_MODE=offline` to pin it. |
| A live Codex session stalls or errors | The bridge falls back per-ghost/offline. Check `codex auth status` if every session fails. |
| UI won't load on :4000 | Tail the Vite log; restart with `npm run dev:ui`. Confirm nothing else already holds 4000. |
| Diff/PR missing | It's bundled at `data/fixtures/pr-36417.diff` (alias `demo-pr.diff`, 164 lines). Re-export with `gh pr diff 36417 --repo storybookjs/storybook > data/fixtures/pr-36417.diff`. |
| No network at all | Everything runs locally: bundled fixture + personas + index; `NRR_MODE=offline` for guaranteed consistency. |
| Hall of Fame looks empty | Run one review; it persists to `data/hall-of-fame.json` immediately. |

## 30-second sanity commands

```bash
curl -s localhost:4001/health
curl -s localhost:4001/api/ghosts | jq length          # 6
curl -s localhost:4001/api/fix-index | jq .totalFixCommits   # 108 patterns
curl -s localhost:4001/api/pr | jq .meta.number         # 36417
curl -s -X POST localhost:4001/api/review -H "Content-Type: application/json" -d '{}' | jq .verdict
```