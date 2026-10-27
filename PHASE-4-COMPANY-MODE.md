# Phase 4 brief: Company Mode (Sprints 1-5 of the 12-sprint roadmap)

Product owner, 26 Oct 2026: The AI Squad grows into an "Automation AI Company". Departments (software house,
sales and CRM, digital marketing, legal drafting) work together; agents keep one identity across projects without
mixing their contexts; the number of agents running at once follows the machine's CPU, memory and plan quota;
teams can work in shifts (marketing at night). Sopwer uses it first; the project is open source (Apache-2.0).
The full roadmap (12 sprints) lives in the product docs; these are the first five. One minor release per sprint,
same rules as always (SPEC.md, CLAUDE.md).

Principles that bind every sprint:

1. One session = one agent x one Space x one task. Context is re-read from files, never carried in a long session.
2. Context lives in files and git, not in processes: that is what makes backups, moving and several machines work.
3. Every way in (UI, chat, Telegram later, Autopilot) goes through the same API and the same hard-stop list.
4. Agents wake on events, not on a model polling a timer. Routing and checks run in code, without a model.
5. Legal, finance and personal data are for the Owner only.
6. Configuration is code: every change is versioned, has a diff, records who made it and can be rolled back.

## Sprint 1 (0.10.0): foundation and safety

- Apache-2.0 everywhere (LICENSE, NOTICE, manifests, `SPDX-License-Identifier` in every source file), SECURITY.md
  (threat model, private reporting), CONTRIBUTING.md (DCO), docs/BILLING.md (subscription or API key, from the
  official pages).
- `~/.aisquad/schema.json` and ordered migrations at server start, after a safety backup.
- `aisquad backup | verify | restore | doctor`: one archive (tar.gz, AES-256-GCM when a passphrase is given) with
  ~/.aisquad minus caches and machine state, each Floor's configuration, Claude Code's auto memory per Floor and a
  manifest (sha256 per file; remote, branch, commit and uncommitted changes per Floor). Restore relinks paths,
  clones missing repositories, keeps the old home, and runs doctor. Nightly backups with a monthly read-back.
- RAM and CPU per agent session (its process tree), averages and peaks in ~/.aisquad/usage.json.
- A maximum of agents at once for the whole machine, next to each Floor's.

## Sprint 2 (0.11.0): Runner v2

- A `Runner` interface. `tmux` (today's interactive sessions, statuses from hooks and transcripts) and `headless`
  (`claude -p --output-format stream-json`): structured events, session id, cost, `--max-budget-usd`, no screen
  parsing. Background work (jobs) runs headless.
- Jobs: queued, running, done, failed; their output, cost and session are kept; the Desk shows them.
- Auth mode (Building setting): `subscription` or `api-key` for background runs; the key is write-only, kept in
  secrets.json, passed as an environment variable to headless runs only.

## Sprint 3 (0.12.0): Spaces, context layers, Admin

- A Floor is a **Space** (the code keeps the word Floor): `kind` (department | project), `shift`, `node`, `access`
  (team | owner) and `memory` (repo | claude).
- Context layers: L0 Company Brain (a folder of SOPs, brand, prices, templates; read-only for agents; legal,
  finance and pricing only for Owner Spaces), L1 the agent's identity (Role Template; agents may not write their
  own templates, `~/.claude/CLAUDE.md` or `~/.aisquad`), L2 the Space (repository, `docs/memory` for auto memory),
  L3 the session.
- Admin Panel v1: Spaces, Agents across Spaces, Skills, Company Brain, Change history with diff and rollback for
  every configuration change made through The AI Squad.

## Sprint 4 (0.13.0): dispatcher and shifts

- One pool of slots for the machine: min(Building maximum, (free RAM - 2 GB) / RAM per session, CPUs x 0.75,
  quota slots). Queue P0 (the owner waits) > P1 (handoffs, urgent events) > P2 (shifts) > P3 (audits); aging one
  class per 30 minutes.
- Shifts per Space (days, from, to); outside its shift a Space's automated work waits. A daytime reserve for P0.
- Idle agents stop after N minutes (never with an open question, report or command), resumable.
- Quota guard: cost in the last 5 hours and 7 days against limits the owner sets; limit messages seen in
  transcripts pause automated work until the reset.
- Every start (Desk, Autopilot, lead, auto-resume, next sprint) goes through the dispatcher: when no slot is free
  the work waits in the queue instead of "start anyway".

## Sprint 5 (0.14.0): people and direct chat

- People: Owner, Member, Viewer, each with a PIN. The old PIN is the Owner's. Viewers read; Members change
  Spaces; Owners also manage people, secrets, backups, the dispatcher and Owner Spaces.
- Chat with any agent: a thread per agent and Space, kept in the Space (`docs/squad/chats/<agent>.jsonl`), so it
  travels with git and backups. A context picker (this Space, or General: only L0 and L1, in a neutral folder) so
  the same agent never mixes clients. A message is a P0 task; the agent's reply, its questions and permission
  prompts appear in the thread. A message to a squad member is noted for the lead.

## Decisions taken with the safest default (confirm or correct)

- The word in code stays Floor; Space is the concept (kind, shift, node, access). The UI says Floor until the
  office view (Sprint 8).
- Roles: Owner, Member, Viewer.
- A direct message to a squad member informs the lead; the lead does not approve it first.
- Unattended backups are encrypted only with a saved passphrase; otherwise they are plain and without secrets.
