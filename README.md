# The AI Squad

The AI Squad turns a machine running Claude Code into a 3D **Building**. Every project directory is a **Floor**, every Floor has a **Team** of **Agents**, and you form, run and watch those teams from the browser.

- **Lobby**: the whole Building as a stacked dollhouse, a card per Floor with status lamp and today's cost, everything that needs you (**Attention**), and projects with Claude Code activity that are not Floors yet.
- **Floor**: a 3D office with a desk per agent (working, idle, waiting, stopped), the team panel, an activity feed, messages between agents, and a board when the Floor uses the Squad Sprint workflow.
- **Desk**: one agent: send a task (with attachments), answer its questions and permission prompts, its live terminal screen, transcript and profile (role, template version, overrides, skills, model), start and stop.

Agents are Claude Code sessions in tmux, created from **Role Templates** with per-agent **overrides**. Six templates ship with the plugin: Project Manager, Frappe Developer, Fullstack Developer, QA Engineer, UI/UX Designer and SEO Specialist.

## Requirements

- Node.js 22 or newer (no npm packages needed: the server has zero dependencies)
- Claude Code (`claude` on the PATH, or next to the `node` binary as with nvm)
- tmux; on Linux, systemd (user services) keeps the server and agents running after the terminal that started them closes
- A browser with WebGL. three.js 0.160.0 is vendored in `ui/vendor/three`, so the UI works offline.

## Install

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

Your Floors and their repositories are not touched. To remove The AI Squad's machine-local data as well (Building registry, Role Template library, PIN, logs), delete `~/.aisquad`. Agents that are still running stay in tmux: stop them on their Desks first, or with `tmux kill-session -t aisquad-<floor>-<agent>`.

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
~/.aisquad/runtime.json                    work given to agents, how each session was started
~/.aisquad/approvals.json                  one-time auto-merge approval per Floor
~/.aisquad/merges/<floor>.jsonl            merge log
~/.aisquad/libraries/<name>/               clones of git template libraries
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

## License

Apache License 2.0. Free for personal and commercial use, as long as you keep the
`LICENSE` and `NOTICE` files and credit the original source:
https://github.com/xhijack/AI-Squad. See `NOTICE` for bundled third-party code.
