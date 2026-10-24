# Progress: The AI Squad MVP

Status on 24 Oct 2026: the seven MVP steps from `SPEC.md`, the five Phase 1.1 decisions and the five Phase 1.2 items are built and committed, one Conventional Commit each. `npm test` runs 97 tests in 14 modules and all pass. During Phases 1.1 and 1.2 the tests were run one module at a time because of memory pressure on the machine.

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
  - The TaskCompleted gate never ran in the dogfood, because the lead didn't use the task list. The template now requires it, but that change is not re-tested with real Claude Code.
  - Teammates are background agents. Anything not covered by the allow rules in `.claude/settings.json` fails for them instead of prompting.
  - The Board shows `TASKS.md` as written by the lead. It does not read Claude Code's own task list.
- **Libraries**: private git repositories need git credentials that work non-interactively (ssh key or credential helper); prompts are disabled.
- **Model check**: the observed model is the latest reply in the agent's most recent transcript, which can be a subagent run. Mismatches are compared by model family (opus, sonnet, haiku, fable).
- **Visual checks were short** because of memory pressure. Phase 1.2 used a few Chrome runs for the screens, lounge, screen view and offline load; for Phase 1.1: one Chrome run covering the Desk model warning (desktop and phone), the Board, Floor Settings → Merges and the Libraries view. The wizard's "+ Squad Sprint team" button and the "start the next sprint" checkboxes were checked by code review only.
- **Squad Sprint workflow on older Floors**: on a Floor created before Phase 1.1 that already uses squad-sprint, the pack is scaffolded on the next Floor Settings save.
- **Permissions**: template `deny` rules are enforced with `--disallowedTools`. `allow` lists are validated (overrides cannot widen them) but not passed to Claude Code. Skills are listed in the agent file and prompt; whether they are installed is not checked.
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
- **License**: not decided. `package.json` says UNLICENSED, and the plugin validator warns that there is no LICENSE file.
- The real Claude Code smoke test recorded "trusted folder" for `playground/real/smoke` in Claude Code's own `~/.claude.json`. That directory no longer exists. The entry stays, as the owner asked.
