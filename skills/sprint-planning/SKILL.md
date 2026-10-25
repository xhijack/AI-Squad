---
name: sprint-planning
description: "Plan a sprint from the approved source documents: modules with source stories, story points, owners, owned folders, dependencies and whether each can run in parallel or must wait. Use as the lead when a sprint starts."
---
# Sprint planning

## Inputs
Approved `docs/PRD.md` and `docs/TECH.md` (and DESIGN for UI work), the backlog in `docs/BACKLOG.md`, and the team in `AISQUAD.md`.

## Steps
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
7. Show the owner the plan summary (goal, modules, what runs in parallel) before spawning the team.

## Check before you start
- Every module traces back to a PRD story; nothing is planned that the PRD does not ask for.
- No two parallel modules touch the same folder.
