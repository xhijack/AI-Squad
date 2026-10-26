# Questions for the product owner (Phase 2)

Decisions taken with the safest default while building Phase 2 (25 Oct 2026). Each one is easy to change; please confirm or correct.

1. **Order of D and E.** Set up Squad (D) needs Blueprints (E). D added the Blueprint library (roles, counts, lead, keywords) and the new Role Templates; E then added the communication standard (source documents, channels, gates, packs) on top. Both are separate commits.

2. **Real systemd install not run on this machine.** Installing `aisquad.service` as a real user service was blocked by the session's permission check (it counts as persistence on a shared machine). The unit, start, stop, status and uninstall are covered by unit tests with a recorded fake `systemctl`. Please run `/aisquad` once and then `/aisquad status` to confirm it on a real login.

3. **Lingering is not turned on automatically.** A user service stops at logout unless `loginctl enable-linger` is on. That is a machine setting, so `/aisquad status` reports it and the README explains it, but The AI Squad does not change it.

4. **`.env.example` vs. `Read(./.env.*)`.** DevOps must own `.env.example`, but the old deny rule `Read(./.env.*)` also blocked it. The DevOps template and the project settings of squads now deny real env files by name (`.env`, `.env.local`, `.env.*.local`, `.env.prod*`, `.env.stag*`, `.env.dev*`, `.env.test*`, `.env.secret*`). Every other role keeps the broad `Read(./.env.*)` rule, so they stay stricter. Unusual names such as `.env.foo` would be readable by DevOps; tell us if you prefer a different rule.

5. **Set up Squad installs the team's skills by default.** The review step has a checkbox (on by default) that copies the team's bundled skills into the new project's `.claude/skills/`. On existing Floors, skills are installed only with the Install button.

6. **Skill names in agent files.** A skill that only comes from the plugin is written as `aisquad:<name>` (Claude Code's plugin namespace). Once it is installed in the project or the user's skills, its own name is used. Unknown names (for example `frappe`) are kept as written, because they may come from another plugin.

7. **Independent agents.**
   - A live `claude` process is one agent. Several processes in the same folder show as separate agents but share that folder's newest transcript for status.
   - Processes started by The AI Squad (`AISQUAD_AGENT` in their environment) and `claude -p` runs are skipped.
   - Only tmux agents have a live screen and answerable dialogs. VS Code and plain terminal sessions show their transcript.
   - **Adopt** adds a new team member from a Role Template to the chosen squad and hides the agent from Floor 1. The running session itself is not moved or stopped.

8. **Floor 1 is virtual.** It is not in `building.json` and has no settings, layout editing or budget. Its desks use the Open Space preset.

9. **Free Team Blueprints use agent teams.** Digital Marketing and Sales & CRM let the lead spawn teammates (Claude Code agent teams, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`), with the board in `docs/BOARD.md`, handoff files and a questions file. Allow rules for writing are merged into `.claude/settings.json` because background teammates cannot answer permission prompts.

10. **Source document gate.**
    - Software House: enforced by the lead's rules, the Blueprint and the `/sprint` command, which refuses to start while a source document is not `STATUS: APPROVED`.
    - Marketing and Sales: enforced by the lead's rules only.
    - There is no hook that blocks the work technically yet.

11. **Story points for performance.** PLAN.md got an `SP` column and the backlog is `docs/BACKLOG.md` with `| Story | SP | Status |` (Sprint Lead template v4). Sprints are split by their closing commits (`docs(squad): close sprint N`), and sprint 1 also counts the planning before it.

12. **Template versions.** The shipped templates got a new version (skills, category, desk props; the Project Manager also learned the Squad Sprint flow). Floors created earlier will show "Update available" for their agents.

13. **Marketplace name.** The marketplace is now named `aisquad` (it was `sopwer`), so the install command is `/plugin install aisquad@aisquad` as the brief says.

## Phase 2.1 (visual quality)

14. **Font source.** Downloading Plus Jakarta Sans (npm or GitHub) was blocked in this session, so the vendored file is the official latin variable woff2 (weights 400 to 800) found on this machine. It is the font only, with no DTamu branding. Its SIL Open Font License is in `ui/vendor/fonts/OFL.txt`, and NOTICE mentions it. If you prefer, replace it with a copy fetched from the font's own repository.

15. **Old Floors get the new office only if untouched.** A Floor whose devices are still the old default set, at the old default spots, is shown with the new office furniture; the new set is written on the next save. Floors whose furniture you arranged keep it; add the new pieces (TV, beanbags, pantry, ping-pong) in Edit Mode. Saved desk positions are kept, so old Floors may look denser until you pick a layout preset again.

## Phase 2.2 (Squad Log and Audit)

16. **`logRetentionDays` lives in `prefs`.** `building.json` only keeps `name`, `floors` and `prefs`, so the setting is `prefs.logRetentionDays` (default 90). There is no UI for it yet.

17. **What the first scan logs.** When a Floor is logged for the first time, transcripts of the last 7 days are read back (usage, tool calls, messages, questions), and commits of the last 7 days are logged. Floor 1 reads back only the last day: in the dogfood a 7-day read of this machine's other sessions gave about 47,000 events (24 MB) in one go. The board, handoffs, QA reports and bugs that already exist are taken as the baseline and not logged as new events. Events older than 7 days are never written (their day files may already be gzipped).

18. **Owner prompts come from transcripts only.** A task typed through The AI Squad and the same prompt seen by the UserPromptSubmit hook have no shared id, so `task.given` is taken from the transcript (record uuid) only. Tool calls and messages are deduplicated by their tool_use id. A teammate's message that arrives in the lead's transcript is not logged again (the sender's SendMessage is the event).

19. **Gate records need the new hook scripts.** The board and TaskCompleted gates now append their decisions to `.git/aisquad-gates.jsonl` (outside the working tree). Floors scaffolded before 0.3.0 keep their old hook copies (the pack never overwrites files), so their board-gate decisions are not logged; merge-gate results are. Copy `templates/squad-sprint/.claude/hooks/*.cjs` into such a Floor to get them.

20. **Personal data masking is pattern based.** E-mail, phone (international and Indonesian), 16-digit NIK, US SSN, IBAN and account numbers written next to "account" / "rekening" are masked. Names of people are not detected. Agent display names are not in the log (agent ids are), and the export hashes agent ids, also inside free text.

21. **The squad-audit skill is passed as a system prompt.** `claude -p` runs without tools (`--tools ""`), so the skill cannot be loaded through the Skill tool; the body of `skills/squad-audit/SKILL.md` is passed with `--append-system-prompt`. The skill is also installable like the other bundled skills.

22. **Audit scores.** Each area starts at 100 and loses 30 / 15 / 8 / 3 points per critical / high / medium / low finding. The numbers are a simple, explainable convention; tell us if you prefer a different weighting.

23. **What an audit may change.** Apply works for local Role Templates (rules, prompt, model, effort), local Blueprints (rules in a "Lessons from audits" section, which every agent of the squad reads in the standard) and four Floor settings: `budget.usd`, `sprint.autoNext`, `audit.model`, `log.messages`. Templates from a read-only library must be copied to the local library first. Findings without a target are advice and are not in the ledger.

24. **Blueprint updates on Floors.** A Floor keeps its Blueprint snapshot until you press **Update** in its Standard tab; then the snapshot, `AISQUAD.md` and the agent files get the new standard. Pack files (document skeletons) are not touched.

25. **The export contains the AI's recommendation text.** Titles and recommendations are redacted, paths and agent ids inside them are hashed, but other words stay (they are what makes the export useful). The salt for the hashes is per machine (`~/.aisquad/export-salt`), so hashes are stable across your exports but cannot be reversed by trying names.

26. **The running aisquad.service serves `ui/` from this checkout.** It runs `server/index.js` from this repository, so after a browser reload it already shows the new Log and Audit buttons while its server is still 0.2.2 (those dialogs answer "Not found" until the service is restarted with `/aisquad`). The service was not restarted, as asked.
