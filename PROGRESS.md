# Progress: The AI Squad MVP

Status on 23 Oct 2026: all seven MVP steps from `SPEC.md` are built and committed, one Conventional Commit per step. `npm test` runs 60 tests and all pass.

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

- **Auto-merge executor** is out of MVP scope. `git.json` (merge policy, quality gate, auto-merge approval, push policy) is stored and turned into agent rules, but nothing merges or pushes yet. "Per agent" commit identity is stored but no per-agent `git config` is set.
- **Squad Sprint** is a workflow flag, a line in `AISQUAD.md` and the agent files, and a simple board of the work given through The AI Squad. There is no sprint protocol, hooks or `/sprint` command like the dtamu-app setup.
- **Reads are open on the bound address.** Floor detail and the activity feed (which includes commands agents ran) need no PIN; desk screens and all changes do. This is fine on `127.0.0.1`, but `--host 0.0.0.0` exposes activity to the network.
- **Permissions**: template `deny` rules are enforced with `--disallowedTools`. `allow` lists are validated (overrides cannot widen them) but not passed to Claude Code. Skills are listed in the agent file and prompt; whether they are installed is not checked.
- **Questions from sessions not started by The AI Squad** show in Attention but can only be answered in that session's own terminal.
- **Screen parsing depends on Claude Code's TUI text** ("esc to interrupt", "Enter to confirm", the `❯` input box). A Claude Code UI change can need parser updates in `server/tmux.js`; the tests have fixtures for the current screens.
- **Cost** is an estimate from transcript usage with prices hard-coded in `server/transcripts.js`.
- A stall alert's time is when the Watchdog first noticed it, not when the agent went idle; the text says how long the agent has been idle.
- **3D**: no first-person view or desk screen content. Name tags can overlap in tight layouts (they show first names to reduce this). Touch gestures are the OrbitControls defaults.
- **three.js loads from jsDelivr**, so the UI needs network access.
- **License**: not decided. `package.json` says UNLICENSED, and the plugin validator warns that there is no LICENSE file.
- The real Claude Code smoke test recorded "trusted folder" for `playground/real/smoke` in Claude Code's own `~/.claude.json`. That directory no longer exists. I left that entry alone rather than edit Claude Code's config.
