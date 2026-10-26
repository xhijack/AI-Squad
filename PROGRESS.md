# Progress: The AI Squad MVP

Status on 26 Oct 2026: the seven MVP steps from `SPEC.md`, the five Phase 1.1 decisions, the five Phase 1.2 items, Phase 2 (parts A to F of `PHASE-2.md`), the Phase 2.1 visual rebuild (`PHASE-2.1-VISUAL.md`) and the Phase 2.2 Squad Log and Audit (`PHASE-2.2-LOG-AUDIT.md`) are built and committed in small Conventional Commits. `npm test` runs 156 tests in 26 modules and all pass. The tests are run one module at a time (`npm test` now does that too) because of memory pressure on the machine.

## What works

1. **Server core** (`server/`, zero dependencies)
   - `building.json` registry: Floor ids, numbers (moving onto a taken number swaps the two), register and unregister.
   - Floor files in the repo: `floor.json`, `team.json`, `git.json`, `roles.lock/`, `AISQUAD.md` (its team table is kept up to date), and generated `.claude/agents/<id>.md`. The repo files contain no absolute paths. Hand-written agent files are never deleted.
   - Role Templates: the local library in `~/.aisquad/roles` holds the six default templates. Extra libraries are read-only. Every content change bumps the version and the old text goes to `.history`.
   - Template + override inheritance exactly as the spec table says. Permissions can only get stricter; anything looser is rejected.
   - Update available: line diff, then Update / Keep current / Detach per agent. Unused lock files are pruned.
   - Discovery of projects with Claude Code activity. Agent status comes from transcripts (`agent-setting`, `subagents/*.meta.json`, teams), together with open AskUserQuestion calls, the activity feed, messages between agents, and a cost estimate.
   - Local PIN (0600) for every change and for agent screens.
2. **3D UI** (`ui/`): Lobby (stacked dollhouse, floor cards, Attention, Detected), Floor (team, activity, messages, sprint board), Desk (task with attachments, Attention, live screen, transcript, profile), and the elevator. The camera fits the area not covered by panels. Phones get a bottom sheet. Checked with headless Chrome screenshots at 1440x900 and 390x844.
3. **New Floor wizard** (existing / new with `git init` / clone) and **Role Template editor** (create, edit as a new version, version diffs). Also add and edit agent with overrides, and Floor settings.
4. **Agents**: start and stop in tmux `aisquad-<floor>-<agent>` through `systemd-run --user --scope`, falling back to plain tmux. Tasks are typed only when no dialog is open: `send-keys -l`, then Enter, then a check that the text left the input box. Tasks are queued while Claude Code starts. Numbered and unnumbered dialogs reach Attention and are answered with arrow keys.
   - Verified once against real Claude Code v2.1.309 with a haiku agent: trust dialog parsed and answered, task typed, `end_turn` gave idle and "work done", `--effort` applied, stop worked. The artifacts of that run were removed afterwards.
5. **Edit Mode**: drag desks and devices, rotate them, add or remove devices, switch a desk between laptop and dual monitor, apply layout presets, and change appearance. Changes preview live and are saved to `floor.json` (looks go to `team.json`).
6. **Watchdog**: a server tick every minute.
   - Stalls: the whole Floor, or a single agent.
   - Machine resources: RAM below 1.5 GB, swap above 85 %, disk below 5 GB.
   - Budget: warning at 80 %, Attention at 100 %.
   - Each alert keeps its first-seen time and is logged once. `GET /api/watchdog` returns the summary.
7. **Plugin**: `.claude-plugin/` (manifest, marketplace entry, icon) and `commands/aisquad.md`, which runs `bin/aisquad.js` (start + open the browser, `new-floor`, `status`, `stop`). `claude plugin validate .` passes. `/aisquad:aisquad status` was checked in `claude -p`. README.md is written.

## Phase 1.1 (24 Oct 2026)

1. **Auto-merge executor (D3, on by default)** — `server/merge.js`. The server merges, never an agent. A one-time approval per Floor is stored in `~/.aisquad/approvals.json`, not in the repo.
   - Each merge happens in a temporary worktree, and the quality gate runs on the merged result.
   - It refuses on conflicts, a red gate, a missing gate (for automatic merges) or a dirty main checkout.
   - Squash or merge commit, depending on `git.json mergeMethod`. Main is fast-forwarded, or updated by compare-and-swap when it is not checked out.
   - It pushes only if the push policy allows.
   - Every attempt goes to `~/.aisquad/merges/<floor>.jsonl`; failures, including failed pushes, show up in Attention and can be dismissed.
   - The tick runs every minute. It merges the finished work of idle agents (agent branches) and feature branches once nobody has open work. Each branch tip is tried once; **Merge now** retries.
   - Floor Settings shows the policy, the approval, branches ready to merge and the last merges.
2. **Squad Sprint pack (D4)**.
   - Role Templates `sprint-lead`, `sprint-developer`, `sprint-qa`: an English, project-agnostic port of dtamu-app's pm/developer/qa.
   - `templates/squad-sprint/` is scaffolded when a Floor picks squad-sprint, and never overwrites existing files. It contains:
     - `config.sh` with the team ids kept in sync with `team.json`;
     - the TaskCompleted and TeammateIdle hooks, merged into `.claude/settings.json`;
     - the `/sprint` command;
     - the `docs/squad` PLAN, TASKS and QUESTIONS files plus the handoff, qa-report, bug and RELEASE templates.
   - The Board tab reads `TASKS.md`.
   - A closed sprint has a RELEASE.md and the closing commit on `sprint-<N>`, a clean tree, and `FINAL-S<N>.md` with PASS. The server merges it, and if the Floor enables it, stops the lead and starts a fresh session with `/sprint <N+1>`.
   - In Phase 1.1 the hooks were bash + `jq` (replaced by Node in Phase 1.2). The close → merge → next-sprint flow is tested with the fake Claude.
3. **Shared template libraries**: `libraries.json` entries may be git URLs, with an optional ref and subdir.
   - They are shallow-cloned into `~/.aisquad/libraries/<name>` and pulled on demand. They are read-only: the cache is reset on every pull.
   - The library's commit is shown as its version.
   - The editor has a Libraries view and "Copy to local library".
4. **PIN for every read off loopback**: when the server is bound to a non-loopback address, every `/api` call needs the PIN. The UI sends the PIN on reads and asks for it on a 401. The CLI sends it too.
5. **Model display (the "opus (claude-sonnet-5-5)" report)**: this was not a parsing bug. The Desk printed the configured model next to the model of the latest transcript reply, with no hint that they disagreed. Now:
   - Start passes `--model` (and `--effort`) explicitly.
   - Each session's start configuration is remembered.
   - The Desk shows the configured, started-with and observed models separately. It warns when the model family differs and offers "Restart", and suggests a restart when the configuration changed after the session started.
   - The team list shows a "model differs" chip.

## Phase 1.2 (24 Oct 2026)

1. **Hook event stream**:
   - `hooks/hooks.json` + `hooks/event.js` cover SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Notification, Stop and SubagentStop. Each posts a trimmed event to `/api/events` with the local PIN. The script prints nothing, always exits 0, gives up after 1.5 s, and is skipped silently when the server or the PIN is missing.
   - Agents start with `--plugin-dir <plugin>` and `AISQUAD_AGENT/URL/HOME`, so events are attributed exactly without installing the plugin into the user's Claude config.
   - The server merges hook state with transcripts and the screen: working, idle, waiting on a permission prompt (from Notification, with the tool and its input), and live activity. The UI shows a "live" badge.
   - The Squad Sprint gate hooks are rewritten in Node (`.cjs`, no jq). Older bash entries in `.claude/settings.json` are replaced.
2. **Per-agent commit identity**: with `commitIdentity: per-agent`, agents start with `GIT_AUTHOR_*` and `GIT_COMMITTER_*`. These come from the agent's `git` block in team.json, or from its display name and the `agentEmail` template in git.json (`{id}@agents.aisquad.local`).
3. **Richer 3D** (ported from squad-3d):
   - **Desk screens** are canvas textures: a window of the real file around the latest edit (edited lines highlighted), the last command with its output, the latest QA screenshot on QA desks, the question when an agent waits, a clock when idle.
   - **Lounge life**: idle agents walk to the sofa, coffee machine, whiteboard or bookshelf and run back when work arrives. Name tags follow them and say where they are.
   - **Screen view**: clicking a monitor opens a tight view from the agent's shoulders with its live tmux screen.
   - **Layout**: the lounge (rug + sofa) is part of the default devices, Edit Mode and the layout presets.
4. **three.js vendored**: 0.160.0 is in `ui/vendor/three`, copied unchanged from the npm tarball after checking its sha512. The UI rendered fully with Chrome blocked from every host but 127.0.0.1.
5. **Dogfood with real Claude Code**: one Squad Sprint in `playground/real/adder` with a Sprint Lead, a developer and QA, all on haiku. The task was a zero-dependency `add.js` CLI with `node --test` tests and a README.
   - **Result**:
     - The lead planned the sprint (PLAN, TASKS, branch `sprint-1`) and spawned both teammates.
     - Dani built M01 with a handoff, and Quinn wrote the QA report and `FINAL-S1.md` with PASS.
     - The lead committed `feat(cli)` and `docs(squad): close sprint 1`.
     - The server saw the sprint closed (all five checks), ran `node --test` (13/13) on the merged result and squash-merged `sprint-1` into main.
     - Because "next sprint" was on, it restarted the lead fresh with `/sprint 2`. The lead set SPRINT=2 and started `sprint-2`, with no backlog yet.
     - The TeammateIdle Node gate held QA back once ("Handed-off modules without a QA report: M01").
     - Sprint 1 took about 4 minutes once the fixes were in.
   - **Cost**: about **$0.19**, estimated from transcript usage. That is the Floor's $0.155 (lead $0.082, developer $0.036, QA $0.030, a helper subagent $0.007, including the aborted first attempt) plus $0.033 for permission probes.
   - **What broke** (all fixed in the item 5 commit):
     - New projects had no commit, so `main` did not exist. The wizard now commits the scaffold.
     - Deny rules such as `Bash(git push*)` in the agent file frontmatter removed the whole Bash tool, so the lead had no shell. Only whole tool names go there now; pattern rules are passed with `--disallowedTools`, which honours them (checked with probes).
     - The teammates' Writes failed: "the auto mode classifier gave no verdict", because background agents cannot be classified. The pack now merges permission allow/deny rules into `.claude/settings.json`, like dtamu-app's setup.
     - Stopping an agent left Claude Code running after tmux hung up. Stop now ends the pane processes (TERM, then KILL).
     - Teammates could not reach the lead by its agent id; `main` works. This is now in the templates (sprint templates v2; shipped default templates now upgrade local copies the user has not edited).
     - SubagentStop was not credited to the teammate, and teammates inside the lead's session showed as "stopped".
     - The haiku lead never used the team task list, so the TaskCompleted gate did not run. The lead template now requires TaskCreate/TaskUpdate.
   - **Also seen** (by design): the merge waited about a minute because the Watchdog pauses automatic merges while free RAM is below 1.5 GB.
   - **Cleanup**: all sessions were stopped. No Claude, tmux or server process is left, and this run's transcripts were removed from `~/.claude/projects`. The `playground/real/adder` repository is kept (gitignored) for inspection.

## Phase 1.2 follow-up: TaskCompleted gate re-check (24 Oct 2026)

Re-ran the same dogfood sprint three times with real Claude Code (haiku, same playground, same tiny task). The full flow completed every time in about 3 minutes: plan, build, QA, close, server squash merge after `node --test`, next sprint.

**What we found**:
- **The TaskCompleted gate cannot fire with Claude Code 2.1.310.** The TaskCreate/TaskUpdate tools don't exist in these sessions: the lead searched for them and got "Team task tools aren't in this session". The teammates are background agents, not a team with a shared task list. The board in `docs/squad/TASKS.md` is the only task list the squad has.
- **A PreToolUse gate on Edit/Write wasn't enough.** In run 3 the haiku lead changed TASKS.md only through Bash (`sed -i`, `cat > … <<EOF`): 30 Bash calls, no Edit or Write. So that first board gate never ran.
- **The next sprint cut the lead off mid-turn.** The server restarted the lead the moment the merge finished, while the lead was still sending close-out messages to its teammates. That killed one of our running event hooks (Claude Code logged a non-blocking hook error, exit 1).

**Fixes**:
- **Board gate** (`.claude/hooks/board-gate.cjs`, PostToolUse on Edit|Write|MultiEdit|Bash). After every change to TASKS.md, with any tool, rows newly marked DONE get the same checks as TaskCompleted. The check logic now lives in one shared function, `checkTask`. Failing rows are put back to their previous status (new rows go to TODO), and the agent gets the reason (exit 2). The last accepted board is kept in `.git/aisquad-board-snapshot.md`, so the working tree never gets dirty; the first baseline is the committed board. TaskCompleted stays for Claude Code versions that have the team task list.
- **Next sprint waits for the lead.** After a sprint merge the server records the pending next sprint and restarts the lead only once its turn has ended (a later tick if needed).
- **Templates v3.** The sprint templates now describe the board gate instead of requiring TaskCreate/TaskUpdate (mirroring the board in the task list is optional, when those tools exist).

**Verified in run 4**:
- The board gate ran on the real team's edits: `Edit accepted BUILD M01 Adder CLI` (handoff present, tests green), then `QA M01`.
- The merge finished while the lead was still working; the next sprint started about a minute later, once the lead was idle.
- There were no hook errors.
- The team's work passed the gate, so nothing was put back. The put-back path is tested with the real hook script, not observed live.

**Cost** (estimated from transcript usage): run 2 $0.074, run 3 $0.082, run 4 $0.085, about **$0.24** in total. All sessions were stopped, no Claude, tmux or server process is left, and the runs' transcripts were removed from `~/.claude/projects`.

## Phase 2 (25 Oct 2026)

Built in the order of `PHASE-2.md`, one commit per step. Decisions on ambiguous points are in `QUESTIONS.md`.

### A. squad-3d parity
1. **First person view**:
   - Clicking a character's body moves the camera to its eyes (`#/floor/<id>/desk/<agent>/eyes`). Drag to look around, scroll to zoom, Esc returns to the Floor.
   - The name tag opens the desk.
   - The top bar and the dock are hidden in this view and in the screen view, and a small bar offers Desk and Back.
2. **Desk props** (`ui/props.js`):
   - Every desk gets a keyboard with keys, a mouse and a mug in the agent's colour, plus up to two toys: lead trophy + cactus; developers rubik, duck or robot; QA ladybug + magnifier.
   - The laptop shows the role screen: the code window for developers, a test runner (pass/fail counts from the output) or the latest screenshot for QA, and a mini board for the lead (the sprint board, or team states on Free Team Floors).
   - `appearance.props` and `appearance.screen` in a Role Template set these per role.
3. **Performance dialog** (`server/performance.js`, Squad Sprint Floors only, from the dock). Per agent and per sprint, read from `docs/squad` (PLAN, TASKS, qa/, bugs/ and the `sprint-<N>` archives):
   - QA bugs per story point, weighted Blocker 5 / Major 3 / Minor 1 / Cosmetic 0.5;
   - first-round QA pass rate;
   - modules owned;
   - cost per story point. Transcript cost is split by sprint windows taken from the closing commits.
   - QA agents get bugs found per story point.
4. **Cost projection** in the same dialog: cost per done story point × (open stories in `docs/BACKLOG.md` + the rest of the running sprint). PLAN.md has an `SP` column; Sprint Lead v4 asks for story points.
5. **Lead shout**: when the lead runs and nobody on the Floor in view has worked or waited for 20 s, the lead shows "Boss! We are idle..." and, with voice on, says it with `speechSynthesis`. It repeats every 2 to 3 minutes, at most 6 times per idle period. The voice toggle is in the dock.
6. **Server meter** (`server/meter.js`):
   - `/proc` is sampled every 3 s, with 6 minutes of history.
   - Dock chip with CPU / RAM / swap / disk, red when dangerous.
   - The dialog has the graph, process groups and the busiest processes. Only process names are shown; command lines never leave the module.
   - A server rack stands in the Lobby corner and in new Floors. Its LED columns follow CPU and RAM, and clicking it opens the meter.

### B. Install
- The repository is a plugin marketplace named `aisquad`: `/plugin marketplace add xhijack/AI-Squad`, then `/plugin install aisquad@aisquad`. License metadata is Apache-2.0.
- `/aisquad` runs the server as a systemd user service (`server/service.js`):
  - `aisquad.service` is generated from the plugin's current path and `node` binary, with `Restart=always`.
  - `KillMode=process`, so stopping the service never kills agents.
  - A moved or updated plugin rewrites the unit and restarts it ("Updated and restarted").
  - Fallbacks: a launchd agent on macOS, a detached process elsewhere.
- `/aisquad stop`, `/aisquad status` (service state and lingering) and the new `/aisquad uninstall` cover the rest.
- The README has Install, Update, Contributors and Uninstall sections with these exact steps.

### C. First-run scan and independent agents
- Floor 1 is reserved. Squads start at Floor 2, and older Floors move up from 1 when the Building loads (order kept).
- `server/independents.js` finds:
  - live interactive `claude` processes;
  - tmux panes running `claude`;
  - projects with transcripts from the last 24 hours.
- It skips sessions The AI Squad started and `claude -p` runs.
- Each agent gets a desk on Floor 1 with live status, screen (tmux), transcript and Attention. tmux dialogs can be answered from the browser.
- Ids stay stable in `~/.aisquad/independents.json`; nothing is written into their repositories.
- **Rescan** is on Floor 1 and on its Lobby card. **Adopt** adds the agent to a squad's team.

### D. Set up Squad
A big button in the Lobby (and in the menu) opens a four-step wizard:
1. **What**: a prompt and Blueprint cards. The recommendation uses `claude -p --model haiku --tools "" --json-schema …`, with keyword matching as the fallback. Every agent shows why it is there.
2. **Team**: editable. "Add agent" opens the catalog, filterable by category and skill.
3. **Folder**: an existing repository, or a new folder `~/aisquad-squads/<slug>` with `git init` (`squadsDir` in `building.json`).
4. **Review and create**: the next free Floor (2+), all files, and the lead started on request.

Ten new Role Templates: DevOps Engineer, Marketing Strategist, Content Writer, Social Media Specialist, Ads & Analytics Specialist, Sales Manager, Lead Researcher, CRM Administrator, Sales Copywriter and Sales Analyst.

### E. Squad Blueprints
- Software House, Digital Marketing and Sales & CRM are defined in `templates/blueprints/<id>/blueprint.md` (+ `pack/`) and seeded into `~/.aisquad/blueprints/` like Role Templates.
- Each one defines: roles with min/default/max counts, the lead, the source documents, the channels, work items, handoff format, gates, definition of done, rules per role and the lead's kickoff.
- Creating a squad:
  - snapshots the Blueprint into `.claude/aisquad/blueprint.md`;
  - copies the workflow pack (document skeletons with `STATUS: DRAFT`, board, questions file, handoff template; nothing is overwritten);
  - turns on agent teams with allow rules for background teammates;
  - writes the standard into `AISQUAD.md` and into every agent prompt, with each role's own rules.
- The Floor shows the Blueprint and the status of every source document. Marketing and Sales squads get a Board from `docs/BOARD.md`.
- `/sprint` refuses to start while a source document is not approved.

### F. Built-in skills
- 25 skills written by us in `skills/<name>/SKILL.md` cover the minimum set in the brief, for every role.
- Every Role Template lists its skills. Shipped templates got a new version with skills, category and props.
- Agent files use `aisquad:<name>` while a skill only comes from the plugin, and its own name once installed.
- The Desk profile shows each skill as in project / in user skills / from plugin / not installed, with Install and Install all. Install copies into `.claude/skills/` and never overwrites.

### Verified
- **Tests**: 127 tests in 21 modules, run one module at a time; all pass. New modules: performance, meter, service, independents, blueprints, skills, shout.
  - The independents test uses a real tmux pane with the fake Claude Code on the private socket and answers its dialog through Attention.
  - The service test records `systemctl` calls; it never touches the machine.
- **Headless Chrome** (one at a time, 1280 px wide, plus 390 px for the dock):
  - first person view (looking ahead and turned);
  - screen view without the top bar;
  - desk props on lead, developer and QA desks;
  - the Performance dialog with projection;
  - the lead's shout bubble (fake Claude Code as lead);
  - server meter chip, dialog and Lobby rack;
  - Floor 1 with real detected agents and the Adopt dialog;
  - all Set up Squad steps;
  - a Digital Marketing squad with source document status and Board;
  - a Desk profile before and after installing a skill.
- **Real Claude Code** (2.1.310, haiku):
  - **Recommendation**: "I want a software house that builds my restaurant POS" gave Software House with a PM lead, 2 developers, QA and a designer, each with a reason. It took 12.7 s.
  - **Dogfood**: a Software House squad with the PM on haiku, started with the Blueprint kickoff.
    - The new trust dialog (default "No, exit", because the folder pre-approves permissions) reached Attention and was answered with option 2.
    - The lead read `AISQUAD.md`, saw all four source documents still DRAFT, refused to start a sprint, listed what it needs per document and started the interview with an AskUserQuestion ("MVP scope"). That question appeared in Attention with its options.
    - The Floor showed the four documents as `draft`.
    - Cost about $0.01. The session was stopped and this run's transcripts removed from `~/.claude/projects`.
- **Real machine scan**: Floor 1 found the two VS Code sessions, this tmux session (working) and a transcript-only project.
- **Plugin**: `claude plugin validate .` passes (one warning: CLAUDE.md at the plugin root is for contributors).

### Known gaps (Phase 2)
- **Service on a real login is not verified.** Installing `aisquad.service` was blocked here, so only the unit tests cover it. launchd is untested (no macOS).
- **Independent agents**:
  - several processes in the same folder share that folder's newest transcript for status;
  - VS Code and plain terminal sessions have no live screen, and their questions are answered in their own window;
  - Adopt does not move the running session.
- **Source document gate**: no hook blocks work while documents are unapproved. The rules, the Blueprint text and `/sprint` do it.
- **Marketing and Sales squads** were only dogfooded through creation, not with a real team run. They rely on Claude Code's experimental agent teams.
- **Performance** depends on the documented conventions: the `SP` column, `OWNER` and `SEVERITY` in bug files, `Round` and `Tester` in QA reports, and closing commits. Costs are estimates.
- **Lead shout** runs in the browser that has the Floor open; speech needs a browser with `speechSynthesis` and an earlier click on the page.
- **Server meter** needs `/proc` (Linux). In headless screenshots CPU shows high because Chrome renders with SwiftShader.
- **Template updates**: Floors created before Phase 2 show "Update available" for their agents (new template versions with skills).
- **Floor 1** has no layout editing; its desks use the Open Space preset.

## Phase 2.1: visual quality (25 Oct 2026)

The owner found Phase 2 "messy and below squad-3d". This phase rebuilt how The AI Squad looks; every feature stayed. One commit per step; decisions in `QUESTIONS.md` (14, 15).

### What changed
1. **Theme and font**:
   - Every UI colour is a token in `:root`. Light, the squad-3d palette (cream page, white cards, ink text, deep gold accent), is the default; dark and auto (system) remain in the menu.
   - Plus Jakarta Sans (latin, variable 400-800) is vendored in `ui/vendor/fonts` with its OFL license, no CDN; monospace only for logs and code.
2. **Office scene**:
   - Every Floor, Floor 1 included, is a 16 x 13 m isometric office: honey wood planks, two light walls with baseboards and three windows, and a brand wall with the Floor name and a tagline (new `floor.json` field, editable in Floor settings).
   - Lighting: warm sun with soft shadows, hemisphere fill, ACES tone mapping.
   - Furniture stays movable devices; new types: wall whiteboard with sticky notes, pantry, TV, beanbags, ping-pong table.
   - New Floors get the full office. Untouched pre-2.1 default sets upgrade; arranged rooms are kept.
   - Idle agents also sit on beanbags, play ping-pong and fetch coffee at the pantry.
   - Desks have state rings, and desks and agents are 1.3 times larger so agents stay readable.
3. **Camera**:
   - An orthographic isometric camera (squad-3d angle), framed to the canvas left free by the floating cards; drag pans, scroll zooms.
   - The Desk view frames the desk and its neighbourhood. The first person and screen views keep a perspective camera.
4. **Layout** (V4, V5, V6): the top bar and the left team panel are gone.
   - **Status pill**, top left: Floor, sprint progress, active agents, Floor menu, main menu, plus warning chips (squad not running, budget) and one red "needs you" pill.
   - **Right panel**, collapsible: questions for the owner, the agent list with one status chip per agent (details moved to the Desk), then Activity / Messages / Standard. The Desk replaces the list.
   - **Icon dock** with tooltips: board (now a dialog), performance, cost (new dialog), server meter with its worst metric, add agent, voice, legend.
   - A slim elevator on the left.
   - Phones: the office on top, a bottom sheet (opens on Desk, Agents or Floors), and one row of dock icons above it.
5. **Name chips** (V7): as in squad-3d, a chip in the agent's colour (text colour by contrast), a status line with a state-coloured edge (what it is doing, needs you, idle, stopped, where it is in the lounge), z z z when idle or stopped, and a red ? when it waits. Phones show the chip only.
6. **Lobby** (V8): a light cutaway dollhouse. The Floors are stacked with air between them so each is a visible mini office with its colour stripe. Slim columns and a roof hold the stack together, the ground only takes a soft shadow, labels sit beside each Floor without overlap, and questions for the owner are one floating card.

### Verified
- **Tests**: 128 tests in 21 modules, one module at a time, all pass. New: the untouched-defaults upgrade and the tagline.
- **Acceptance screenshots**: `scripts/acceptance.sh` seeds the playground and puts agents in every state (working via hook events, idle via fake Claude Code sessions, waiting, stopped). It captures Lobby, a Squad Sprint Floor, Floor 1, a Desk and Set up Squad step 1 at 1440 x 900 and 390 x 844 into `playground/reference/after-*.png` (gitignored, not committed), one headless Chrome at a time.
- **Comparison with `dt-office.png`**: the Floor at 1440 now has the same building blocks:
  - a warm isometric office filling the canvas, with walls, windows and a brand wall;
  - lounge, ping-pong, pantry, whiteboard and plants;
  - coloured name chips with status lines;
  - a status pill top left, an agent list with Activity / Messages on the right, an icon dock at the bottom.
  The owner judges the final result by eye.
- **Other checks**:
  - first person and screen views (perspective camera);
  - Edit Mode in the new panel;
  - the board, performance, cost, legend and Floor menu popovers;
  - the dark theme;
  - every phone screen.
- **Design review** using the critique and elevation ideas from `design-skills` (read only). Fixed before finishing:
  - Medium: status and soft chips below AA contrast (darker ink tokens), gold buttons below AA (deeper gold), a sparse room with small agents (larger stations, wider presets), phone labels piling up, the phone pill hiding the Floor name.
  - Defects found on the way: the screen view off-centre (CSS-hidden elements counted as insets), first person into a sleeping agent's desk, the phone Lobby cut off (zoom floor), the Board missing from the Floor menu, the Performance table clipped.
  - No critical findings remained.

### Known gaps (Phase 2.1)
- **Judged in headless Chrome only** (SwiftShader). Rendering speed on the owner's GPU and on low-end laptops is not measured; shadows use a 2048 map.
- **Old Floors with arranged furniture** keep their rooms. The new pieces (TV, beanbags, pantry, ping-pong) are added by hand in Edit Mode. Saved desk positions from the old, smaller room may look denser until a layout preset is applied again.
- **Many agents**: with more than 8 desks the third row can reach the lounge, and at small zoom the name chips of neighbouring desks can still touch.
- **Lobby**: the dollhouse spreads the Floors apart, so a building with many Floors gets tall; the camera zooms out to fit and the offices get small.
- **Font source**: see QUESTIONS 14.

## Phase 2.2: Squad Log and Audit (26 Oct 2026)

Built from `PHASE-2.2-LOG-AUDIT.md` in the order A, B, C, one commit per step, then one commit with the fixes found in the real run. Version 0.3.0. Decisions in `QUESTIONS.md` (16 to 26).

### A. Squad Log
- **Writer** (`server/log.js`): `~/.aisquad/logs/<floor-id>/<YYYY-MM-DD>.jsonl`, append-only, schema `v: 1`, documented with an example for every event type in `docs/LOG-SCHEMA.md`. Common fields `ts`, `floor`, `sprint`, `module`, `agent`, `role`, `session`, `model`, `type`, a one-line `summary` and `data`. Floor 1 logs under `independents`.
  - Day files older than 7 days are gzipped (late events are merged into the archive), files older than `prefs.logRetentionDays` (default 90) deleted, once an hour.
  - Deduplication by id: a tool call or message seen by a hook and in a transcript has the same id (`tool:<tool_use_id>`, `msg:...`, `use:<message id>`); the ids of the last two days are reloaded after a restart.
- **Collectors** (`server/collect.js`, every 15 s; git every minute):
  - transcripts: owner tasks, delegations, SendMessage, AskUserQuestion and its answer with the wait time, every tool call (target path or trimmed command, duration, error; never file contents), usage per reply with the estimated cost;
  - hook events: tool calls live, permission prompts and how long they waited;
  - `docs/squad` and Blueprint files: board changes (with reopened rows), handoffs, QA reports (round, status, failed criteria), bugs opened / closed, sprint plan (modules, SP), questions in QUESTIONS.md and their answers, source document status;
  - gate decisions: the board and TaskCompleted hooks now record them in `.git/aisquad-gates.jsonl`; merge gate and merge results from the executor;
  - git commits (credited to agents with per-agent identities) and the closing commit as `sprint.closed`;
  - agent states: started / stopped / crashed, the model observed vs configured, idle while the team had open work, back to work, Watchdog alerts.
- **Privacy** (`server/redact.js`): secrets always removed (prefixed tokens, JWT, Bearer, URL passwords, private keys, `NAME=value` when a word of the name is sensitive); e-mail, phone, NIK / SSN and bank account numbers masked by default; `.env` content and file contents never logged. Floor settings: log message text on/off, masking on/off.
- **API and UI**: `GET /api/floors/:id/log?from=&to=&type=&agent=&sprint=` (PIN). A **Log** dock button: timeline filtered by agent, type (category), sprint and range, with details per event, and a **Conversation** view (who talked to whom, in order).
- `scripts/dev.sh` takes `AISQUAD_PORT`, so the playground runs on 8096 while the real `aisquad.service` keeps 8097.

### B. Audit
- `server/audit.js` builds a digest from a sprint, a range or the time since the last audit: process metrics (source documents approved before the first sprint, handoffs, QA before merge, first-round pass rate, bugs per SP by severity, parallel modules, questions and waits, refused gates, rework, and the server's sprint close checks) and efficiency metrics (cost and tokens per SP, per module, per agent, cache hit rate, cost by model, repeated reads, failed tool calls and retries, long outputs, idle time with open work, time blocked on the owner, opus on docs-only work), plus up to 60 relevant events with refs `E1...`. About 5 KB for a small sprint.
- The bundled `squad-audit` skill (English) is the system prompt of `claude -p --tools "" --json-schema ...` (sonnet by default, Floor setting). Findings have area, severity, title, evidence, recommendation and an optional target (role-template, blueprint or floor-setting with a concrete change). The parser drops findings without evidence and cleans targets.
- Stored as `~/.aisquad/audits/<floor-id>/<timestamp>.json` + `.md`, with the audit's own cost and duration. Scores per area: 100 minus 30 / 15 / 8 / 3 per critical / high / medium / low finding.
- Triggers: `/aisquad audit [floor] [--sprint N] [--model m]`, the **Audit** dock button, and automatically after a sprint closes (on by default for Squad Sprint Floors). The trigger is read from the log once a minute, so a server restart does not lose it; it waits for free RAM like merges.
- The Audit dialog: run controls, scores, key numbers, the summary, findings by severity with evidence chips (event refs open the Log on that event, with a way back), and the history with trend lines (cost per SP, first-round pass rate, cache hit rate).

### C. Improvement loop
- **Review change** shows the proposed change as a diff. **Apply** saves a new Role Template version (old text in `.history`, Floors show *Update available*), a new Blueprint version with a *Lessons from audits* section (old text in `blueprints/.history`; the Floor's Standard tab offers **Update**, which refreshes the snapshot, `AISQUAD.md` and the agent files), or one of four Floor settings. **Dismiss** asks why.
- Ledger `~/.aisquad/improvements.jsonl`: finding, proposed change, decision, version created, metrics before; after the next audit of the Floor an outcome line with the metrics after. Shown as **Improvements** in the Audit dialog.
- `/aisquad audit export` writes `~/.aisquad/exports/aisquad-export-<time>.json` (0600): metrics, findings and decisions; no message text; paths, Floor and agent ids (also inside free text) as salted hashes; nothing is uploaded.

### Verified
- **Tests**: 156 tests in 26 modules, run one module at a time, all pass. New modules: redact (every pattern plus a false-positive list), log (fields, dedupe across restarts, message text off, filters, gzip, retention), collect (transcripts, hook + transcript dedupe, permission wait, docs/squad changes, gate records, commits, agent states, name resolution), audit (metrics on a fixture log, digest, review parsing, `claude -p` arguments with the fake Claude Code, storage and history), improve (Role Template and Blueprint versions, Floor setting, dismiss, outcomes, anonymised export).
- **Real dogfood** (Claude Code, haiku, scratch home `playground/home-dogfood`, server on 8096): a Software House squad "Slug Tool" (Project Manager lead, developer, QA, all haiku / low) with the four source documents approved, started with `/sprint 1`.
  - In about 2.5 minutes the lead planned M01 (2 SP), delegated to the developer and QA as teammates, the developer built `slug.js` with 6 green tests and a handoff, QA passed it in round 1, and the lead committed `feat(slug)` and `docs(squad): close sprint 1`. Cost $0.030 (26 replies, 87 % cache hit rate).
  - The log has 100 events for the Floor: 26 tool calls, 26 usage turns, 11 board changes, delegations, messages, QA report, commits, the sprint close, the audits and the decisions.
  - **The team did not really close the sprint**: RELEASE.md was written to `docs/squad/` instead of `docs/squad/sprint-1/`, there was no `FINAL-S1.md`, so the server did not merge (and my own Floor settings change had left `floor.json` dirty).
  - The automatic audit ran on the closing commit (haiku, 28 s, $0.0038, 5 findings). After adding the sprint close checks to the digest, a second audit of sprint 1 (haiku, 38 s, $0.0049, 6 findings) found exactly that problem as F1 (high, evidence: the QA PASS event, the sprint closed event, `process.sprintClose`, `process.qaBeforeMerge`) and proposed two rules for the Project Manager.
  - **Applied F1**: Role Template `project-manager` v2 → v3 (v2 in `.history`); the Floor showed *Update available* for the lead. F3 was dismissed with a reason. Both are in the ledger and in the log as `improvement.decided`.
  - Total cost of the run about $0.04. The lead was stopped, the private tmux server and the dogfood server ended, and the run's transcripts were removed from `~/.claude/projects`. The repository `playground/real/squads2/slug-tool` and `playground/home-dogfood` (log, audits, ledger) are kept for inspection (gitignored).
- **What the dogfood found in Phase 2.2 itself** (all fixed in the last code commit):
  - teammates that finished inside the lead's session were logged as `agent.crashed` (the audit even reported "two agents crashed");
  - teammate messages arrive in the lead's transcript as user text ("Another Claude session sent a message") and were logged as owner tasks (the audit noticed this too, F6);
  - `Tester: Sari` and messages to `main` were not mapped to agent ids;
  - the automatic audit was only queued in memory and a server restart lost it;
  - the audit could not see the server's sprint close checks; the Blueprint id was copied with its version (`software-house-v1`);
  - Floor 1 read back 7 days of this machine's other sessions at once (about 47,000 events, 24 MB): now 1 day. That scratch log was deleted.
  The events logged before the fixes stay in the dogfood log as they were (append-only).
- **Screenshots** in the Phase 2.1 look, from the dogfood Floor, in `playground/reference/` (gitignored): `phase22-log-1440.png`, `phase22-conversation-1440.png`, `phase22-audit-1440.png`, `phase22-audit-findings-1440.png`, `phase22-log-390.png`, `phase22-audit-390.png`. One headless Chrome at a time.

### Known gaps (Phase 2.2)
- **The owner's running `aisquad.service` was not restarted.** It serves `ui/` from this checkout, so a reload shows the new Log and Audit buttons while its API is still 0.2.2 ("Not found" in those dialogs). `/aisquad` sees the version change (0.3.0) and restarts it.
- **Floors scaffolded before 0.3.0** keep their old gate hooks, so board-gate decisions are not logged there (QUESTIONS 19).
- **Board rows that do not follow `BUILD M01 ...`** are not checked by the board gate at all. In the dogfood the lead wrote `M01 BUILD: ...`, so no gate ran; the log shows 0 gate events and the audit did not flag it.
- **Owner prompts typed directly in a tmux pane** are logged from the transcript; the UserPromptSubmit hook is not used (no shared id to deduplicate).
- **Permission answers** are measured until the agent's next event; whether the owner allowed or denied is not known.
- **Audits are as good as the model and the digest.** With haiku and a one-module sprint the findings were sensible but small; costs are estimates from the price table.
- **Personal data masking is pattern based**; names are not detected (QUESTIONS 20).
- **Log size**: a busy Floor writes one line per tool call and per reply; the timeline reads up to 20,000 events of the chosen range.

## 0.3.3: owner bug report fixes (26 Oct 2026)

- **0.3.3** (owner bug report, Floor dtamu-app-squad): a lead that ends its turn asking the owner in plain text now shows as **Waiting for your reply** in Attention, with the message and a reply box that sends the answer as its next task; teammates the lead has not started show **not started** (or "waiting for source documents") instead of stopped, and the Floor pill says what the squad waits for ("Waiting for you: 3 source documents"); the Project Manager role (v3), the Software House Blueprint (v2) and the source-docs-intake skill tell the lead to ask decisions with AskUserQuestion; Claude Code's dim prompt suggestions are no longer read as typed input; and every agent runs on its own tmux server in its own systemd scope, so an out of memory kill takes one agent instead of all of them (sessions from older versions are still found on the default server). Screenshots: `playground/reference/reply-card-1440.png`, `reply-card-390.png`, `standby-agents-390.png`. The owner's `aisquad.service` was not restarted; agents already running stay on the shared server until they are restarted.

## 0.3.4: recovery after an agent dies, source documents (26 Oct 2026)

- **0.3.4** (owner request after the DTamu lead and its teammates were killed by systemd-oomd at 11:49): the server records each agent's systemd scope and, when a session it started disappears without a stop, classifies the end (out of memory kill from `journalctl --user`, killed mid-turn from the transcript, or a clean exit) and logs `agent.crashed` with the cause; the Desk, the agent list, the Floor pill and Attention show **Stopped unexpectedly (out of memory at 11:49)** with **Resume** (`--resume <last session id>`) as the main action and **Start fresh** beside it; every stopped agent with an earlier session can **Resume last session** (`agent.resumed`); a resumed lead of a squad gets a recovery note; optional per-Floor **Auto-resume after a crash** (off by default, 2 per hour, not under memory pressure); per-Floor **Max concurrent agents** (default 4) written into the lead's agent file, and a Watchdog question before starting more agents or starting while swap is above 80 %; in-process teammates show their real last state from the subagent transcripts and never "waiting for source documents" once a sprint has started; a new **Source documents** dialog (pill, Standard tab, Floor menu) with View, Approve (`doc.approved`, only the STATUS and approval lines change, only Blueprint paths) and Request changes to the lead. On DTamu, `docs/ENVIRONMENTS.md` is still DRAFT and was left for the owner to approve. Screenshots: `playground/reference/crash-desk-1440.png`, `crash-desk-390.png`, `crash-floor-1440.png`, `source-docs-1440.png`, `source-docs-390.png`. The owner's `aisquad.service` and the live lead's tmux socket were not touched; the new behaviour starts after the owner restarts the service.

## Phase 2.4: Autopilot, 0.4.0 (26 Oct 2026)

Owner question: "Is there an automation mode, so that when something is not really important the squad keeps going until it is done?" Decisions: three levels, default **Balanced** for new Floors, auto-answer timeout **3 minutes**. Brief: `PHASE-2.4-AUTOPILOT.md`.

- **Levels** (`floor.json`: `autopilot`, `autopilotTimeoutSec`): `off`, `balanced`, `full`. New Floors (wizard and Set up Squad) start Balanced. A floor.json from before 0.4.0 reads as `off`, so existing squads keep their behaviour until the owner changes it.
- **One hard-stop list** (`server/autopilot.js`): money, legal and privacy, production, secrets and credentials, irreversible actions, scope and source document changes, missing source documents, plus the Blueprint's `ownerOnly` topics under Balanced. Keyword patterns in English and Indonesian; an unclear text counts as critical. The lead's agent file gets a `## Autopilot` section generated from the same list, the record mark `DECIDED BY LEAD (autopilot), owner may correct` and the timeout.
- **Server** (every 30 s): a non-critical question with a "(Recommended)" option is answered with it after the timeout (clock from when the item was first seen). It stays in Attention as a muted **Decided by autopilot** card with **Change answer** (a follow-up task to the agent) and **OK**. Permission prompts are never answered. A non-critical **Waiting for your reply** ask gets one nudge. An idle squad with open board rows for 5 minutes gets a lead nudge (at most once per 15 minutes). Lead decisions in the questions file are logged.
- **Chain**: Autopilot turns auto-resume on. Resumes, nudges and the next sprint stop when the budget is reached, memory is under pressure, a critical item waits, or (nudges) the backlog is empty. Merges keep their own approval. Autopilot never approves a source document and never pushes.
- **UI**: Floor settings (level with one sentence each, timeout, read-only hard-stop list), Set up Squad review step, the `Autopilot: Balanced` chip on the Floor pill (it says when something critical waits), notes on Attention items ("Autopilot answers "Vitest" in 2 min if you do not" / "Critical (money): Autopilot leaves this to you"), muted decided cards that do not count as "needs you", and "Decided by autopilot today: N" in the Lobby.
- **Log and Audit**: `autopilot.decided` (lead or server timeout), `autopilot.nudged`, `autopilot.blocked`, `autopilot.changed`. The Audit has an Autopilot section: decisions, the owner's change rate, critical decisions (must be 0), the waiting saved. The reviewer can propose the `autopilot` Floor setting.
- **Also in 0.4.0** (owner report): "Waiting for your reply" no longer fires on a teammate's status report or review. On squad Floors a teammate's message counts only when it explicitly asks the owner. A question the message answers on the same line ("…? Yes, …") is a finding, not an ask, for the lead as well.

### Verified (Phase 2.4)
- Unit tests: `test/autopilot.test.js` (classification with English and Indonesian examples such as "harga", "hapus data", "deploy produksi", "rename a button"; timeout; idle nudge rate limit; chain stops; lead rules), `test/autopilot-squad.test.js` (fake Claude Code: the timeout answer, a critical question never answered and logged once as blocked, Change answer, reply and idle nudges, lead decisions, Autopilot off), plus floors, blueprints, reply, resume, audit and improve tests.
- Live playground server (`playground/autopilot`, port 8197, fake Claude Code, no model calls): a Software House squad created through Set up Squad starts Balanced, and the lead's agent file has the Autopilot section. A test-runner question with "Vitest (Recommended)" was answered by the server's own tick 3 minutes after it opened (14:59:03 → 15:02:09) and stayed as a muted decided card. A price question with a recommended option still waited, marked "Critical (money)". The Lobby counted 1 decision today.
- Screenshots (one Chrome run at 15:26, when swap had dropped to 75 %): `playground/reference/autopilot-floor-1440.png` (the pill chip "Autopilot: Balanced · 1 critical waits for you" and a critical question noted "Critical (money): Autopilot leaves this to you"), `autopilot-settings-1440.png`, `autopilot-settings-390.png`, `autopilot-attention-390.png` (the decided card is at the bottom of the sheet). These shots showed that the chip crowded the phone's top bar. On a phone the level now sits in the Agents card header, a change made after the shots and not yet re-shot. Still to do: a 1440 shot scrolled to the decided card, the phone shots again, and the haiku dogfood. The owner then asked for no Chrome or model runs while swap is high.

### Known gaps (Phase 2.4)
- Classification is a keyword match, not a model: it errs towards "critical" (for example "design tokens" or "kebutuhan" make a question critical). Critical items are never decided automatically. Unclear ones wait.
- An AskUserQuestion with several questions is answered one dialog at a time, each after its own timeout. Its final "Submit answers" screen has no recommended option and waits for the owner.
- Lead decisions are counted from the questions file. A lead that decides without writing the mark is not counted.
- A server restart restarts the 3-minute clock for dialogs that have no transcript time.

## 0.4.1: DevOps on real servers (26 Oct 2026)

- **0.4.1** (owner request): six bundled skills (`server-discovery`, `staging-install`, `docker-ops`, `git-deploy`, `netlify-setup`, `server-health`). The DevOps Engineer template is now v2: it has these skills, and its rules split tasks by who gave them. A task from the owner on the agent's own Desk (`AISQUAD_AGENT` names the agent itself) means setup preparation: discovery, install plan, Netlify readiness and the owner's to-do list, with no change until the owner approves. A task from the lead (a teammate inherits the lead's `AISQUAD_AGENT`) means deployment to an approved environment, a smoke test, rollback if needed, and a report to the lead. The Autopilot hard-stop list has a new "Servers" entry (installing on a shared server, sudo, reverse proxy, DNS and domains, firewall, certificates, deploy and ssh keys) and production actions (restarting, migrating or rolling back production). An agent started on its own Desk on a Squad Sprint Floor now reads its own session's transcript, not a lead-spawned teammate run with the same id (tested on a Software House Floor). Floors that use DevOps v1 show "Update available" on its Desk. Not run: model and Chrome checks, at the owner's request while swap is high.

## 0.4.2: Finished reports reach the owner (26 Oct 2026)

- **0.4.2** (owner report: the Desk-started DevOps agent ended its turn with a long report and a question, and nothing told the owner). Every agent the owner talks to directly now gets one Attention card when its turn ends with nothing else open. These are the lead, any agent started from its Desk, and independent agents. The card is **Waiting for your reply** when the message asks the owner, otherwise a calm **Finished** card with the rendered report, Reply, OK and Open desk. It counts in the title and notifications, blocks nothing (Autopilot keeps going) and clears when the agent works again. Reports from the last 12 hours count. Lead-spawned teammates get no card. `report.delivered` is logged once per report.
- **Why the DevOps question was missed:** its last line, "3. PO memberi tahu: bolehkah saya mulai … ?", ends with a question mark. But the 0.4.0 rule treated every non-lead on a squad Floor as a lead-spawned teammate and only counted messages that address the owner as "you / kamu / anda / owner". This was read from the transcript only; nothing was typed into the session. Agents with their own session now use the normal rules. Reports without an ask become Finished cards, which handles the designer's review that the strict rule was added for.
- Tests: `test/reply.test.js` (the DevOps message shape, one card per turn), `test/finished.test.js` (fake Claude Code: a Desk-started DevOps report, its question variant, report.delivered once, Reply and OK, no card for a lead-spawned teammate). Screenshots (swap 74 %): `playground/reference/finished-1440.png`, `finished-390.png`, and `autopilot-pill-390.png` (the 0.4.0 phone re-shot: the Autopilot level in the Agents card).

## Phase 2.5: rituals, methods and quality gates (from 26 Oct 2026)

Brief: `PHASE-2.5-RITUALS.md` (concepts from CLAW3D and gstack, our own text and code). One release per part.

### 0.5.0: token-saving methods
- **`investigate` skill**: root cause first, with a record per problem in `docs/squad/debug/` and escalation after three failed attempts. It is in fullstack-developer v3, sprint-developer v5, frappe-developer v3, qa-engineer v3 and sprint-qa v5, each with a rule. The log scanner turns new `## Attempt N` sections into `debug.attempt` and `STATUS: ESCALATED` into `debug.escalated`. The Audit has `process.debug` with loops (three or more failed attempts without an escalation, or more than three), and the reviewer treats a loop as a high finding.
- **Retro** (`server/retro.js`): a sprint's audit (automatic after a sprint closes, or an audit of one sprint) also builds a Retro from its metrics, its findings and the Performance data. No extra model call. It is saved in the audit and as `<id>-retro.md`, logged as `retro.done`, and shown in the Retro dialog (Floor menu, or from the audit). **Send to lead** writes `docs/squad/retro/sprint-N.md` and queues the lead's LEARNINGS task.
- **LEARNINGS.md** (`server/learnings.js`): every agent file tells the agent to read it before a module, and the lead's file has a Learnings section. The Audit has a new target, `project`: its rule lines become dated entries when the owner applies the finding (diff shown first).
- Screenshots (playground with the fake `claude -p`, two seeded sprints, swap 74 %): `playground/reference/retro-1440.png`, `retro-390.png`. When Performance has no board data, the cost per story point trend comes from the audits of earlier sprints.
- Tests: `test/retro.test.js`, `test/retro-squad.test.js` (fake `claude -p`: the sprint audit's Retro, Send to lead), collect (debug events), audit (loops), improve (project target), plus role version updates.

### 0.5.1: plan reviews before the sprint
- **Premise check** in `source-docs-intake`: six forcing questions before the PRD, with the answers in a `## Premise` section.
- **Scope mode** in `sprint-planning` and the PLAN.md template: `Scope mode: <mode> — <reason>`. The log records `sprint.scope` once per sprint and `scope.changed` for a different mode in the same sprint. The change becomes a critical **Scope change** Attention item ("Accept" or "Back to …", which sends the lead a task), and it stops the Autopilot chain.
- **Plan review chain**: the new `plan-review` skill (engineering, design scored 0-10, security), `/sprint` step 6, and a Software House gate. `PLAN-REVIEW.md` is logged as `plan.reviewed` with the verdicts and the design score. The Audit's `process.planReviews` counts reviewed sprints (and whether before the first BUILD), design scores, requested changes, scope modes and mid-sprint changes.
- **Security Engineer** role (v1) with the `security-review` skill (STRIDE for plans, OWASP Top 10 for releases, evidence per finding, local and staging only). It is an optional role in **Software House v3**, which also has the premise check and plan review in the lead's rules. project-manager v4 and sprint-lead v5 have `plan-review` and the scope mode rule. Floors on older versions show "Update available".
- Tests: collect (scope parsing, events, plan review), audit (plan review metrics), retro-squad (Scope change item and "Back to"), blueprints (v3, the Security role), and version updates. No screenshots: the only new screen element is a standard Attention card.

### 0.5.2: the conversation view (owner priority, between Phase 2.5 parts)
- The owner asked for this as "0.4.3". 0.5.0 and 0.5.1 were already released, and `/aisquad` compares versions to decide whether to restart the server, so it ships as **0.5.2**. The remaining Phase 2.5 parts move up by one: office rituals 0.5.3, shipping safety 0.5.4, design and second opinions 0.5.5.
- Any Attention item opens large (`ui/convo.js`). Click a card's text or its ⤢ button, a row in the Needs you index, or the Desk. The dialog is 900 px wide and up to 85vh on desktop, and a full-screen sheet on phones.
- The portrait (`ui/portrait.js`) is the agent's own chibi in one small WebGL canvas: same look, colours and desk toy, idle breathing, blinking and a talking animation, drawn once with reduced motion, and disposed on close.
- The message is a speech bubble with readable markdown (16 px, line-height 1.6, 72ch, headings, lists, zebra tables with horizontal scroll, code blocks, links). `mdLite` now renders `[text](https://…)` and bare https URLs, only http and https.
- The action bar is chosen per kind (`ui/convo-model.js`): options as large buttons with the recommended one highlighted, free text, Reply with OK or Dismiss, Open desk, and Resume / Start fresh for crashes. "n of m" with previous and next, the arrow keys, and Esc to close.
- The office camera eases to the agent (only on the Floor in view) and a short bubble appears over its head ("Finished: …", "Question for you").
- The Needs you popover is an index with a one-line preview; for dialogs the preview shows the question, not the dialog's header.
- Tests: `test/convo.test.js` (previews, bubbles, actions per kind, n of m, markdown and safe links). Screenshots (swap 73 %): `playground/reference/convo-finished-1440.png`, `convo-question-1440.png`, `convo-finished-390.png`, `convo-index-1440.png`.

### 0.5.3: office rituals in 3D
- **Meeting table** (`meeting-table` device with six chairs): in the default office, and added once to arranged offices (`upgradeDevices`), never twice.
- **Meetings from the Log** (`server/rituals.js`): `sprint.planned` and `retro.done` gather the whole team, `plan.reviewed` the lead plus designer, security and QA, `task.delegated` from the lead to a teammate is a briefing (two agents), and `standup.held` the team. The log tick keeps the current meeting per Floor and the Floor summary carries it. In 3D the agents involved walk to the seats, sit and talk in turns, then walk back (`ui/life.js`). An agent waiting for the owner stays at its desk.
- **Standup**: daily at the Floor's time (default 09:30, `floor.json` `standup`), from the Log since the last standup plus the live state. It lists done (commits, DONE rows, QA passes, closed bugs, reports), doing (IN_PROGRESS rows, the current activity) and blocked by (open bugs, escalations, unanswered questions, waiting for the owner). It is logged as `standup.held` (a quiet day is recorded but nobody meets), shown in the Standup tab, and available live at `GET /api/floors/:id/standup`. The optional haiku summary from the brief is not built: the standup needs no model.
- **Follow agent**: `#/floor/<id>/desk/<agent>/follow`, a perspective chase camera that eases after the agent (desk, lounge, meetings), with a bar for previous and next agent, Desk and Back (Esc).
- **Diffs on screens**: an Edit or MultiEdit peek keeps the replaced lines (`old`), and the server keeps the edit's own lines next to the file window (`added`). Developer monitors draw the diff. The lead's board screen and QA's screens have a strip "QA n/m passed · sprint-N → main · last merge …" (`ui/screen-model.js`).
- Tests: `test/rituals.test.js` (meetings, standup due, standup content), retro-squad (a planned sprint gathers the team, the standup is held once a day), floors (the meeting table upgrade), transcripts (edit peeks keep the replaced lines), convo (diff lines, merge strip). Screenshots (swap 72 %): `playground/reference/meeting-1440.png`, `meeting-390.png`, `standup-390.png`, `follow-1440.png`.

### 0.5.4: shipping safety
- **Ship readiness** (`server/ship.js`, `GET /api/floors/:id/ship`, Floor menu dialog), read from the repo: QA PASS per module on the board, the final smoke test, `RELEASE.md`, the plan review (for information), the design review (needed with a designer), the security review (needed with a Security Engineer: the plan review's verdict and no open Critical or High finding in `docs/squad/security/`), and `Rollback tried: <date>` in `docs/ENVIRONMENTS.md` (needed to deploy). The server's automatic sprint merge waits until the merge list is complete and logs `ship.blocked` once per branch tip. Manual merges by the owner are not blocked. The Audit shows the waits and the edit-lock refusals.
- **Canary** skill (DevOps Engineer v3): a baseline before the deploy, a watch window (10 minutes on staging, 30 on production), thresholds (health, error rate, latency, restarts, memory). It rolls back staging by itself and asks the owner before rolling back production (critical, also under Autopilot), and reports in `docs/ops/DEPLOYS.md`. `git-deploy` starts with the ship readiness list and records the first rollback as `Rollback tried: <date>`.
- **Edit locks** (`.claude/hooks/edit-lock.cjs`, PreToolUse in the Squad Sprint pack; older packs get the script on the next settings merge): a developer with modules in PLAN.md may edit only those "Owned folders" and `docs/squad/`, while the lead, QA, the designer and unknown agents are not limited. Destructive commands ask for confirmation (a background teammate cannot confirm, so for it they are refused). Both are recorded as gate events for the Log.
- Tests: `test/ship.test.js`, sprint (edit locks through the real hook script, missing hook scripts), skills (canary, DevOps v3), audit. Screenshots (swap 72 %): `playground/reference/ship-1440.png`, `ship-390.png`.

## How to run

```
node bin/aisquad.js                 # or /aisquad in Claude Code with the plugin installed
cat ~/.aisquad/pin                  # PIN for changes
npm test
```

Development against the scratch Building (nothing outside `./playground` is touched):

```
node scripts/seed-playground.js     # three Floors with synthetic transcripts, PIN 123456
scripts/dev.sh start                # http://127.0.0.1:8097
CLAUDE_BIN=$PWD/test/fixtures/fake-claude.cjs AISQUAD_NO_SYSTEMD=1 scripts/dev.sh restart   # agents run the fake Claude Code
node scripts/shot.js shots.json     # screenshots (see README)
scripts/dev.sh stop
```

## Known gaps

- **Merge gates in the temporary worktree**: only `node_modules`, `.venv`, `venv` and `vendor` are linked in from the project. Gates that need build output, generated files or local env files can fail there and refuse the merge.
- **Merge heuristics**:
  - Automatic merges of agent branches wait for a finished work item. Work given outside The AI Squad does not count.
  - Feature branches merge once nobody on the Floor has open work.
- **Squad Sprint**:
  - It relies on Claude Code's experimental Agent Teams. One real sprint has run, with haiku and a tiny task. Larger sprints and other models are untested.
  - With Claude Code 2.1.310 the TaskCompleted hook never fires, because there is no team task list. The board gate on `docs/squad/TASKS.md` is the gate that actually runs; it was seen accepting real changes, and its refusal path is covered by tests.
  - The board gate runs after the change and puts failing rows back. A determined agent could still mark a row DONE again in a later command; each time it is checked again and put back.
  - Teammates are background agents. Anything not covered by the allow rules in `.claude/settings.json` fails for them instead of prompting.
  - The Board shows `TASKS.md` as written by the lead. It does not read Claude Code's own task list.
- **Libraries**: private git repositories need git credentials that work non-interactively (ssh key or credential helper); prompts are disabled.
- **Model check**: the observed model is the latest reply in the agent's most recent transcript, which can be a subagent run. Mismatches are compared by model family (opus, sonnet, haiku, fable).
- **Visual checks were short** because of memory pressure. Phase 1.2 used a few Chrome runs for the screens, lounge, screen view and offline load; for Phase 1.1: one Chrome run covering the Desk model warning (desktop and phone), the Board, Floor Settings → Merges and the Libraries view. The wizard's "+ Squad Sprint team" button and the "start the next sprint" checkboxes were checked by code review only.
- **Squad Sprint workflow on older Floors**: on a Floor created before Phase 1.1 that already uses squad-sprint, the pack is scaffolded on the next Floor Settings save.
- **Permissions**: template `deny` rules are enforced with `--disallowedTools`. `allow` lists are validated (overrides cannot widen them) but not passed to Claude Code. Skills are listed in the agent file and prompt; whether they are installed is not checked.
- **Crash cause**: sessions started before 0.3.4 have no recorded systemd scope, so any out of memory kill of an `aisquad-` scope between their last activity and the moment the server noticed counts for them. Without a journal entry, a transcript that ends mid-turn is reported as "ended mid-turn". A crash while the server was down is noticed at the next start.
- **Questions from sessions not started by The AI Squad** show in Attention but can only be answered in that session's own terminal.
- **Screen parsing depends on Claude Code's TUI text** ("esc to interrupt", "Enter to confirm", the `❯` input box). A Claude Code UI change can need parser updates in `server/tmux.js`; the tests have fixtures for the current screens.
- **Cost** is an estimate from transcript usage with prices hard-coded in `server/transcripts.js`.
- A stall alert's time is when the Watchdog first noticed it, not when the agent went idle; the text says how long the agent has been idle.
- **3D**:
  - The screen view hides the agent's head (the chibi head would cover the monitor).
  - Teammates running inside the lead's session have no tmux screen of their own.
  - Agents walk in straight lines (they can pass through furniture).
  - Name tags can overlap in tight layouts.
- **Hook events**: they come from agents The AI Squad starts (via `--plugin-dir`). Other sessions send events only if the plugin is installed. Permission prompts reported by hooks are shown but answered on the Desk screen or in the terminal.
- **License**: UNLICENSED for now (owner decision). The plugin validator warns that there is no LICENSE file.
- The real Claude Code smoke test recorded "trusted folder" for `playground/real/smoke` in Claude Code's own `~/.claude.json`. That directory no longer exists. The entry stays, as the owner asked.
