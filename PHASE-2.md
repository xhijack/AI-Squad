# Phase 2 brief: squad-3d parity, install, first-run scan, Set up Squad, Blueprints, built-in skills

Product owner decisions, 25 Oct 2026. Read `SPEC.md`, `CLAUDE.md` and `PROGRESS.md` first. Every
naming rule in `SPEC.md` (English everywhere, zero dependencies) still applies. Build in the order
below, one Conventional Commit per step, tests per server module, and update `PROGRESS.md`
at the end of each part.

## Product goal (owner's words, summarized)

1. The owner installs The AI Squad (best-practice install, see B).
2. On first run it scans the agents that already exist on the machine. If five Claude Code
   agents are running on their own, they show up as five **independent agents**. They are not
   forced into a team.
3. The owner clicks **Set up Squad**. The first squad gets **Floor 2**, the next Floor 3, and so on.
4. The owner either picks agents from a catalog by skill, or describes what they want to build
   ("a software house", "digital marketing", "sales CRM"). The AI Squad then recommends a team
   **and how that team communicates**. This communication standard is what makes a squad an
   integrated team instead of a bunch of agents.
5. Every agent comes with built-in skills, for every kind of squad, not only software.

## A. Port the remaining squad-3d features

Reference: `/home/erpnext/dtamu/squad-3d/` (`server.js`, `index.html`; read, do not modify).
Reuse ideas and code; rename everything to English.

1. **First person view**: click a character (not the name tag) while it walks or sits, and the
   camera goes to the agent's eyes. Drag to look around, Esc returns. Hide the bottom dock and
   top bar in this view and in the screen view.
2. **Desk props**: keyboard with keys, mouse, mug, plus a small toy per role (e.g. lead trophy +
   cactus, developers rubik / rubber duck / robot, QA ladybug + magnifier). The desk laptop shows
   a role-specific screen (developer: code window, QA: test runner / last screenshot, lead: mini
   board). Props are part of the role template appearance, so other roles can set their own.
3. **Performance dialog**: per agent and per sprint, from `docs/squad` files: bugs found by QA
   per story point (weights Blocker 5, Major 3, Minor 1, Cosmetic 0.5), first-round QA pass rate,
   modules owned, cost per story point. Works only for squad-sprint Floors; hide it elsewhere.
4. **Cost projection**: cost per story point and a projection for the remaining backlog.
5. **Lead shout**: when every agent of a Floor has been idle for at least 20 s, the lead shows
   a speech bubble ("Boss! We are idle...") and, if the owner turned voice on, speaks it with
   `speechSynthesis`. Repeat every 2 to 3 minutes, at most 6 times per idle period. Voice toggle
   in the dock.
6. **Server meter**: dock chip with CPU / RAM / swap / disk (red when dangerous), dialog with a
   6-minute graph, process groups and the busiest processes, and a 3D server rack in a corner
   whose LEDs follow the load. Sample `/proc` every 3 s on the server.

## B. Install (best practice)

- The GitHub repo is both the source and a **Claude Code plugin marketplace**. Install:
  `/plugin marketplace add <owner>/aisquad`, then `/plugin install aisquad@aisquad`.
  Update with `/plugin marketplace update` + `/plugin update`. Contributors `git clone`.
- `/aisquad` starts the server as a **systemd user service** (`aisquad.service`, generated with
  the plugin's current path and `node` path, `Restart=always`) so it survives closing the
  terminal or VS Code. Fall back to a detached process when systemd is missing (macOS: launchd
  agent or plain detached process). `/aisquad stop` stops it, `/aisquad status` reports it.
- README: an Install section with these exact steps, and an Uninstall section.
- The remote does not exist yet; the owner will create it. Do not push.

## C. First-run scan and independent agents

- On first run (and with a "Rescan" button) detect existing agents: live Claude Code processes,
  tmux panes running `claude`, and projects with recent transcripts in `~/.claude/projects`.
- **Floor 1 is reserved for independent agents** (decision for now). Each detected agent that is
  not on a squad Floor gets a desk there with its live status, screen, transcript and Attention.
  Nothing is written into their repos.
- Each independent agent can later be **adopted** into a squad (moves to that Floor's team).
- Squads start at Floor 2. Existing Floors created earlier are renumbered from 2 if needed.

## D. Set up Squad

A wizard reached from a big **Set up Squad** button in the Lobby:

1. **What do you want to build?** A prompt box ("I want a software house that builds my
   restaurant POS") plus Blueprint cards (Software House, Digital Marketing, Sales & CRM).
   From the prompt, recommend a Blueprint and a team using `claude -p` (fallback: keyword
   match when Claude Code is unavailable). Show why each agent is recommended.
2. **Team**: the recommended agents, editable. "Add agent" opens the catalog of Role Templates,
   filterable by skill and category. Each card shows model, skills and what the role does.
3. **Folder**: one squad = one project folder. Choose an existing repo, or let The AI Squad
   create a new folder automatically (default `~/aisquad-squads/<slug>`, `git init`, setting in
   `building.json`). Owner approved this.
4. **Review and create**: writes the Floor files, the Blueprint's workflow pack and agent files,
   assigns the next free Floor number (2+), and offers to start the lead.

## E. Squad Blueprints (the communication standard)

A Blueprint is a versioned template for a whole squad, stored like Role Templates
(`templates/blueprints/<id>/blueprint.md` + workflow pack files). It defines:

- **Roles** and how many of each (min/default/max), and who the **lead** is.
- **Source documents**: the documents every agent treats as the main reference, where they live,
  who owns them, and who must read them.
- **Channels**: who talks to whom and how (SendMessage to the lead, handoff files, board,
  questions file to the owner). Agents never talk to the owner directly except through the lead
  and the questions file, unless the Blueprint says otherwise.
- **Work items, handoff format, gates and definition of done.**
- The Blueprint is written into `AISQUAD.md` and into every generated agent prompt, so every
  agent knows the standard.

### Software House (generalizes the current Squad Sprint)

Roles: Project Manager (lead), Developers (1 to 4), QA Engineer, UI/UX / Web Designer, DevOps
Engineer. Source documents in `docs/`:

| Document | Purpose |
|---|---|
| `docs/PRD.md` | What and why: users, features, acceptance criteria, priorities |
| `docs/TECH.md` | How: architecture, stack, data model, APIs, conventions |
| `docs/DESIGN.md` (+ `docs/design/`) | Screens, design system, mockups and which parts are fixed |
| `docs/ENVIRONMENTS.md` | Development / staging / production: URLs, services, how to deploy, which env vars exist (names only, never values) |

Rules per role:

- **PM**: before the first sprint, **must ask the owner** for PRD, Tech Spec and Design Document.
  If one is missing, the PM interviews the owner and drafts it for approval; no sprint starts
  until all three are approved. The PM splits work from these documents: each module lists its
  source stories, dependencies, and whether it can run **in parallel** or must wait.
- **Developer**: works only from assigned modules, follows the order and dependencies in the
  plan, cites the PRD story and TECH section in the handoff.
- **QA**: derives the test plan from PRD acceptance criteria and DESIGN screens; reports per
  criterion with evidence (screenshots at mobile and desktop width).
- **Designer**: when the owner gave only mockups, writes a fidelity map in `docs/DESIGN.md`:
  what **must match** exactly and what **may be improved**, with reasons. Reviews built screens
  against it. Does not invent screens outside the PRD.
- **DevOps**: owns `docs/ENVIRONMENTS.md` and `.env.example`, keeps dev and production setups
  separate, writes deploy and rollback steps. Never reads or writes real secrets.

### Digital Marketing

Lead: Marketing Strategist. Roles: SEO Specialist, Content Writer, Social Media Specialist,
Ads & Analytics Specialist, Designer (optional). Source documents: `docs/MARKETING-BRIEF.md`
(goals, audience, offer, KPIs), `docs/BRAND.md` (voice, visual rules), `docs/CHANNELS.md`
(channel plan and calendar). The lead must ask the owner for them first, same rule as the PM.
Gates: brand/voice review, fact check, KPI report.

### Sales & CRM

Lead: Sales Manager. Roles: Lead Researcher (SDR), CRM Administrator, Sales Copywriter,
Sales Analyst. Source documents: `docs/ICP.md` (ideal customer profile), `docs/OFFER.md`
(products, pricing rules, objections), `docs/PIPELINE.md` (stages, exit criteria, CRM fields).
Gates: data hygiene check, approval before any outbound message is sent. Personal data rules:
contact data never goes into logs or commits.

## F. Built-in skills for every role

- Bundle skills in the plugin under `skills/<name>/SKILL.md` (standard Claude Code skill format),
  written by us in English. Do not copy third-party skill text; you may read
  `/home/erpnext/dtamu/design-skills/` for ideas only.
- Every Role Template lists its skills. Minimum set:
  - PM: `source-docs-intake` (collect/draft PRD, Tech, Design, Environments), `sprint-planning`
    (modules, dependencies, parallel vs sequential), `handoff-review`.
  - Developer: `implement-from-spec`, `tdd`, `handoff-writing`.
  - QA: `test-plan-from-acceptance`, `ui-evidence` (screenshots, mobile + desktop), `bug-report`.
  - Designer: `design-fidelity-map`, `design-review`, `accessibility-check`.
  - DevOps: `environment-matrix`, `deploy-and-rollback`, `secrets-hygiene`.
  - Marketing: `marketing-brief-intake`, `seo-audit`, `content-calendar`, `brand-voice-check`,
    `campaign-report`.
  - Sales: `icp-intake`, `lead-qualification`, `crm-hygiene`, `outreach-copy`, `pipeline-report`.
- The Desk profile shows each skill and whether it is installed/available; missing skills get
  an "Install" action (copy from the bundled skills into the project's `.claude/skills/`).

## Constraints

- Machine is shared (16 GB RAM, about 13 GB disk free). Run tests one module at a time, at most
  one headless Chrome at a time, no Docker, no heavy installs.
- Use haiku for any real Claude Code dogfood run.
- Do not touch `/home/erpnext/dtamu/*`, `/home/erpnext/sopwer-squad` or ports other than 8097.
- When done, write a Phase 2 section in `PROGRESS.md` with what works, what was verified and
  known gaps.
