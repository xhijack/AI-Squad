# Phase 2.5 brief: rituals, methods and quality gates (ideas from CLAW3D and gstack)

Product owner, 26 Oct 2026: study https://www.claw3d.ai/ (3D office for AI agents, MIT) and
gstack (github.com/garrytan/gstack, Claude Code skills as an engineering team, MIT) and bring
the useful concepts into The AI Squad. **Write our own text and code; do not copy theirs.**
Build after 0.4.2, in the order below, one release per part (0.5.0, 0.5.1, ...). Same rules:
English, zero dependencies, tests per module one at a time, frugal memory (no Chrome or model
runs while swap > 80 %), one commit per step, no AI attribution, never push, do not restart the
owner's service on 8097 or touch live agent sockets.

## 1. Token-saving methods (0.5.0)

- **Investigate skill ("root cause first")** for developers and QA: no fix before the cause is
  found and written down (symptom, reproduction, cause, evidence); after **three failed fix
  attempts** stop and escalate to the lead with what was tried. Count attempts in the Log
  (`debug.attempt`, `debug.escalated`); the Audit flags loops.
- **Retro**: when a sprint closes, run the Audit as a **Retro** ritual: what went well, what did
  not, per-agent breakdown (Performance data), cost per story point trend, and 3 concrete
  changes. Shown as a Retro dialog and saved next to the audits.
- **LEARNINGS.md**: a project memory file in the repo (`docs/squad/LEARNINGS.md`): patterns and
  pitfalls of this project, short entries with date and source (retro, audit finding, bug).
  Every generated agent prompt tells agents to read it before starting a module; the lead adds
  entries after each Retro; Audit findings with target `project` write here (owner approves).

## 2. Plan reviews before the sprint (0.5.1)

- **Premise check** in `source-docs-intake`: before drafting the PRD, the lead asks the owner a
  short set of forcing questions (who exactly is the user, the painful problem today, what
  happens if we do nothing, smallest version that proves value, how we know it worked, what we
  will not build). Answers go into the PRD.
- **Scope mode** in sprint planning: the lead states one of Expand / Selective expand / Hold /
  Reduce for the sprint with a reason; changing it mid-sprint is a critical item.
- **Plan review chain** before a sprint starts: engineering review (architecture, data flow,
  edge cases, test plan), design review (score 0-10 per dimension with what would make it a
  10), security review. Only taste decisions go to the owner (fits Autopilot). Results in
  `docs/squad/sprint-<N>/PLAN-REVIEW.md`.
- **Security Engineer** role template and an optional role in the Software House Blueprint:
  OWASP / STRIDE review of the plan and before release, findings with evidence, never runs
  attacks against anything but local or staging.

## 3. Office rituals in 3D (0.5.2)

- **Meeting table** on every Floor (part of the default devices and layout presets). Sprint
  planning, plan reviews, Retro and lead-to-teammate briefings: the characters involved walk to
  the table while it happens (from Log events), then back to their desks.
- **Standup**: an automatic daily standup per Floor from the Log (per agent: done since last
  standup, doing now, blocked by), shown as a card and, at a set time, as a short meeting at the
  table. No model call needed; optional one-paragraph summary by haiku.
- **Follow agent**: a camera mode that follows one agent around (between isometric and first
  person), with a small bar to switch agents.
- **Diffs on screens**: developer monitors show the current diff of their module (added and
  removed lines coloured); QA and lead show the PR / merge status.

## 4. Shipping safety (0.5.3)

- **Ship readiness** panel per Floor / sprint: which gates and reviews ran (tests, QA per
  module, design review, security review, docs updated, rollback tried) and what is missing
  before a merge or deploy; the merge executor and the DevOps deploy check it.
- **Canary after deploy** (DevOps skill): watch health, error rate and latency for a set window
  after a staging or production deploy; roll back automatically on staging when thresholds are
  crossed, ask the owner on production.
- **Edit locks**: a hook that blocks edits outside the agent's module folders from PLAN (shared
  files only by the lead), plus warnings for destructive commands.

## 5. Design and second opinions (0.5.4)

- **Design variants** skill for the designer: when the owner gives only a mockup or a vague
  wish, produce 3-4 variants of a screen as static HTML, show them side by side in a dialog,
  the owner picks, and the choice is recorded as taste notes in `docs/DESIGN.md` for later
  rounds.
- **Second opinion**: an optional reviewer agent on a different model (e.g. sonnet reviewing
  opus work, or the reverse) for modules marked risky in PLAN; disagreements go to the lead.

## Acceptance per release

Unit tests per module, a PROGRESS section, README updates, playground screenshots at 1440 and
390 when memory allows, and the Audit able to measure the new events.
