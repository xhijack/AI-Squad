---
name: docker-ops
description: "Safe Docker and Docker Compose work on a server or machine shared with other apps: operate only the squad's own compose project, containers, networks and volumes. Use as DevOps whenever you run docker or docker compose commands outside your own laptop."
---
# Docker operations (only our own)

## Always
- Address our app through its compose project: `docker compose -p <app>-<env> ...` (or `-f` with our compose file). Look up the project name in `docs/ops/INSTALL-*.md`.
- Before any command that changes something, list what it will touch (`docker compose -p <app>-<env> ps`) and check every name carries our prefix.
- Logs and stats of our containers are fine any time: `docker compose -p <app>-<env> logs --tail 200 <service>`, `docker stats --no-stream`.

## Never
- `docker system prune`, `docker image prune -a`, `docker volume prune`, `docker network prune`, `docker builder prune --all` on a shared machine: they remove other apps' data and images.
- `docker rm`, `docker stop`, `docker restart`, `docker volume rm`, `docker network rm` on anything that is not ours.
- Joining another app's network, mounting another app's volume, or editing another app's compose file.
- `docker exec` into containers that are not ours.

## Cleaning up our own
- Old images of our app only: `docker image ls <our-image>` then remove specific tags by name, keeping the current and the previous release (for rollback).
- Our build cache: `docker builder prune --filter until=168h` only on a machine that is ours alone; otherwise ask the owner.
- Removing our environment completely (`docker compose -p <app>-<env> down -v`) deletes its data: that needs the owner's approval with AskUserQuestion.

## When something else is the problem
If another app's container uses too much memory or disk, do not touch it: report it to the owner with the numbers (see **server-health**).
