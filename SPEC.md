# The AI Squad — Product Spec (MVP)

The AI Squad turns a machine running Claude Code into a 3D **Building**. Every project directory is a **Floor**, every Floor has a **Team** of **Agents**, and the owner forms, runs, and watches those teams from the browser.

Owner: PT Sopwer Teknologi Indonesia. Decisions in this file were made by the product owner on 23 Oct 2026.

## Product decisions

| # | Decision |
|---|---|
| D1 | Product name: **The AI Squad**. Plugin/command name: `aisquad`. |
| D2 | Floor and team configuration live **in the project repo** (shared by the team through git). Personal data and secrets never go in the repo. |
| D3 | Default merge policy: **automatic** (configurable per Floor). Merges are executed by the AI Squad server, never by an agent, and only after the Floor's quality gate passes. The user approves auto-merge once per Floor. |
| D4 | The Squad Sprint workflow (PM + board + QA gate) is **optional**. Default workflow is Free Team. |
| D5 | **All naming is English**: UI text, file names, code identifiers, JSON keys, docs. |
| D6 | Agents are created from **Role Templates** with per-agent **overrides** (template + override inheritance, not plain copy and not live reference). |

## Glossary

| Term | Meaning |
|---|---|
| Building | One AI Squad installation on one machine. |
| Lobby | Overview of all Floors plus everything that needs the human. |
| Floor | One project = one directory = one team. Has a layout. |
| Team | The agents assigned to a Floor. |
| Agent | One Claude Code agent. Has an `id` (kebab-case) and a `displayName` (free text, e.g. "Ramdani - Frappe Developer"). |
| Role Template | Reusable agent definition: model, effort, skills, rules, permissions, prompt, default appearance. Versioned. |
| Desk | Where an agent sits on a Floor. |
| Device | Laptop, dual monitor, whiteboard, printer, plant, etc. placed on a Floor. |
| Layout | Desk/device arrangement. Presets: Rows, Pods, Circle, Open Space. |
| Edit Mode | Mode for arranging desks/devices and agent appearance. |
| Attention | Anything waiting for a human: agent question, permission prompt, stalled team, budget alert. |
| Workflow | `free-team` (default) or `squad-sprint` (optional). |
| Elevator | Floor switcher. |
| Watchdog | Detects stalls, resource pressure (RAM/swap/disk), and budget overruns. |
| Budget | Spending cap per Floor. |

## File layout

```
<repo>/.claude/aisquad/floor.json          # name, goal summary, workflow, layout, desks, devices (no secrets, no absolute paths)
<repo>/.claude/aisquad/team.json           # agents: id, displayName, role {template, version}, overrides, appearance
<repo>/.claude/aisquad/git.json            # branch strategy, merge policy, quality gate command, commit identity rules
<repo>/.claude/aisquad/roles.lock/<role>@<version>.md   # snapshot of each template in use (repo stays self-contained)
<repo>/.claude/agents/<agent-id>.md        # GENERATED: template + overrides, standard Claude Code agent file
<repo>/AISQUAD.md                          # project brief and goal, read by every agent
~/.aisquad/building.json                   # per machine: registered floors (absolute paths), floor order/number, prefs
~/.aisquad/roles/<role>.md                 # local Role Template library (frontmatter + body)
~/.aisquad/libraries.json                  # optional extra template libraries (e.g. a team git repo of templates)
~/.aisquad/pin                             # local PIN for mutating actions (0600)
```

### Role Template format (`~/.aisquad/roles/frappe-developer.md`)

```markdown
---
role: frappe-developer
title: Frappe Developer
version: 3
model: sonnet
effort: medium
skills: [frappe, erpnext]
tools: [Read, Edit, Write, Bash, Grep, Glob]
permissions:
  deny: ["Read(./.env)", "Bash(git push*)"]
appearance: { style: spiky, shirt: "#3d82d6" }
---
## Rules
- Never edit Frappe core; always work in a custom app.
- Run `bench migrate` after changing a DocType.

## Prompt
You are a Frappe developer ...
```

### Override rules

| Field | Override behaviour |
|---|---|
| model, effort, appearance | replace |
| skills | add / remove relative to template |
| rules | append (template rules always apply) |
| permissions | may only be **stricter** than the template |
| prompt | appended below the template prompt |

When a template gets a new version, the Floor shows **Update available** with a diff; the user chooses *Update* or *Keep current* per agent. **Detach** converts an agent into a standalone copy.

`id` is generated from `displayName` in kebab-case (`Ramdani - Frappe Developer` → `ramdani-frappe-developer`), unique per Floor.

## Navigation

1. **Lobby**: stacked 3D building (dollhouse view), floor cards with status lamps, today's cost, global Attention list, "New Floor", "Detected projects" (directories with Claude Code activity that are not Floors yet → "Create Floor from this").
2. **Floor**: 3D office with desks and agents (status: working / idle / waiting / stopped), team panel, activity feed, messages between agents, optional sprint board when workflow = squad-sprint.
3. **Desk**: one agent — live screen/log, transcript, send task (with attachments), answer Attention, profile (role, template version, overrides, skills, model), start/stop.

## New Floor wizard

1. Project: name, goal (writes `AISQUAD.md`).
2. Directory: existing / new (`git init`) / clone URL.
3. Git: remote, branch strategy, commit identity, no-AI-attribution toggle, push policy, merge policy (auto by default), quality gate command.
4. Team: add agents from Role Templates, set displayName and overrides.
5. Workflow: Free Team (default) or Squad Sprint.
6. Layout preset → floor number → create. Generates all files above and registers the Floor in `building.json`.

## Running agents (MVP)

- Agents run as Claude Code sessions in tmux (`aisquad-<floor>-<agent>`), each on its own tmux server (`tmux -L aisquad-<floor>-<agent>`) started through `systemd-run --user --scope` where available, so they survive the launching terminal/editor and an out of memory kill of one scope does not take the others (since 0.3.3).
- Status comes from Claude Code transcripts (`~/.claude/projects/<encoded-path>/`, `subagents/*.meta.json`, `~/.claude/teams/*/config.json`) — reuse the proven parser in the reference implementations.
- Attention: parse tmux screens for numbered **and unnumbered** option dialogs (e.g. "Do you trust this folder?"). Never type a task into a pane that shows a dialog. Long messages: type with `send-keys -l`, wait, press Enter, then verify the text left the input box.
- Phase 2 (not MVP): replace tmux with an Agent SDK runner; Claude Code plugin hooks stream events to the server.

## Watchdog (MVP)

- Stall: a Floor has pending work but its lead and all agents are idle ≥ 10 min, or one agent with assigned work is idle ≥ 10 min.
- Resources: warn when free RAM < 1.5 GB, swap > 85 %, disk < 5 GB; show in Lobby.
- Budget: estimated cost per Floor from transcript usage; warn at 80 %, Attention at 100 %.

## Security

- Server binds `127.0.0.1` by default; `--host 0.0.0.0` is opt-in. Mutating endpoints require the local PIN.
- Never read or display `.env` files; never put secrets or absolute personal paths in repo files.
- Generated agent permissions can only be stricter than templates.

## Distribution

- Claude Code plugin: `/aisquad` (start server + open browser), `/aisquad new-floor`, `/aisquad status`; bundles the server and the default Role Templates.
- Server: Node.js ≥ 22, **zero runtime dependencies**; three.js from CDN for the UI.

## MVP scope (build in this order)

1. Server core: Building registry, Floor/Team/Role Template storage, agent file generation with overrides + roles.lock, discovery of existing Claude Code projects/agents, PIN, JSON API.
2. Lobby + Floor + Desk UI in 3D (English), reusing the chibi characters.
3. New Floor wizard and Role Template editor (create, edit, version bump, update/keep/detach).
4. Start/stop agents, send task, answer Attention.
5. Edit Mode (drag desks/devices, layout presets, appearance) saved to `floor.json`.
6. Watchdog basics.
7. Plugin packaging (`/aisquad` command) + README.

Out of MVP: Agent SDK runner, shared multi-machine building, auto-merge executor (spec only), billing.

## Reference implementations on this machine (read, do not modify)

- `/home/erpnext/sopwer-squad/` — multi-project lobby prototype (Indonesian naming; must be renamed to English here): discovery, floors, layouts, chibi module `chibi.js`.
- `/home/erpnext/dtamu/squad-3d/` — full single-team office: tmux prompt parsing (numbered + unnumbered), answering, attachments, agent creation, cost, performance, desk devices, POV.
- `/home/erpnext/dtamu/dtamu-app/.claude/` — a working Squad Sprint setup (agents pm/developer/qa, hooks, `/sprint` command, docs/squad board).
