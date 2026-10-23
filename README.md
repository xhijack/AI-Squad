# The AI Squad

The AI Squad turns a machine running Claude Code into a 3D **Building**. Every project directory is a **Floor**, every Floor has a **Team** of **Agents**, and you form, run and watch those teams from the browser.

- **Lobby**: the whole Building as a stacked dollhouse, a card per Floor with status lamp and today's cost, everything that needs you (**Attention**), and projects with Claude Code activity that are not Floors yet.
- **Floor**: a 3D office with a desk per agent (working, idle, waiting, stopped), the team panel, an activity feed, messages between agents, and a board when the Floor uses the Squad Sprint workflow.
- **Desk**: one agent: send a task (with attachments), answer its questions and permission prompts, its live terminal screen, transcript and profile (role, template version, overrides, skills, model), start and stop.

Agents are Claude Code sessions in tmux, created from **Role Templates** with per-agent **overrides**. Six templates ship with the plugin: Project Manager, Frappe Developer, Fullstack Developer, QA Engineer, UI/UX Designer and SEO Specialist.

## Requirements

- Node.js 22 or newer (no npm packages needed: the server has zero dependencies)
- Claude Code (`claude` on the PATH, or next to the `node` binary as with nvm)
- tmux; `systemd-run --user` is used when available so agents and the server survive the terminal that started them
- A browser with WebGL. three.js 0.160.0 is loaded from jsDelivr.

## Install

As a Claude Code plugin, from this repository:

```
/plugin marketplace add <path-or-git-url-of-this-repo>
/plugin install aisquad@sopwer
```

Or run it straight from a checkout:

```
node bin/aisquad.js            # start the server in the background and open the browser
```

## Use

| Command | What it does |
|---|---|
| `/aisquad` | Start the server (if it is not running) and open the Building |
| `/aisquad new-floor` | Same, straight into the New Floor wizard |
| `/aisquad status` | Floors, agent states, Attention and machine resources as text |
| `/aisquad stop` | Stop the server; agents keep running in tmux |

The full command name is `/aisquad:aisquad` (plugin `aisquad`, command `aisquad`); Claude Code accepts the short `/aisquad` when no other command uses that name. In `claude -p`, use the full name.

The server listens on `http://127.0.0.1:8097`. Pass `--port` to change it, and `--host 0.0.0.0` only if you really want it reachable from other machines.

Viewing is open on the bound address; every change and every agent screen needs the local PIN. Find it with `cat ~/.aisquad/pin`.

### Create a Floor

**New Floor** walks through six steps:

1. **Project**: name and goal (written to `AISQUAD.md`, which every agent reads first).
2. **Directory**: an existing directory, a new project (`git init`), or a clone URL.
3. **Git**: remote, branch strategy, commit identity, no-AI-attribution, push policy, merge policy (automatic after the quality gate by default) and the quality gate command.
4. **Team**: agents from Role Templates, each with a display name (for example "Ramdani - Frappe Developer") and optional overrides.
5. **Workflow**: Free Team (default) or Squad Sprint, and an optional budget.
6. **Layout** (Rows, Pods, Circle, Open Space) and the floor number.

Projects listed under **Detected** can become a Floor with one click. A directory that already has `.claude/aisquad/` (for example cloned from a teammate) is registered as it is.

### Run agents

On a Desk: **Start** opens `claude --agent <id>` in tmux session `aisquad-<floor>-<agent>`. Type a task and press **Send task**; when the agent is still starting or shows a dialog, the task waits and is typed once Claude Code is ready. Questions and permission prompts (numbered, and unnumbered ones such as "Do you trust this folder?") appear under **Attention** with their options as buttons. You can always look at the real terminal with `tmux attach -t aisquad-<floor>-<agent>`.

### Role Templates and overrides

Templates live in `~/.aisquad/roles/<role>.md` (frontmatter + `## Rules` + `## Prompt`). Extra read-only libraries, such as a team repository of templates, are listed in `~/.aisquad/libraries.json`:

```json
{ "libraries": [{ "name": "team", "path": "/path/to/templates" }] }
```

Every saved change is a new version. An agent keeps the version it was created with until you choose **Update**, **Keep current** or **Detach** (a standalone copy) on its Desk, after reviewing the diff.

| Field | Override |
|---|---|
| model, effort, appearance | replace |
| skills | add / remove relative to the template |
| rules | appended; template rules always apply |
| permissions | may only be stricter (extra denies; allows must already be allowed by the template) |
| prompt | appended below the template prompt |

### Edit Mode

**Edit layout** on a Floor: drag desks and devices (whiteboard, printer, plants, coffee machine, bookshelf, sofa, server rack), rotate with Q / E, switch a desk between laptop and dual monitor, apply a layout preset, and change how agents look. **Save** writes `floor.json`.

### Watchdog

Checked every minute and shown in the Lobby:

- **Stall**: pending work while the lead and all agents are idle for 10 minutes, or an agent with assigned work idle for 10 minutes.
- **Resources**: free RAM below 1.5 GB, swap above 85 %, free disk below 5 GB.
- **Budget**: estimated from transcript token usage; warning at 80 %, Attention at 100 %.

## Files

```
<repo>/.claude/aisquad/floor.json          name, goal, workflow, layout, desks, devices, budget
<repo>/.claude/aisquad/team.json           agents: id, displayName, role {template, version}, overrides, appearance
<repo>/.claude/aisquad/git.json            branch strategy, merge policy, quality gate, commit rules
<repo>/.claude/aisquad/roles.lock/<role>@<version>.md   snapshot of every template version in use
<repo>/.claude/agents/<agent-id>.md        generated Claude Code agent file (do not edit by hand)
<repo>/AISQUAD.md                          project brief, goal and team
~/.aisquad/building.json                   Floors on this machine (absolute paths live only here)
~/.aisquad/roles/<role>.md                 local Role Template library (+ .history/ for old versions)
~/.aisquad/libraries.json                  optional extra template libraries
~/.aisquad/pin                             local PIN (0600)
~/.aisquad/runtime.json                    work given to agents (for stall detection)
~/.aisquad/attachments/                    files attached to tasks (outside every repo)
```

Floor and team configuration is meant to be committed, so the whole team shares it. No secrets, personal data or absolute paths are written to the repository, and agents are told never to read `.env` files.

## Develop

```
npm test                         # node --test, all server modules
node scripts/seed-playground.js  # scratch Building with three Floors under ./playground
scripts/dev.sh start             # dev server on :8097 against the playground (PIN 123456)
node scripts/shot.js shots.json  # headless Chrome screenshots: [{ url, out, w, h, pin?, eval? }]
```

`AISQUAD_HOME`, `CLAUDE_HOME`, `AISQUAD_TMUX_SOCKET`, `CLAUDE_BIN` and `AISQUAD_NO_SYSTEMD=1` point the server at scratch directories, a private tmux server and a fake Claude Code (`test/fixtures/fake-claude.cjs`), which is how the tests run.

```
server/   building, floors, roles, compose (overrides), transcripts, tmux, watchdog, squad (live state), api
ui/       index.html, app.js (routing, panels), scene.js (3D), chibi.js, views.js, wizard.js, templates.js, dialogs.js, edit.js
templates/roles/   default Role Templates
bin/aisquad.js     command line used by /aisquad
commands/aisquad.md   the Claude Code command
```
