# The AI Squad

The AI Squad turns a machine running Claude Code into a 3D **Building**. Every project directory is a **Floor**, every Floor has a **Team** of **Agents**, and you form, run and watch those teams from the browser.

- **Lobby**: the whole Building as a stacked dollhouse, a card per Floor with status lamp and today's cost, everything that needs you (**Attention**), and projects with Claude Code activity that are not Floors yet.
- **Floor**: a 3D office with a desk per agent (working, idle, waiting, stopped), the team panel, an activity feed, messages between agents, and a board when the Floor uses the Squad Sprint workflow.
- **Desk**: one agent: send a task (with attachments), answer its questions and permission prompts, its live terminal screen, transcript and profile (role, template version, overrides, skills, model), start and stop.

Agents are Claude Code sessions in tmux, created from **Role Templates** with per-agent **overrides**. A **Squad Blueprint** turns a group of agents into a team: it sets the roles, the source documents every agent works from, who talks to whom, the gates and the definition of done. Blueprints ship for a Software House, Digital Marketing and Sales & CRM, with 19 Role Templates and 25 built-in skills.

Floor 1 shows the **independent agents** already running on your machine (terminal, tmux, VS Code); squads start at Floor 2.

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

### Graphics quality

Menu → **Graphics**: **Auto** (default: High, and Low when frames get slow), **High** (soft image-based light from a small studio HDRI, ambient occlusion, warm colour grading with a light vignette, SMAA, soft shadows under the characters) or **Low** (one render pass, as fast as before). The setting is kept per browser. The frame loop slows to a third of its rate when nothing moves: no input, no camera move, nobody walking.

### Merges

Merges are done by The AI Squad server, never by an agent (decision D3). The policy lives in `git.json` (merge policy, squash or merge commit, quality gate, push policy); the one-time approval per Floor is stored on this machine in `~/.aisquad/approvals.json`, never in the repo.

For each branch with finished work (an agent's branch once its task is done and it is idle; feature branches once nobody has open work; a closed sprint branch) the server merges in a temporary worktree, runs the quality gate on the merged result, and refuses on conflicts, a red gate or a missing gate. Then it fast-forwards the main branch, pushes only when the push policy allows, and logs the attempt in `~/.aisquad/merges/<floor>.jsonl`. Failures appear in Attention. **Floor Settings → Merges** shows the policy, branches ready to merge (with **Merge now**) and the last merges. Automatic merges pause while free RAM is below the Watchdog limit.

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

Apache License 2.0. Free for personal and commercial use, as long as you keep the
`LICENSE` and `NOTICE` files and credit the original source:
https://github.com/xhijack/AI-Squad. See `NOTICE` for bundled third-party code.
