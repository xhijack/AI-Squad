---
name: server-health
description: "Check a server's health and our app's impact on it: disk, memory, swap, CPU, our containers' resource use and error logs, and whether neighbouring apps suffer. Read-only. Use as DevOps after a deploy, when something is slow, and on a schedule the lead asks for."
---
# Server health (read-only)

## Check
1. **Machine:** `uptime` (load vs `nproc`), `free -m` (available RAM, swap used), `df -h -x tmpfs -x devtmpfs` (any disk above 85 %), `df -i` on the data disk.
2. **Our app:** `docker compose -p <app>-<env> ps`, `docker stats --no-stream` for our containers (memory against their limits, restarts), `docker compose -p <app>-<env> logs --since 1h` for errors and stack traces.
3. **Neighbours:** the other containers' status and memory from `docker stats --no-stream` (read only), and the kernel log for out of memory kills: `journalctl -k --since -1h | grep -i -E 'out of memory|oom'` (ask the owner if it needs sudo).
4. **Trend:** compare with the last report in `docs/ops/HEALTH-<host>.md`.

## Judge
- **Our impact:** do our containers grow towards their limits, restart, or push the machine into swap?
- **Risk to neighbours:** low free memory, high swap, a full disk or OOM kills while our app runs.
- **Errors:** new error types since the last deploy.

## Act
- Our side only: lower our own memory use, fix our own logs or crash loops through the normal work flow (a task for a developer, or a rollback with **git-deploy** if the last deploy caused it).
- Anything about other apps or the machine (disk cleanup, swap, upgrades): report to the owner with numbers; never change it yourself (see **docker-ops**).

## Report
Append to `docs/ops/HEALTH-<host>.md`: date, the numbers, our impact, risks, and what you recommend. Tell the lead (or the owner) the one-line verdict.
