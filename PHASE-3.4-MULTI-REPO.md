# Phase 3.4 brief: one squad, several repositories

Product owner, 26 Oct 2026: a squad like DTamu works across several repositories. Decision:
**one squad = one primary repository + linked repositories**. Build after Phase 3.3, as a minor
release. Same rules as always.

## Model

- The **primary repository** holds the Floor (`.claude/aisquad/*`, AISQUAD.md, docs/squad, the
  board). The lead lives here.
- **Linked repositories** are listed in `.claude/aisquad/repos.json` (in the primary repo, shared
  through git): `{ id, path (relative, e.g. ../dtamu-bukutamu), remote (git URL), access:
  "read" | "write", branch strategy, test / gate command, owner agents }`. No absolute paths in
  the repo; the absolute path per machine is resolved locally (`building.json`). Missing on a
  new machine: offer "Clone" with the remote.
- **Access per repository**: `read` = agents may read it for context (Claude Code `--add-dir`)
  but every write tool and git write is denied for that path; `write` = the assigned agents may
  edit and commit there on their sprint branch. Never push (unchanged).
- **Agents per repository**: an agent can be assigned to one or more repositories; it gets
  `--add-dir` for each and write permission only where it is assigned and access is `write`.
  The Desk and the name tag show the agent's repositories.
- **Lead and board**: modules in PLAN/TASKS name their repository; a module may span two repos
  (e.g. contract change in the primary, adaptation in a linked one). Gates (tests, QA, ship
  readiness, merges) run per repository touched. The Log records the repository of every
  tool call and commit; the Audit reports per repository.
- **Merges**: per repository, each with its own approval and gate command.

## UI

- Set up Squad, step Folder: the primary repository plus "+ Add linked repository" (path or
  clone URL, access read/write, which agents).
- Floor Settings → Repositories: list, access, branch, gate, status (branch, ahead/behind, dirty),
  Clone / Relink.
- 3D: a small repository badge on desks.

## First real use: DTamu

Primary `dtamu-app` (Floor dtamu-app-squad). Linked: `../dtamu-bukutamu` **read only** (the
dtamu-app CLAUDE.md says the squad does not change that repo; contract changes are written in
the module handoff for its maintainer), `../dtamu-landing-page` **write** (for an SEO / content
agent). Do not change the live DTamu agents while they run: write the config, and it applies on
the next start / resume.

## Acceptance

Unit tests for repos.json validation (no absolute paths, unknown access refused), permission
generation (read-only paths really deny Edit/Write/Bash git writes), add-dir arguments, per-repo
gates and merges; a playground squad with two repos; README "Several repositories"; PROGRESS.
