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
