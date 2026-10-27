# The AI Squad

The AI Squad turns a machine running Claude Code into a 3D **Building**. Every project directory is a **Floor**, every Floor has a **Team** of **Agents**, and you form, run and watch those teams from the browser.

- **Lobby**: the whole Building as a stacked dollhouse, a card per Floor with status lamp and today's cost, everything that needs you (**Attention**), and projects with Claude Code activity that are not Floors yet.
- **Floor**: a 3D office with a desk per agent (working, idle, waiting, stopped), the team panel, an activity feed, messages between agents, and a board when the Floor uses the Squad Sprint workflow.
- **Desk**: one agent: send a task (with attachments), answer its questions and permission prompts, its live terminal screen, transcript and profile (role, template version, overrides, skills, model), start and stop.

Agents are Claude Code sessions in tmux, created from **Role Templates** with per-agent **overrides**. A **Squad Blueprint** turns a group of agents into a team: it sets the roles, the source documents every agent works from, who talks to whom, the gates and the definition of done. Blueprints ship for a Software House, an ERP Consultant (ERPNext implementations), Digital Marketing, Sales & CRM and Legal, with 24 Role Templates and 41 built-in skills.

Floor 1 shows the **independent agents** already running on your machine (terminal, tmux, VS Code); squads start at Floor 2.

**Quickstart** (1.0): one command on a new machine, see [`docs/QUICKSTART.md`](docs/QUICKSTART.md):

```
curl -fsSL https://raw.githubusercontent.com/xhijack/AI-Squad/main/install.sh | bash
```

**Bahasa Indonesia:** [mulai cepat](docs/id/QUICKSTART.md) · [panduan](docs/id/PANDUAN.md).

## Requirements

- Node.js 22 or newer (no npm packages needed: the server has zero dependencies)
- Claude Code (`claude` on the PATH, or next to the `node` binary as with nvm)
- tmux; on Linux, systemd (user services) keeps the server and agents running after the terminal that started them closes
- A browser with WebGL. three.js 0.160.0 is vendored in `ui/vendor/three`, so the UI works offline.

## Install

Step-by-step guide (requirements, remote access, first steps, troubleshooting): [INSTALL.md](INSTALL.md).

The GitHub repository is also a Claude Code plugin marketplace. In Claude Code:

```
/plugin marketplace add xhijack/AI-Squad
/plugin install aisquad@aisquad
/aisquad
```

`/aisquad` starts the server and opens the Building. On Linux it installs and starts a **systemd user service**, `aisquad.service`, generated with the plugin's current path and `node` binary and `Restart=always`, so the server keeps running after you close the terminal or VS Code. On macOS it uses a launchd agent; where neither exists it starts a detached process. The PIN for changes is in `~/.aisquad/pin`.

A user service stops when you log out unless lingering is on for your account (`/aisquad status` tells you). To keep it running without a login session: `loginctl enable-linger $USER`.

### Update

```
/plugin marketplace update aisquad
/plugin update aisquad@aisquad
# quit Claude Code and open it again, then:
/aisquad
```

The plugin moves to a new path when it updates; the next `/aisquad` notices that the service points to the old path, rewrites `aisquad.service` and restarts it ("Updated and restarted"). Agents keep running.

### Contributors

```
git clone git@github.com:xhijack/AI-Squad.git
cd AI-Squad
node bin/aisquad.js              # same as /aisquad, from the checkout
claude --plugin-dir .            # or load the checkout as a plugin
```

### Uninstall

```
/aisquad uninstall                # stops the server and removes aisquad.service (or the launchd agent)
/plugin uninstall aisquad@aisquad
/plugin marketplace remove aisquad
```

Your Floors and their repositories are not touched. To remove The AI Squad's machine-local data as well (Building registry, Role Template library, PIN, logs), delete `~/.aisquad`. Agents that are still running stay in tmux: stop them on their Desks first, or with `tmux -L aisquad-<floor>-<agent> kill-server`.

## Use

| Command | What it does |
|---|---|
| `/aisquad` | Start the server (if it is not running) and open the Building |
| `/aisquad new-floor` | Same, straight into the New Floor wizard |
| `/aisquad status` | Floors, agent states, Attention, machine resources and the service state as text |
| `/aisquad stop` | Stop the server; agents keep running in tmux |
| `/aisquad uninstall` | Stop the server and remove the systemd user service or launchd agent |
| `/aisquad backup` | Back up the Building (see Backups and moving to another machine) |
| `/aisquad verify <file>` | Check that a backup reads back |
| `/aisquad restore <file>` | Restore a backup, on this machine or a new one |
| `/aisquad doctor` | Check this machine and the Building: Node.js, tmux, Claude Code, git, the service, the data version, PIN and secrets permissions, every Floor folder and linked repository, memory, disk and backups |

The full command name is `/aisquad:aisquad` (plugin `aisquad`, command `aisquad`); Claude Code accepts the short `/aisquad` when no other command uses that name. In `claude -p`, use the full name.

The server listens on `http://127.0.0.1:8097`. Pass `--port` to change it, and `--host 0.0.0.0` only if you really want it reachable from other machines.

On `127.0.0.1` (the default) viewing is open and every change and every agent screen needs the local PIN. Bound to any other address (for example `--host 0.0.0.0`), every API call needs the PIN, reads included; the browser asks for it once. Find it with `cat ~/.aisquad/pin`.

### Set up Squad

The big **Set up Squad** button in the Lobby walks through four steps:

1. **What do you want to build?** Describe it ("I want a software house that builds my restaurant POS") or pick a Blueprint card. Claude Code (`claude -p` on haiku, no tools) recommends a Blueprint and a team and says why each agent is there. Without Claude Code, keyword matching picks the Blueprint.
2. **Team**: edit names, the lead and the members; **Add agent** opens the Role Template catalog, filterable by category and skill.
3. **Folder**: one squad = one project folder. Use an existing repository, or let The AI Squad create `~/aisquad-squads/<slug>` with `git init` (change the default with "Change the default"; it is `squadsDir` in `~/.aisquad/building.json`).
4. **Review and create**: the next free Floor (2 and up), the Floor files, the agent files, the Blueprint's documents and the team's skills. The lead can start right away; its first job is to collect the source documents from you.

### Squad Blueprints

A Blueprint is a versioned template for a whole squad (`templates/blueprints/<id>/blueprint.md` plus a `pack/` of document skeletons, seeded into `~/.aisquad/blueprints/` where you may edit them). It defines:

- the **roles**, how many of each (min / default / max) and the **lead**;
- the **source documents** every agent treats as the main reference, their owner and their status (`STATUS: DRAFT` or `APPROVED`);
- the **channels**: only the lead talks to you; teammates reach the lead with SendMessage, hand work over in handoff files, and put questions for you in the questions file;
- the **work items**, the **handoff** format, the **gates** and the **definition of done**, plus rules per role.

The standard is written into `AISQUAD.md` and into every generated agent prompt, and the Blueprint itself is kept in `.claude/aisquad/blueprint.md`. The Floor shows each source document with its status.

| Blueprint | Lead | Team | Source documents |
|---|---|---|---|
| Software House | Project Manager | Developers (1-4), QA Engineer, UI/UX Designer, DevOps Engineer | `docs/PRD.md`, `docs/TECH.md`, `docs/DESIGN.md`, `docs/ENVIRONMENTS.md` |
| Digital Marketing | Marketing Strategist | SEO Specialist, Content Writer, Social Media Specialist, Ads & Analytics Specialist, Designer (optional) | `docs/MARKETING-BRIEF.md`, `docs/BRAND.md`, `docs/CHANNELS.md` |
| Sales & CRM | Sales Manager | Lead Researcher, CRM Administrator, Sales Copywriter, Sales Analyst | `docs/ICP.md`, `docs/OFFER.md`, `docs/PIPELINE.md` |

Software House runs on the Squad Sprint workflow; `/sprint` refuses to start while a source document is not approved. The other two keep their board in `docs/BOARD.md`.

### Independent agents (Floor 1)

On start and with **Rescan**, The AI Squad looks for Claude Code agents that already run on the machine: live `claude` processes, tmux panes running `claude`, and projects with transcripts from the last 24 hours. Each gets a desk on Floor 1 with its live status, screen (for tmux), transcript and questions in Attention. Nothing is written into their repositories (the registry is `~/.aisquad/independents.json`). **Adopt** moves one into a squad's team as a new member. Floors created before Phase 2 move up from Floor 1 to 2 automatically.

### Built-in skills

Every Role Template lists its skills, and 32 skills ship with the plugin in `skills/<name>/SKILL.md` (PM: `source-docs-intake`, `sprint-planning`, `handoff-review`; developers: `implement-from-spec`, `tdd`, `handoff-writing`; QA: `test-plan-from-acceptance`, `ui-evidence`, `bug-report`; designer: `design-fidelity-map`, `design-review`, `accessibility-check`; DevOps: `environment-matrix`, `deploy-and-rollback`, `secrets-hygiene`, `server-discovery`, `staging-install`, `docker-ops`, `git-deploy`, `netlify-setup`, `server-health`; marketing and sales skills for their roles). The Desk profile shows where each skill comes from (project, user, plugin, missing); **Install** copies a bundled skill into the project's `.claude/skills/`.

**DevOps on real servers** (DevOps Engineer v2): a task you give the DevOps agent on its own Desk means setup preparation. It inventories the server read-only (`server-discovery`, assuming the server is shared, into `docs/ops/SERVER-<host>.md`), plans the staging install (`staging-install`: its own compose project, network, free ports, memory limits, deploy key, and what needs your sudo or DNS), checks Netlify readiness, and asks you to approve the plan before anything changes. A task from the lead means deployment to an environment you already approved (`git-deploy` by tag with rollback, or a Netlify deploy), followed by a smoke test and a report to the lead. Docker work stays inside the squad's own compose project (`docker-ops`). Tokens such as `NETLIFY_AUTH_TOKEN` come from the environment, never from chat. A Desk session and a lead-spawned copy of the same agent can run side by side. The Desk shows the Desk session.

### In the office

Every Floor is a warm isometric office: honey wood floor, two walls with windows, a brand wall with the Floor name and its tagline (Floor settings), a whiteboard, a pantry, a lounge with sofa, TV and beanbags, and a ping-pong table. Drag to move around and scroll to zoom. The Lobby stacks the Floors as a cutaway dollhouse.

The screen stays clear for the office:
- a **status pill** top left: the Floor, sprint progress, active agents, the Floor menu (settings, edit layout, start / stop all, add agent, board, performance, cost) and the main menu (Set up Squad, Role Templates, theme, PIN);
- one **panel on the right**: questions for you on top, the agents with one status chip each, then Activity / Messages / Standard; a Desk replaces the agent list (hide the panel with its arrow);
- the **dock** at the bottom: board, performance, cost, server meter, add agent, voice and a legend.

On phones the office is on top, the lists are in a bottom sheet, and the dock is one row of icons. The light theme is the default; the menu switches to dark or to the system setting.

- Click a character to look **through its eyes** (drag to look around, Esc to return); click its name tag for its desk, its monitor for the screen view.
- Desks carry a keyboard, mouse, mug and a toy per role; the laptop shows the role's screen (code, test runner, mini board). Templates can set `props` and `screen` in their appearance.
- When the whole team is idle for 20 s, the lead shouts for work; turn its **voice** on in the dock.
- The dock's **server meter** shows CPU, RAM, swap and disk (red when dangerous); click it, or the server rack, for a 6 minute graph and the busiest processes.
- On Squad Sprint Floors, **Performance** shows per agent and sprint the QA bugs per story point (Blocker 5, Major 3, Minor 1, Cosmetic 0.5), the first-round pass rate, modules owned and cost per story point, plus the **cost projection** for the remaining backlog (`docs/BACKLOG.md` with an SP column).

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

On a Desk: **Start** opens `claude --agent <id>` in tmux session `aisquad-<floor>-<agent>`, on its own tmux server (socket `aisquad-<floor>-<agent>`) in its own systemd scope, so an out of memory kill takes one agent, not all of them. Sessions started by versions before 0.3.3 stay on the default tmux server and are still found there. Type a task and press **Send task**; when the agent is still starting or shows a dialog, the task waits and is typed once Claude Code is ready. Questions and permission prompts (numbered, and unnumbered ones such as "Do you trust this folder?") appear under **Attention** with their options as buttons. You can always look at the real terminal with `tmux -L aisquad-<floor>-<agent> attach -t aisquad-<floor>-<agent>` (the Desk shows the exact command).

**When an agent dies.** If a session ends without a stop from The AI Squad, the server finds out how: an out of memory kill (`systemd-oomd killed` in `journalctl --user` for the agent's scope), or a transcript that ends mid-turn. The Desk, the agent list and Attention then say **Stopped unexpectedly (out of memory at 11:49)**, with **Resume** as the main button: it runs the same command as Start plus `--resume <last session id>`, so the agent keeps its context. **Start fresh** begins a new session. Any stopped agent with an earlier session also offers **Resume last session**. A resumed lead of a Squad Sprint or Blueprint Floor gets a short recovery note: its in-process teammates died, re-spawn only what is still needed, follow the memory rules. Teammates that ran inside a crashed lead show their real last state from their transcripts ("stopped with the lead … · last: editing src/app.ts"). Floor settings → **Recovery and memory**: **Auto-resume after a crash** (off by default; at most 2 per agent per hour, never while swap is above 80 % or RAM is low) and **Max concurrent agents** (default 4; the lead's agent file says so). Starting another agent while swap is above 80 % or the Floor is at its maximum asks you first.

**Source documents.** On a Blueprint Floor the pill "Waiting for you: N source documents", the Standard tab and the Floor menu open **Source documents**: each document with its purpose, owner and status, pending ones first. **View** shows the text, **Approve** sets its `STATUS:` line to `APPROVED` and fills `Approved by the owner on:` (no other line changes), **Request changes** sends your notes to the lead as a task. Only the paths the Blueprint names can be read or approved.

**When an agent finishes.** When an agent you talk to directly ends its turn and no question or permission dialog is open, Attention gets one card. These agents are the lead, any agent you started from its Desk, and independent agents. If the message asks you something, the card is **Waiting for your reply**. Otherwise it is a calm **Finished** card: "<agent> finished", the report rendered (headings, lists, tables, code, opening at its first lines), **Reply** (sent as the agent's next task), **OK** and **Open desk**. It counts in the tab title and the browser notification like other Attention items, but blocks nothing (Autopilot keeps going). It clears when the agent works again or you press OK. Independent agents are answered in their own terminal. Teammates the lead spawned report to the lead, so their reports stay in Activity. Each report is logged as `report.delivered`.

**Reading and answering large.** Click any Attention item (in the Needs you list, a card, the phone sheet or the Desk) to open the conversation view. On the left is the agent's own chibi, drawn live with the same look and desk toy as in the office. It breathes and talks while the message appears, and stays still with reduced motion. On the right is the message as a speech bubble: 16 px text, headings, lists, tables with zebra rows, code and links, scrolling between a fixed header and action bar. The action bar holds the question's options as large buttons (the recommended one highlighted, free text as a box), or Reply with OK / Dismiss, plus Open desk. "n of m" with ‹ › (or the arrow keys) steps through every open item, and Esc closes. Meanwhile the office camera eases to that agent and a short bubble appears over its head. On a phone it is a full-screen sheet. The Needs you popover is now an index: one line per item.

Agents started by The AI Squad load this plugin's hooks (`--plugin-dir`), which stream session events (task submitted, tool use, permission prompts, end of turn) to the server. Status and Attention update live, and the Floor shows a **live** badge. With **per agent** commit identity in the Floor's git settings, each agent commits with its own name and email (`GIT_AUTHOR_*` / `GIT_COMMITTER_*`).

On the Floor, desk screens show what each agent is doing: the file it is editing, its terminal, QA screenshots, or a question waiting for you. Idle agents wander to the lounge and run back when work arrives. Click a monitor (or **Look at screen** on the Desk) to look over the agent's shoulder at its live terminal.

### Background jobs (Runner v2, 0.11)

An agent runs in one of two runners (`server/runner.js`):

- **tmux**: the interactive Claude Code session of its Desk (you type, answer dialogs and watch its screen). Its status comes from the plugin hooks and the transcript.
- **headless**: a **background job**, `claude -p --output-format stream-json` with the same agent file, model, effort, denied tools and linked repositories. Claude Code writes one JSON event per line (the session id, tool calls, text, the result with its cost and turns), so nothing is read from a screen. A job runs detached in its own process group with its output in `~/.aisquad/jobs/<id>.jsonl`, survives a server restart, and stops at its budget (`--max-budget-usd`, default $2). It cannot answer permission prompts: it runs in `dontAsk` mode (only what the project's settings allow), or `acceptEdits` when you tick "May edit files".

On a Desk: Send task → **Run in the background** (budget, may edit files). The agent shows as working ("background: …") while its job runs; **Background jobs** on the Desk lists them with status and cost, **Open** shows the answer and every step, **Stop** ends it. `job.started` and `job.ended` go to the Squad Log. Jobs count towards the machine's agents at once. Records older than 30 days are cleared.

API: `POST /api/floors/:id/agents/:agent/jobs { prompt, budgetUsd, permissionMode }`, `GET /api/jobs?floor=&agent=`, `GET /api/jobs/:id`, `POST /api/jobs/:id/stop`.

**Claude sign-in** (Menu): background runs (jobs, audits, squad recommendations) sign in with this machine's `claude` login, or with an **API key** (`ANTHROPIC_API_KEY`, kept write-only in `~/.aisquad/secrets.json`), so unattended work is billed to a Console organization. In API-key mode without a key, background runs are refused rather than falling back to a personal login. See `docs/BILLING.md`.

### Spaces, Company Brain and Admin (0.12)

A Floor is a **Space**: a `project` (one client or product) or a `department` (Sales, Marketing: many clients over time). The same agent can work in several Spaces; each session sees one Space only, through four layers:

| Layer | What | How |
|---|---|---|
| L0 Company Brain | brand, SOPs, templates, products (legal, finance, pricing for Owner Spaces only) | `~/.aisquad/company` or your own folder, `--add-dir`, read-only |
| L1 Identity | the agent's role | generated agent file; no writes to `~/.claude/CLAUDE.md`, `~/.claude/agent-memory`, `~/.aisquad` |
| L2 Space | repository, documents, memory | the Floor's repository; with memory "In the Space", Claude Code's auto memory lives in `.claude/aisquad/memory/` |
| L3 Session | the task | thrown away afterwards; what was learned is written into the Space |

A Space also has **access** (team or Owner only) and a **shift** (days and hours; a night shift past midnight belongs to the day it starts), which the dispatcher uses from 0.13.

**Menu → Admin** is one place for the whole company: Spaces, agents across Spaces (model, effort, extra skills, add, remove), the skill catalog, the Company Brain, and **Changes**: every change made through The AI Squad to `building.json` or a Space's configuration files, with who made it and a diff. **Roll back** puts the files back (and asks first when they changed again since).

### Dispatcher, shifts and the quota guard (0.13)

Every start goes through one queue (`server/dispatcher.js`): the Desk's Start, Resume and Send task to a stopped agent, background jobs, Autopilot, auto-resume after a crash and the lead's next sprint. It starts now when there is room, otherwise it queues and starts by itself later; the Desk says why it waits and at which place.

- **Slots**: the smallest of the Building maximum, what free RAM allows (2 GB stays free; the RAM per session is measured), and the CPU (no new session above 90 % load). A Space's own maximum still applies.
- **Order**: P0 the owner's own work, P1 a waiting squad (resume, next sprint), P2 normal work, P3 background. Waiting 30 minutes moves an item up one level (never to P0). In the daytime one slot stays free for the owner.
- **Shift**: a Space's automated work (everything the owner did not start) waits outside its shift, e.g. a Marketing department that works 22:00-05:00. Autopilot's idle nudges wait too.
- **Idle stop**: an agent that sits idle for 30 minutes (10 while work waits) is stopped to free its slot, unless someone waits on it (an open question, report, command or dialog) or it is a lead with teammates in its session. Resume continues the session.
- **Quota guard**: automated work pauses when a background job reports its 5-hour or weekly limit at 90 % (or reached), or when the API-equivalent cost of the last 5 hours or 7 days reaches the limits you set (off by default; an estimate, a subscription counts differently). The owner's own work still starts.

**Admin → Dispatcher** shows the slots and what limits them, the quota guard, the queue (priority, Start now, Remove) and the settings. API: `GET/PATCH /api/dispatcher`, `POST /api/dispatcher/queue/:id/start`, `PATCH|DELETE /api/dispatcher/queue/:id`. A start with `force: true` skips the queue.

### People and direct chat (0.14)

**Menu → People** (Owner): add **members** (start and stop agents, send tasks, chat, answer questions, background jobs) and **viewers** (read only). Each person gets an own 8-digit PIN, shown once and stored only as a scrypt hash in `~/.aisquad/users.json`; the PIN in `~/.aisquad/pin` stays the Owner's. The Building's settings, money, secrets, people, merges, approvals of source documents and Owner-only Spaces stay with the Owner (403 for others). An **Owner-only Space** does not exist for anyone else: it is left out of the Building, Admin, Changes, jobs and the queue, and its routes answer 404 (also for reads without a PIN). Changes record who made them; Squad Log events done by someone other than the Owner carry `data.by`.

**Desk → Chat**: talk to one agent directly.

- **This Space**: a running Desk session gets the message typed in and its answer comes back to the chat; a stopped agent answers through a short background job ($1 budget, P0 in the dispatcher's queue) that continues the chat's own session. The thread lives in the Space (`docs/squad/chats/<agent>.jsonl`); the lead finds a note of direct messages in `docs/squad/DIRECT.md`.
- **General**: the same agent with no project: a neutral folder with only its role and the Company Brain (`~/.aisquad/general/<space>--<agent>/`), the thread in `~/.aisquad/chats/`. For questions and drafts that belong to no client.

API: `GET/POST /api/floors/:id/agents/:agent/chat` (`context`: `space` | `general`), `GET /api/me`, `GET/POST /api/users`, `PATCH/DELETE /api/users/:id`, `POST /api/users/:id/pin`.

### Telegram, digest and Daily Insight (0.15)

**Admin → Notifications**: a Telegram bot sends questions, permissions and alerts with buttons, holds quiet hours, and sends a morning digest. Answers from Telegram take the same path as the browser, as the paired person, with the same role checks; hard stops need a 4-digit code. `/chat <agent>` talks to an agent. Long polling only (no open port). See `docs/TELEGRAM.md`.

**Admin → Improvements** (Daily Insight, trust level 0): every night (02:30) The AI Squad counts patterns in its own week (failing commands, opus for short turns, slow answers, idle with open work, out-of-memory crashes, queue waits, repeated questions) and suggests a change with its evidence, impact, risk and how to check it. Nothing is applied until the Owner accepts; an accepted change goes through Changes (rollback). No model is called.

API: `GET/PATCH /api/notify`, `PUT/DELETE /api/notify/telegram/token`, `POST /api/notify/pair|test|digest`, `DELETE /api/notify/chats/:id`, `GET/PATCH /api/insights`, `POST /api/insights/run`, `POST /api/insights/:id/accept|dismiss`.

### Views: 3D or Iso Pixel (0.16)

**Menu → Scene view** switches the renderer, remembered per browser:

- **3D** (three.js): everything, including first person, live screens, follow and Edit Mode.
- **Iso Pixel** (Canvas 2D, no WebGL): the same Building, Floors, desks and agents from the same isometric angle, as pixel sprites. Clicking an agent opens its Desk; states, the Attention bubble, walking to the lounge and the meeting table are there; first person, live screens and shadows are not. A Floor with five agents measured 9.8 MB of JS heap and 0.7 ms per frame, against 51 MB and ~1 s per frame for 3D in headless Chrome (software rendering).
- **Auto** (default): Iso Pixel on phones, on devices with 4 GB of memory or less and with more than 12 agents; 3D otherwise.

The first person, screen and follow views and Edit Mode always switch to 3D. The renderer not in use is disposed (its memory and WebGL context are given back). Both read the same renderer-neutral Scene Model (`ui/scene-model.js`: projection, desk and chair depth, poses by state, the palette swap).

The sprites come from the 3D models: `node scripts/make-iso-sprites.js` renders `ui/dev/sprites.html` in headless Chrome and writes `ui/assets/iso/atlas.png` + `atlas.json` (devices, desks and chairs at 8 headings; every chibi style and pose twice, as a colour-key mask and a white shading pass, so each agent is painted in its own colours). Run it again when a model changes. The realistic look (`?look=realistic`) is frozen: no new features are built for it.

### Building, Office and List (0.17)

The Lobby has three overviews (the dock: **Building · Office · List**, remembered per browser):

- **Building**: the Floors stacked as before, in the Scene view you chose (3D or Iso Pixel).
- **Office**: the whole company on one floor plan, drawn in Iso Pixel. Departments along the back wall with the **Server room** at its end (this machine's racks with RAM and CPU bars, agents at once), projects in the middle (a room each, appearing and going with the project), the **Lobby** (the dispatcher's queue, people waiting in line) and the **Owner's room** (what waits for you) at the front. Every agent sits at a desk facing you, in its state; a `?` shows who needs you, names appear when you zoom in. A room opens its Space (in the Scene view you chose), an agent its Desk, the Lobby the queue, the Owner's room the approvals, the Server room the meter.
- **List**: plain DOM, no canvas: what waits for you, the queue and the machine on top; departments, projects and independent agents with every agent's state and activity. A tap opens the Space or the Desk. The default on phones.

Owner-only Spaces are left out for everyone else, as everywhere (0.14).

### More machines: Head and workers (0.18)

When one machine runs out of room, add another instead of upgrading it. The machine that runs the server is the **Head**: it keeps every Space, the queue, the Squad Log, the people and the chats. A **worker** only runs background jobs (the headless runner) and keeps nothing that matters, so it can be replaced at any time.

1. **Admin → Machines → Add a machine** (owner only): a name gives a token, shown once (only its SHA-256 hash is stored, in `~/.aisquad/nodes.json`).
2. On the worker, with The AI Squad and Claude Code installed and **signed in to Claude there** (credentials never travel):
   ```
   aisquad node --head http://head.tailnet:8097 --name box-2 --token <token> [--max-agents 6]
   ```
   The worker only connects out to the Head (put both on a private network such as Tailscale or WireGuard): a heartbeat every 10 s with its free memory and running jobs, and a long poll for work. No port opens on it.
3. A background job goes to this machine first, then to the online worker with the most free memory, preferring one that already has the repository. A Space can be pinned (Admin → Spaces: **Background jobs run on** any machine with room, this machine only, or one worker). A Space whose repository has no git remote runs on the Head only. Desk sessions (tmux) always stay on the Head.
4. On the worker the job runs in its own clone (`~/.aisquad/worker/repos/<space>`) on a fresh branch `<agent>/job-<id>` from the main branch, with the agent file from the Head. The event stream comes back to the Head as it runs; at the end the worker pushes the branch when it made commits, and the Head fetches it, so it merges through the usual quality gate.
5. A worker silent for 45 seconds is offline: its running jobs are marked lost and queued again at P1 (`via: failover`), with a note to continue from the branch it pushed last. **Drain** stops new jobs for a machine; **Remove** revokes its token.

Admin → Machines also has the **Move to another machine** steps (backup, copy, restore, check), for when you replace the Head itself.

### Handoffs between Spaces, ERPNext and the Sales pilot (0.19)

**Handoffs.** Work passes from one Space to another as a **package**: an agent writes a Markdown file with a short header (`to:` the Space, `kind:`, `title:`, optionally `agent:` and `erpnext: DocType/name`) to `docs/squad/handoffs/outbox/`. The server (code, no model) delivers it to the other Space's `docs/squad/handoffs/inbox/<id>.md`, keeps a copy in `sent/`, and starts the receiving agent as a background job (P1, through the dispatcher, shifts respected). Questions go back as a `clarify` package (the sender is woken, answers with `answer`), the result as `done`. Packages leaving an Owner-only Space wait for the Owner; secrets are removed from every package; a bad package is renamed `.invalid` with the reason. The bundled skill `space-handoff` has the format. **Admin → Handoffs** lists them, with the share done without a round of questions.

**ERPNext** (setup: [`docs/ERPNEXT.md`](docs/ERPNEXT.md)). Agents use ERPNext through Frappe Assistant Core (an MCP server inside ERPNext) with the key of an ERPNext user made for their role: **Admin → Spaces → ERPNext**: *Sales* or *Delivery*. Keys are write-only (**Admin → ERPNext**), reach a session only as environment variables, never go to a worker; deleting, submitting, workflows, e-mail and code tools are denied on top of ERPNext's own permissions. The server watches the pipeline every few minutes:

- a new **Lead** becomes a handoff to the Sales Space (its ERPNext id and company, never contact data);
- a draft **Quotation** an agent hands to `owner` becomes a **price approval** on the Owner's desk (a hard stop: money; hidden from everyone else, a 4-digit code on Telegram). *Approve and submit* submits exactly the version on the card with the owner key, which no agent ever gets (without an owner key you approve here and press Submit in ERPNext yourself); *Send back with a note* returns it to the agent;
- a Quotation that became an **order** becomes a project handoff to the delivery Space, with the items and without prices;
- a Quotation submitted by an agent's user without your approval raises an alert.

Admin → ERPNext shows the pipeline: Leads handed over, prices approved, orders, and the median time from Lead to draft and to approved Quotation.

### Self-learning v2, ERP Consultant and release 1.0 (1.0.0)

**Trust ladder** (Admin → Improvements). Level 0 (the default): every Daily Insight suggestion waits for you. Level 1, per category, only for low-risk changes to one agent (a rule after a failing command, a lighter model): a new suggestion is applied by itself as a **canary** for 7 days, measured against its "before" with the same counts that raised it, and then a card asks you to keep it or roll it back (through the change history). A category earns level 1 with 10 accepted suggestions, 80 % of its decisions accepted, and improved follow-ups (60 % of at least 3 measured). Every accepted change is measured a week later. Never automatic: the hard-stop list, wider permissions, Building settings, Legal Spaces and roles, the Company Brain, promoting lessons.

**Capacity advice.** When the queue waits and memory or the CPU is the limit, Daily Insight suggests adding a machine (Admin → Machines) instead of upgrading this one, and says whether the connected workers still have room.

**Promote a lesson** (Admin → Improvements). A lesson a Space learned (`docs/squad/LEARNINGS.md`, L2) becomes a rule of a Role Template (L1): the server takes the client out (the Space's name and folder, its agents, personal data, secrets) and refuses a rule that still names them; you edit and approve it; the template gets a new version.

**ERP Consultant Blueprint.** An ERPNext implementation team (Project Manager, ERP Functional Consultant, Frappe Developer, QA) with a BRD, a fit-gap (`fit-gap-analysis` skill: Fit, Configure, Gap, Process change), a data migration plan and a UAT plan; every gap needs your approval before development.

**Quickstart.** `install.sh` checks the machine, installs into `~/.aisquad-app` without sudo, links `aisquad`, and runs `aisquad quickstart [--blueprint ID --name NAME]`: the server, the PIN, and optionally a first squad. Indonesian documentation in `docs/id/`.

### Legal, Marketing at night and model tiering (0.20)

**Legal.** *Set up Squad → Legal* makes an Owner-only department (Legal Counsel and Contract Drafter, both without a shell or the web). Contracts are copied from the locked bilingual templates in the Company Brain (`legal/templates/`: an NDA and an implementation services agreement, Indonesian governing, added to every Company Brain) into `contracts/` of the Legal Space, and checked with the `contract-checklist` skill: the four conditions of Pasal 1320 KUHPerdata, Bahasa Indonesia (UU 24/2009), personal data (UU 27/2022 PDP), electronic signature (UU ITE, PP 71/2019) and stamp duty, and the commercial points of `docs/LEGAL-POLICY.md`. A drafting aid, not legal advice.

- Every contract stays **DRAFT** until you approve it. Agents may set `READY FOR REVIEW`; that puts a card on your desk (a hard stop: legal; Telegram shows only the title) with the checklist's open points. *Approve the contract* approves exactly the version on the card; *Request changes* sends it back to the lead as a DRAFT with your note.
- The server keeps a fingerprint of every approval (`~/.aisquad/legal.json`): a contract marked APPROVED any other way, or changed after your approval, is put back to DRAFT, logged and shown to you.
- **Admin → Legal** lists the contracts with their status, checklist and revisions, and shows their text.

**Marketing at night.** The Digital Marketing Blueprint (version 2) makes a department that works 22:00-05:00 every day: its automated work waits for the shift and its results reach you in the morning digest.

**Model tiering** (Admin → Dispatcher, off by default). Background jobs run on the model their work needs: each role has a tier (light, standard, deep → haiku, sonnet, opus by default) and routine work (a new lead, a reply to a handoff, a result to file) goes one tier lighter. Legal roles keep their model, an agent whose model you set keeps it, and Desk sessions and chats always use the role's model. The section shows the cost per job before tiering was switched on and since.

### Role Templates and overrides

Templates live in `~/.aisquad/roles/<role>.md` (frontmatter + `## Rules` + `## Prompt`). Extra read-only libraries, such as a team repository of templates, are listed in `~/.aisquad/libraries.json` as a directory (`"path"`) or a git repository (`"url"`).

Every saved change is a new version. An agent keeps the version it was created with until you choose **Update**, **Keep current** or **Detach** (a standalone copy) on its Desk, after reviewing the diff.

| Field | Override |
|---|---|
| model, effort, appearance | replace |
| skills | add / remove relative to the template |
| rules | appended; template rules always apply |
| permissions | may only be stricter (extra denies; allows must already be allowed by the template) |
| prompt | appended below the template prompt |

Git libraries are cloned into `~/.aisquad/libraries/<name>` and pulled when you press **Pull** in the editor (**Role Templates → Libraries**); the commit is shown as the library version. Any template can be copied into the local library to change it.

```json
{ "libraries": [{ "name": "team", "url": "git@github.com:org/roles.git", "ref": "main", "subdir": "roles" }] }
```

### Autopilot

Autopilot decides how far a squad keeps going without you. Floor settings → **Autopilot** (also in the Set up Squad review step):

| Level | What happens |
|---|---|
| **Off** | Every question waits for you. Floors created before 0.4.0 start here. |
| **Balanced** (default for new Floors) | The lead decides what is not critical, records it and keeps going. Critical items wait for you. |
| **Full** | The lead decides everything except the hard-stop list. |

**Always waits for you** (the hard-stop list, any level): money (prices, payments, billing), legal (contracts, licences, personal data and privacy law), production deploys, secrets and credentials, irreversible actions (deleting data, force push, dropping tables, history rewrites), scope or business changes to the PRD or the source documents, and a source document that does not exist yet. Under Balanced, also anything the Blueprint marks as owner-only (`ownerOnly:` in its frontmatter). The list lives in `server/autopilot.js`, and the lead's agent file gets the same list in its `## Autopilot` section. The check is a keyword match in English and Indonesian. When the text is unclear, the item counts as critical.

How it works:
- The lead decides questions that are not critical, writes each decision to the questions file as `DECIDED BY LEAD (autopilot), owner may correct`, and continues.
- A question with an option marked "(Recommended)" that is not critical gets that option after the timeout (default 3 minutes, Floor setting). It stays in Attention as a muted **Decided by autopilot** card. **Change answer** sends your choice to the agent as a follow-up task, and **OK** keeps the decision. Permission prompts are never answered.
- An unanswered **Waiting for your reply** ask that is not critical gets a nudge after the timeout: decide per the Autopilot rules, record it and continue.
- When the lead and every teammate are idle for 5 minutes while the board has open tasks, the lead gets a nudge to continue (at most once per 15 minutes).
- Autopilot turns on auto-resume after a crash. Sprint merges and the next sprint still follow their own settings. Nudges and resumes stop when the budget is reached, memory is under pressure, a critical item waits, or the backlog is empty.
- Autopilot never approves a source document and never pushes. The budget, the memory guard and the source document gate stay in place.

The Floor's status pill shows **Autopilot: Balanced** (or that something critical waits), and the Lobby shows **Decided by autopilot today**. The Squad Log records `autopilot.decided`, `autopilot.nudged`, `autopilot.blocked` and `autopilot.changed`. The Audit has an Autopilot section with the decisions taken, how many you changed later, critical items decided without you (must be 0) and the waiting saved.

### Rituals and methods (0.5)

- **Root cause first** (`investigate` skill for developers and QA): before fixing a failure, the agent writes the symptom, the reproduction, the cause and the evidence in `docs/squad/debug/<slug>.md`, records every fix attempt, and escalates to the lead after three failed attempts. The Squad Log records `debug.attempt` and `debug.escalated`, and the Audit flags debug loops.
- **Retro**: when a sprint closes, its audit is also its Retro. It lists what went well, what did not, three concrete changes (the most severe findings first), a per-agent breakdown with Performance data, and the cost per story point trend. It is built from the audit and needs no extra model call. Open it from the Floor menu (**Retro**) or from the sprint's audit. **Send to lead** writes it to `docs/squad/retro/sprint-N.md` and asks the lead to add entries to LEARNINGS.md.
- **LEARNINGS.md** (`docs/squad/LEARNINGS.md`): the project's memory, one line per entry with date and source. Every generated agent prompt says to read it before a module. The lead adds entries after each Retro. Audit findings with target `project` add entries once you apply them.

- **Plan reviews before the sprint** (0.5.1): before drafting a PRD, the lead runs a **premise check** with you: who exactly the user is, the problem today, what happens if we do nothing, the smallest version, how we know it worked, and what we will not build. Every sprint plan states a **scope mode** (Expand, Selective expand, Hold, Reduce) with a reason. A mode changed mid-sprint shows in Attention as **Scope change**: critical, also under Autopilot, with "Accept" or "Back to …". Before the team starts, the `plan-review` skill runs an engineering review, a design review (0-10 per dimension with what would make it a 10) and a security review into `docs/squad/sprint-<N>/PLAN-REVIEW.md`. Only taste decisions come to you. The new **Security Engineer** role (optional in Software House v3) reviews plans with STRIDE and releases with the OWASP Top 10, testing only local or staging.

- **Office rituals** (0.5.3): every Floor has a **meeting table** (added to arranged offices too, movable in Edit Mode). When the Squad Log records a sprint planning, a plan review, a Retro, the lead briefing a teammate or the daily standup, the characters involved walk to the table, sit and talk, then go back to their desks. The **standup** is made from the Log every day at the time in Floor settings: per agent what was done, what it is doing and what blocks it, with no model call. It shows in the **Standup** tab ("So far today" for the live version). **Follow** (on the Desk) is a chase camera that follows one agent around, with a bar to switch agents. Developer monitors show their latest edit as a **diff** (removed lines red, added lines green). The lead's and QA's screens have a strip with the QA and merge status of the sprint.

- **Shipping safety** (0.5.4): **Ship readiness** (Floor menu, Squad Sprint Floors) lists what ran for the sprint and what is missing: QA pass for every module, the final smoke test, release notes, the plan review, the design review (needed when the team has a designer), the security review (needed with a Security Engineer: no open Critical or High finding) and `Rollback tried: <date>` in `docs/ENVIRONMENTS.md` (needed to deploy). Automatic sprint merges wait until the merge list is complete (`ship.blocked` in the Log). DevOps checks the same list before every deploy and watches each deploy with the **canary** skill: it rolls back staging by itself and asks you before rolling back production. **Edit locks** (a hook in the Squad Sprint pack): a developer may edit only its modules' "Owned folders" from PLAN.md and `docs/squad/`, shared files are the lead's, and destructive commands (`rm -rf`, `git reset --hard`, force push, `git clean`, dropping tables, `docker … prune`) ask for confirmation first.

- **Design variants and second opinions** (0.6.3, Phase 2.5 part 5): when you give only a mockup or a vague wish, the UI/UX designer writes 3-4 variants of the screen as static HTML in `docs/design/variants/<screen>/`. You see them side by side under **Pick a design** in Attention or in the Floor menu (**Design variants**), each in a sandboxed frame. Your pick, with an optional "why", becomes a dated taste note in `docs/DESIGN.md` that later rounds follow. Modules marked `Risk: high` in the plan can get a **Second Opinion Reviewer** (an optional role in Software House v4) running on a different model than the author's. It writes AGREE or DISAGREE with evidence, and a disagreement goes to the lead.

### Voice

The characters can speak with ElevenLabs voices. Menu → **Voice settings**: paste your ElevenLabs API key (or set `ELEVENLABS_API_KEY` in the service environment, which wins). The key is stored in `~/.aisquad/secrets.json` (mode 600) and never goes into a repository, a log or the browser: the page only shows "set ····abcd". **Test voice** makes one call.

- What speaks: a new Finished report, question or Waiting for your reply (its headline and up to two sentences, made without a model call, redacted first), the lead's shout when the team is idle, and the first line of a meeting at the table. **▶ Listen** in the conversation view reads the whole message.
- Voices: each agent can have its own (Desk → Profile → Voice: the account's voices with a preview); otherwise its role has a default, so a new squad sounds right at once. Only the voice id is stored in `team.json`.
- The mouth of the character (in the office and in the portrait) follows the audio. With reduced motion it stays still.
- Cost and control: audio is cached by voice, model and text in `~/.aisquad/voice-cache/` (60 MB at most). A monthly character budget (default 50 000) has a meter in the settings; past it, or without a key, the browser's own voice speaks. You can set the model (Flash by default, multilingual), quiet hours, "only while this tab is visible", and mute Floors. The dock's speaker button switches every voice on or off. The Squad Log records `voice.spoken` and the Audit shows voice characters.

### Graphics quality

Menu → **Graphics**: **Auto** (default: High, and Low when frames get slow), **High** (soft image-based light from a small studio HDRI, ambient occlusion, warm colour grading with a light vignette, SMAA, soft shadows under the characters) or **Low** (one render pass, as fast as before). The setting is kept per browser. The furniture comes from the KayKit packs by Kay Lousberg (CC0): desks, chairs, sofa, rug, plants, pantry counter and fridge, meeting table, bookshelf and floor lamp, packed into one 390 KB GLB (`ui/assets/kaykit/office.glb`, sources and licences in `ASSETS.md`). Devices without a KayKit model (monitors, whiteboard, TV, beanbags, ping-pong, server rack, printer) and the whole room while the file loads are drawn by the procedural builders. The frame loop slows to a third of its rate when nothing moves: no input, no camera move, nobody walking.

### Walking (no one passes through anything)

Every Floor has a walkable grid (`ui/nav.js`) built from the real footprints of desks, chairs, devices and walls, rotated and inflated by a character's size. Characters walk A* routes with smoothed corners to the lounge, the pantry, the meeting table and back. They keep their distance from each other (slide past, wait, or go around), and each seat holds one character. The last short step into a chair, sofa place or seat is a straight docking move. Edit Mode refuses to place or turn a desk or device where it would overlap something or cut a desk off from the room: the selection ring turns red, and the piece goes back with a hint. The follow camera stops in front of walls and furniture. Add `?nav=1` to the address for an overlay with the blocked cells and the routes being walked.

### Merges

Merges are done by The AI Squad server, never by an agent (decision D3). The policy lives in `git.json` (merge policy, squash or merge commit, quality gate, push policy); the one-time approval per Floor is stored on this machine in `~/.aisquad/approvals.json`, never in the repo.

For each branch with finished work (an agent's branch once its task is done and it is idle; feature branches once nobody has open work; a closed sprint branch) the server merges in a temporary worktree, runs the quality gate on the merged result, and refuses on conflicts, a red gate or a missing gate. Then it fast-forwards the main branch, pushes only when the push policy allows, and logs the attempt in `~/.aisquad/merges/<floor>.jsonl`. Failures appear in Attention. **Floor Settings → Merges** shows the policy, branches ready to merge (with **Merge now**) and the last merges. Automatic merges pause while free RAM is below the Watchdog limit.

### Several repositories

One squad = **one primary repository** (the Floor, `AISQUAD.md`, `docs/squad`, the board; the lead lives here) **plus linked repositories**, listed in `.claude/aisquad/repos.json` and shared through git:

```json
{ "version": 1, "repos": [
  { "id": "bukutamu", "path": "../dtamu-bukutamu", "remote": "git@github.com:org/dtamu-bukutamu.git", "access": "read" },
  { "id": "landing-page", "path": "../dtamu-landing-page", "access": "write", "agents": ["seo-writer"],
    "branch": { "strategy": "feature-branches", "main": "main" }, "gate": "npm test" } ] }
```

- **Paths are relative** to the primary repository; absolute paths are refused. On a machine where a repository lives elsewhere, **Relink** it in Floor settings (kept in `~/.aisquad/building.json`, never in the repository). Missing on a new machine: **Clone** from its remote.
- **read**: the agents get the folder with `--add-dir` for context, and every write there is denied at start time. That covers Edit, Write, MultiEdit and NotebookEdit on its path, and git writes through `git -C` or `cd … &&`. Change requests go into the module handoff for that repository's maintainer. With no agents listed, a read repository is context for everyone.
- **write**: only the listed agents edit and commit there, on their sprint branch. Never pushed.
- **Merges and gates per repository**: each write repository has its own quality gate, its own automatic-merge approval and its own merge log. It merges with the Floor's merge method.
- The lead plans for every repository and names the repository of each module in PLAN and TASKS. The Log records the repository of every tool call and commit (filter `repo=…`, or `repo=primary`), and the Audit has a per-repository table.
- In the UI:
  - Set up Squad → Folder: "+ Add linked repository" (a path or a clone URL, access, agents);
  - Floor settings → Repositories: status (branch, ahead/behind, uncommitted), Clone, Relink, approval;
  - the Desk's Profile and the name tag show an agent's repositories, and a name plate on the desk shows those it writes in.
- Changes apply when an agent next starts or resumes; running sessions keep what they started with.

### Squad Sprint

Choosing the Squad Sprint workflow scaffolds the optional pack into the project (existing files are never overwritten): `.claude/squad/config.sh` (sprint number, test command, team ids kept in sync with `team.json`), the `TaskCompleted` and `TeammateIdle` gate hooks (merged into `.claude/settings.json`), a `/sprint` command, and the `docs/squad` board (PLAN, TASKS, QUESTIONS, handoff, qa, bugs and templates including RELEASE). It also merges permission rules for the squad's normal work (edit and write files, `node`, the quality gate, the git commands it needs; deny `.env`, `git push`, `reset --hard`, `rm -rf`), because teammates run as background agents that cannot answer prompts. Use the **Sprint Lead**, **Sprint Developer** and **Sprint QA** templates (the wizard's **+ Squad Sprint team** adds them). The gate hooks are small Node scripts. Marking a BUILD, BUG or QA row DONE in `docs/squad/TASKS.md` is checked after every change to that file, whatever tool made it: rows that fail the gate are put back and the agent is told why. TaskCompleted runs the same checks for Claude Code versions with a team task list.

The Board tab reads `docs/squad/TASKS.md`. A sprint is closed when `sprint-<N>` has `docs/squad/sprint-<N>/RELEASE.md`, the closing commit `docs(squad): close sprint <N>` and a final QA report with `STATUS: PASS`, and the working tree is clean. The server then merges `sprint-<N>`; with **start the next sprint automatically** on, the lead gets a fresh session that runs `/sprint <N+1>`.

### Edit Mode

**Edit layout** on a Floor: drag desks and devices (whiteboard, printer, plants, coffee machine, bookshelf, sofa, server rack), rotate with Q / E, switch a desk between laptop and dual monitor, apply a layout preset, and change how agents look. **Save** writes `floor.json`.

### Watchdog

Checked every minute and shown in the Lobby:

- **Stall**: pending work while the lead and all agents are idle for 10 minutes, or an agent with assigned work idle for 10 minutes.
- **Resources**: free RAM below 1.5 GB, swap above 85 %, free disk below 5 GB.
- **Budget**: estimated from transcript token usage; warning at 80 %, Attention at 100 %.
- **Agents at once** (0.10): every Floor has its maximum (Floor settings, default 4) and the whole machine has one too (Menu → **Backups and health**, default 6). Starting one more asks first. The Desk shows each running agent's RAM and CPU: its Claude Code process and everything under it (MCP servers, shells, test runs). The averages and peaks per session are kept in `~/.aisquad/usage.json`; they tell how much memory one more agent needs.
- **Backups**: a failed or late nightly backup, or a backup that no longer reads back, is an Attention item.

### Backups and moving to another machine

`/aisquad backup` writes one file, `~/.aisquad/backups/aisquad-backup-<host>-<time>.tar.gz` (`--out` for another folder or file):

- `~/.aisquad` without caches and this machine's state: the Building registry, Role Templates, Blueprints, the Squad Log (`--no-logs` leaves it out), audits and improvements, attachments, settings. Left out on purpose: the voice cache, cloned template libraries (cloned again), running sessions, the independent agents scan, and auto-merge approvals (you approve again on the new machine).
- Each Floor's configuration (`.claude/aisquad/`, `AISQUAD.md`), in case it was never committed, and Claude Code's auto memory of each Floor.
- A manifest with a sha256 per file and, per Floor, its git remote, branch, commit and how many changes are not committed (the backup warns about them: repositories come back from git, so push your work).

Secrets (PIN, API keys) are only backed up encrypted: `--passphrase-env VAR` (or the passphrase saved in Backups and health) encrypts the file with AES-256-GCM as `.tar.gz.enc`, and `--with-secrets` adds them. Without a passphrase the file is a plain `.tar.gz` you can open with `tar`.

`/aisquad verify <file>` checks that every file reads back. `/aisquad restore <file> --dry-run` shows where every Floor goes; then, with the server stopped:

```
/aisquad restore aisquad-backup-old-box-20261026-023000.tar.gz --projects-dir ~/projects     # new machine, projects in ~/projects
/aisquad restore <file> --relink /home/old/projects=/home/new/code                           # map an old folder to a new one
/aisquad restore <file> --force                                                              # over a ~/.aisquad in use (kept as ~/.aisquad.before-restore-<time>)
```

Floors missing on the new machine are cloned from their remote (`--no-clone` to skip), a Floor without its configuration gets it from the backup, auto memory lands under the Floor's new path, the data is migrated, and `doctor` runs at the end.

**Nightly backups** (Menu → Backups and health): on at a time you pick, the newest N kept, into `~/.aisquad/backups` or a folder you choose (a synced folder or a USB disk keeps it off the machine). Once a month the newest backup is read back. With a saved passphrase (`~/.aisquad/backup-passphrase`, mode 600, never backed up itself) they are encrypted.

**Data versions**: `~/.aisquad/schema.json` records which version the files follow. A newer release migrates them when the server starts, after a safety backup (`…-pre-migrate-v<N>.tar.gz`, without secrets).

### Log and Audit

**Squad Log.** Everything a squad does is recorded on this machine in `~/.aisquad/logs/<floor-id>/<YYYY-MM-DD>.jsonl`, one JSON event per line, never in the project repository: agents starting and stopping (configured and observed model), tasks from you, board changes, handoffs, QA reports, bugs, gates, merges, sprints, source document status, commits, every message between agents, questions to you and how long they waited, permission prompts, every tool call (tool, target path or command, duration, success; never file contents), the tokens and estimated cost of every reply, and idle time while work was open. Floor 1 logs under `independents`. Every event has a one-line `summary` so an AI (or you) can scan it quickly; the schema with an example per event is in [`docs/LOG-SCHEMA.md`](docs/LOG-SCHEMA.md).

- Secrets are always removed (API keys, tokens, passwords in URLs, private keys, `PASSWORD=...` style values) and personal data is masked by default (e-mail, phone, national id and bank account numbers); `.env` content and file contents are never logged.
- **Floor settings → Squad Log and Audit**: turn off logging of message text (metadata only) or the masking of personal data.
- Day files are gzipped after 7 days and deleted after `logRetentionDays` (default 90; `prefs.logRetentionDays` in `~/.aisquad/building.json`).
- The **Log** dock button opens the timeline (filter by agent, type, sprint and time) and the **Conversation** view: who talked to whom, in order. `GET /api/floors/<id>/log?from=&to=&type=&agent=` returns the events (PIN).

**Audit.** The **Audit** dock button, `/aisquad audit [floor] [--sprint N]`, or (on by default for Squad Sprint Floors) the end of every sprint runs an audit:

1. `server/audit.js` turns the sprint, or the time since the last audit, into a compact digest: process metrics (source documents approved before the first sprint, handoffs, QA before merge, first-round pass rate, bugs per story point, parallel work, questions and their wait, refused gates, rework) and efficiency metrics (cost and tokens per story point, per module and per agent, cache hit rate, cost by model, files read again and again, failed tool calls, long outputs, idle time with open work, time blocked on you, an expensive model on docs-only work), plus the most relevant events.
2. `claude -p` (Sonnet by default, Floor setting) reviews the digest with the bundled `squad-audit` skill and answers with findings: area, severity, evidence (event refs and metric names) and a recommendation, often with a target (a Role Template, the Blueprint or a Floor setting) and a concrete change.
3. The result goes to `~/.aisquad/audits/<floor-id>/<timestamp>.json` and a readable `.md`. The Audit dialog shows the scores per area, the findings by severity with evidence links into the Log, the audit's own cost, and the history with trends (cost per story point, pass rate, cache hit rate).

**Improvement loop.** **Review change** on a finding shows the proposed change as a diff. **Apply** saves it as a new Role Template version (Floors using it show *Update available*), a new Blueprint version with a *Lessons from audits* section (Floors following it show an **Update** in the Standard tab), or changes the Floor setting. **Dismiss** asks why. Every decision goes to `~/.aisquad/improvements.jsonl` with the metrics before, and after the next audit, so you can see which changes helped. `/aisquad audit export` writes an anonymised bundle (metrics, findings and decisions; no message text; paths and ids as salted hashes) to `~/.aisquad/exports/` that you may send to Sopwer; nothing is uploaded automatically.

## Files

```
<repo>/.claude/aisquad/floor.json          name, goal, workflow, layout, desks, devices, budget
<repo>/.claude/aisquad/team.json           agents: id, displayName, role {template, version}, overrides, appearance
<repo>/.claude/aisquad/git.json            branch strategy, merge policy, quality gate, commit rules
<repo>/.claude/aisquad/roles.lock/<role>@<version>.md   snapshot of every template version in use
<repo>/.claude/agents/<agent-id>.md        generated Claude Code agent file (do not edit by hand)
<repo>/.claude/aisquad/blueprint.md        the Squad Blueprint this Floor follows (snapshot)
<repo>/.claude/skills/<name>/SKILL.md      skills installed from the plugin
<repo>/AISQUAD.md                          project brief, goal, team and the squad standard
~/.aisquad/building.json                   Floors on this machine (absolute paths live only here)
~/.aisquad/roles/<role>.md                 local Role Template library (+ .history/ for old versions)
~/.aisquad/libraries.json                  optional extra template libraries
~/.aisquad/pin                             local PIN (0600)
~/.aisquad/runtime.json                    work given to agents, how each session was started
~/.aisquad/approvals.json                  one-time auto-merge approval per Floor
~/.aisquad/merges/<floor>.jsonl            merge log
~/.aisquad/libraries/<name>/               clones of git template libraries
~/.aisquad/attachments/                    files attached to tasks (outside every repo)
~/.aisquad/blueprints/<id>/                local Squad Blueprint library
~/.aisquad/independents.json               independent agents found by the scan (stable ids, adoptions)
~/.aisquad/logs/<floor>/<day>.jsonl        Squad Log (gzipped after 7 days, see docs/LOG-SCHEMA.md)
~/.aisquad/audits/<floor>/<time>.json|.md  audits
~/.aisquad/improvements.jsonl              improvement ledger: decisions on audit findings, metrics before and after
~/.aisquad/exports/                        anonymised audit exports (written only by /aisquad audit export)
~/.aisquad/company/                        Company Brain (default location; read-only for agents)
~/.aisquad/history/<id>.json               configuration changes with before and after (Admin → Changes)
~/.aisquad/queue.json                      the dispatcher's queue (survives a restart)
~/.aisquad/users.json                      people: name, role, scrypt hash of their PIN (0600)
~/.aisquad/notify.json                     paired Telegram chats, what was sent, open buttons (0600)
~/.aisquad/insights/                       Daily Insight reports, the Improvement Inbox, decisions
~/.aisquad/chats/                          General chats and the state of every chat thread
~/.aisquad/general/<space>--<agent>/       the neutral folder of an agent's General chat
<repo>/docs/squad/chats/<agent>.jsonl      direct chat with an agent in this Space
<repo>/docs/squad/DIRECT.md                the lead's note of direct messages
~/.aisquad/quota.json                      rate-limit signals the quota guard keeps until they reset
<repo>/.claude/aisquad/memory/             a Space's Claude Code memory when memory is "In the Space"
~/.aisquad/nodes.json                      worker machines: name, token hash, last heartbeat (0600)
~/.aisquad/worker/repos/<space>/           on a worker: its clone of each Space's repository
~/.aisquad/handoffs.json                   packages between Spaces (the last 500)
~/.aisquad/erpnext.json                    the ERPNext watcher: pipeline cursors, approvals, alerts
~/.aisquad/erpnext/mcp.json                the MCP configuration for ERPNext (variables only, no secrets)
<repo>/docs/squad/handoffs/                outbox/ (agents write), sent/ (copies), inbox/ (delivered)
~/.aisquad/legal.json                      fingerprints of the contracts the Owner approved, revisions, alerts
<repo>/contracts/                          a Legal Space's contracts (STATUS: DRAFT / READY FOR REVIEW / APPROVED)
~/.config/systemd/user/aisquad.service     the server as a user service (generated by /aisquad)
```

Floor and team configuration is meant to be committed, so the whole team shares it. No secrets, personal data or absolute paths are written to the repository, and agents are told never to read `.env` files.

## Develop

```
npm test                         # node --test, all modules, one at a time
node scripts/seed-playground.js  # scratch Building with three Floors under ./playground
scripts/dev.sh start             # dev server on :8097 (AISQUAD_PORT=8096 for another port) against the playground (PIN 123456)
node scripts/shot.js shots.json  # headless Chrome screenshots: [{ url, out, w, h, pin?, eval? }]
scripts/acceptance.sh            # visual acceptance: every agent state, Lobby / Floor / Floor 1 / Desk / Set up Squad
                                 # at 1440x900 and 390x844 into playground/reference/after-*.png
```

`AISQUAD_HOME`, `CLAUDE_HOME`, `AISQUAD_TMUX_SOCKET`, `CLAUDE_BIN` and `AISQUAD_NO_SYSTEMD=1` point the server at scratch directories, a private tmux server (per-agent servers become `<socket>--aisquad-<floor>-<agent>`) and a fake Claude Code (`test/fixtures/fake-claude.cjs`), which is how the tests run. `AISQUAD_SCAN_TMUX_SOCKET` and `AISQUAD_PROC` point the independent-agent scan at another tmux server and a fake `/proc`; `AISQUAD_SERVICE=detached` skips the systemd user service.

```
server/   building, floors, roles, compose (overrides), transcripts, tmux, watchdog, squad (live state), api,
          blueprints, recommend, setup (Set up Squad), independents (Floor 1), skills, performance, meter, service,
          log + collect + redact (Squad Log), audit, improve (improvement loop)
ui/       index.html, app.js (routing, panels), scene.js (3D), chibi.js, props.js, screens.js, views.js, wizard.js, setup.js,
          templates.js, dialogs.js, edit.js, perf.js, meter.js, shout.js, independents.js, log.js, audit.js, improve.js
templates/roles/        default Role Templates
templates/blueprints/   Squad Blueprints (blueprint.md + pack/)
skills/                 built-in skills (SKILL.md)
bin/aisquad.js     command line used by /aisquad
commands/aisquad.md   the Claude Code command
```

## License

Apache License 2.0 (`LICENSE`, `NOTICE`; every source file carries `SPDX-License-Identifier: Apache-2.0`).
Contributions are welcome under the Developer Certificate of Origin (`CONTRIBUTING.md`); report security
problems privately (`SECURITY.md`). How Claude usage is billed and which sign-in to use for unattended work:
`docs/BILLING.md`.

Apache License 2.0. Free for personal and commercial use, as long as you keep the
`LICENSE` and `NOTICE` files and credit the original source:
https://github.com/xhijack/AI-Squad. See `NOTICE` for bundled third-party code.
