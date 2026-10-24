# Progress: The AI Squad MVP

Status on 24 Oct 2026: the seven MVP steps from `SPEC.md` and the five Phase 1.1 decisions are built and committed, one Conventional Commit each. `npm test` runs 83 tests in 13 modules and all pass (run module by module during Phase 1.1 because of memory pressure on the machine).

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
   - The hooks are tested with real `bash` + `jq`. The close → merge → next-sprint flow is tested with the fake Claude.
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
  - "Per agent" commit identity is stored but still not applied.
- **Squad Sprint**:
  - It relies on Claude Code's experimental Agent Teams and on `jq` for the hooks. Without `jq` the gates are skipped.
  - No full sprint has run with real Claude Code yet. The flow is covered by tests with the fake Claude and real hook scripts.
  - The Board shows `TASKS.md` as written by the lead. It does not read Claude Code's own task list.
- **Libraries**: private git repositories need git credentials that work non-interactively (ssh key or credential helper); prompts are disabled.
- **Model check**: the observed model is the latest reply in the agent's most recent transcript, which can be a subagent run. Mismatches are compared by model family (opus, sonnet, haiku, fable).
- **Phase 1.1 visual check was short** because of memory pressure: one Chrome run covering the Desk model warning (desktop and phone), the Board, Floor Settings → Merges and the Libraries view. The wizard's "+ Squad Sprint team" button and the "start the next sprint" checkboxes were checked by code review only.
- **Squad Sprint workflow on older Floors**: on a Floor created before Phase 1.1 that already uses squad-sprint, the pack is scaffolded on the next Floor Settings save.
- **Permissions**: template `deny` rules are enforced with `--disallowedTools`. `allow` lists are validated (overrides cannot widen them) but not passed to Claude Code. Skills are listed in the agent file and prompt; whether they are installed is not checked.
- **Questions from sessions not started by The AI Squad** show in Attention but can only be answered in that session's own terminal.
- **Screen parsing depends on Claude Code's TUI text** ("esc to interrupt", "Enter to confirm", the `❯` input box). A Claude Code UI change can need parser updates in `server/tmux.js`; the tests have fixtures for the current screens.
- **Cost** is an estimate from transcript usage with prices hard-coded in `server/transcripts.js`.
- A stall alert's time is when the Watchdog first noticed it, not when the agent went idle; the text says how long the agent has been idle.
- **3D**: no first-person view or desk screen content. Name tags can overlap in tight layouts (they show first names to reduce this). Touch gestures are the OrbitControls defaults.
- **three.js loads from jsDelivr**, so the UI needs network access.
- **License**: not decided. `package.json` says UNLICENSED, and the plugin validator warns that there is no LICENSE file.
- The real Claude Code smoke test recorded "trusted folder" for `playground/real/smoke` in Claude Code's own `~/.claude.json`. That directory no longer exists. The entry stays, as the owner asked.
