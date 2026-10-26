---
name: canary
description: "Watch a fresh deploy for a set window: health checks, error rate and latency against the numbers before the deploy. On staging, roll back by itself when a threshold is crossed; on production, ask the owner before rolling back. Use as DevOps right after every staging or production deploy."
---
# Canary after a deploy

A deploy is not done when the containers start. Watch it, compare it with before, and undo it if it is worse.

## Before the deploy: the baseline
Write down, for the last 15 minutes before the deploy (from logs, the health URL, or the app's metrics):
- health URL status (expected 200) and its response time (median and the slowest of 20 calls),
- error rate: 5xx responses or error log lines per minute (`docker compose -p <app>-<env> logs --since 15m | grep -ciE 'error|exception'`),
- memory of our containers (`docker stats --no-stream`).

## The window
- Staging: 10 minutes. Production: 30 minutes (or what `docs/ENVIRONMENTS.md` says).
- Every minute: call the health URL a few times, count new errors, note the response time and our containers' memory.

## Thresholds (unless `docs/ENVIRONMENTS.md` sets others)
- The health URL fails twice in a row.
- Error rate above twice the baseline, and at least 5 errors per minute.
- Median response time above twice the baseline.
- A container restarts, or memory grows towards its limit (above 90 %).

## When a threshold is crossed
- **Staging:** roll back at once to the previous tag with the **git-deploy** rollback steps, then check health again, and report to the lead what crossed which threshold.
- **Production:** do not roll back on your own. Ask the owner with AskUserQuestion ("Roll back production to <previous tag>? (Recommended)" / "Keep watching" / "I will handle it"), with the numbers in the question. This is critical: never decide it yourself, also under Autopilot.

## Report
Append to `docs/ops/DEPLOYS.md`: date, environment, tag, baseline and window numbers, verdict (kept or rolled back) and why.
