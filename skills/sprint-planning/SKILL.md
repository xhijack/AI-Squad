---
name: sprint-planning
description: "Plan a sprint from the approved source documents: modules with source stories, story points, owners, owned folders, dependencies and whether each can run in parallel or must wait. Use as the lead when a sprint starts."
---
# Sprint planning

## Inputs
Approved `docs/PRD.md` and `docs/TECH.md` (and DESIGN for UI work), the backlog in `docs/BACKLOG.md`, and the team in `AISQUAD.md`.

## Steps
0. **Scope mode**: decide one mode for the sprint and write it as the first line under the title of `docs/squad/PLAN.md`: `Scope mode: <Expand | Selective expand | Hold | Reduce> — <one-line reason>`.
   - Expand: the sprint takes on more than the backlog's next items (new stories the PRD allows).
   - Selective expand: mostly the next items, plus one or two named extras.
   - Hold: exactly the next items by priority.
   - Reduce: fewer items than usual (risk, a hard module, budget or memory limits).
   Changing the mode during a sprint is a **critical** decision: ask the owner with AskUserQuestion first, also under Autopilot.
1. Pick the stories for this sprint by priority. Keep the sprint small enough to finish: about 2 to 4 modules per developer.
2. Split the stories into **modules** (M01, M02, … continuing from the previous sprint). One module = one owner = one set of owned folders.
3. For every module write in `docs/squad/PLAN.md`:
   - stories (PRD ids) and TECH sections it implements,
   - SP (story points: 1, 2, 3, 5, 8),
   - owner (agent id) and owned folders,
   - depends on (modules that must be done first),
   - **parallel or sequential**: parallel when it shares no folders and no unfinished dependency; otherwise sequential, with the reason,
   - acceptance criteria (Given/When/Then; mobile, desktop, empty and error states for UI).
4. Order the work: foundations first (data model, shared layout, auth), then parallel modules, then integration.
5. Write `docs/squad/TASKS.md`: per module `BUILD Mxx <name>` (developer) and `QA Mxx <name>` (QA, blocked by BUILD).
6. Shared files (lockfiles, root config, migrations, main layout) are never owned by two developers: assign them or keep them yourself.
7. **Plan review** before spawning the team: run the `plan-review` skill (engineering, design and security review) and write `docs/squad/sprint-<N>/PLAN-REVIEW.md`. Fix what the reviews find in the plan. Only **taste** decisions (look and feel, naming, which of two equal options) go to the owner; everything else you decide and record.
8. Show the owner the plan summary (scope mode, goal, modules, what runs in parallel, the review verdicts) before spawning the team.

## Check before you start
- Every module traces back to a PRD story; nothing is planned that the PRD does not ask for.
- No two parallel modules touch the same folder.
