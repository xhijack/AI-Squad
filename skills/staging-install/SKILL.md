---
name: staging-install
description: "Plan how to install the squad's app as a staging (or production) environment on a server that may be shared with other apps: its own compose project and network, ports from the free ranges, memory limits, a read-only deploy key, and a list of what needs the owner (sudo, reverse proxy, DNS). The plan needs the owner's approval with AskUserQuestion before anything on the server changes. Use as DevOps after server-discovery."
---
# Staging install on a shared server

Start from `docs/ops/SERVER-<host>.md` (run the **server-discovery** skill first if it is missing or older than a week).

## The plan: docs/ops/INSTALL-<env>-<host>.md
1. **Isolation:** a compose project named after the app and environment (`<app>-staging`), its own network (`<app>-staging-net`), container names and volume names with the same prefix. Nothing joins another app's network.
2. **Ports:** taken from the free ranges in the discovery file, bound to `127.0.0.1` when a reverse proxy sits in front. List each port and why.
3. **Resources:** `mem_limit` / `deploy.resources.limits.memory` and `cpus` for every container, sized from the free RAM and swap in the discovery file, with room for the neighbours. Restart policy `unless-stopped`.
4. **Code:** the server pulls a git tag over a **read-only deploy key** (see **git-deploy**). The owner adds the public key to the repository; you never need their account.
5. **Variables:** names only, from `.env.example`. The owner puts the values into the server's env file; you never see or write them.
6. **Data:** where volumes live, how they are backed up, and that no existing volume is reused.
7. **Needs the owner:** every step that needs sudo or an account: reverse proxy block (paste the exact block for them), DNS records, firewall, TLS, the deploy key, the env file values, Docker group membership.
8. **Rollback and removal:** how to stop and remove only our project (`docker compose -p <app>-staging down`), never others.

## Approval
- Ask the owner with **AskUserQuestion**: "Approve this install plan for <host>?" with options such as "Approve (Recommended)", "Change something", "Not now", and the plan file path in the question. This is a critical decision: never decide it yourself, also under Autopilot.
- Until the owner approves, change nothing on the server.

## After approval
Run only the steps in the approved plan, in order, and stop at the first surprise (a port taken, a name in use, low memory): report it instead of working around it. Write what you did and the result in the plan file.
