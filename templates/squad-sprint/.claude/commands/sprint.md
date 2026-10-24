---
description: Start the next Squad Sprint as the lead (for example /sprint 2)
argument-hint: <sprint number>
---
New sprint: **$ARGUMENTS**.

1. Set the `SPRINT=` line in `.claude/squad/config.sh` to `SPRINT="$ARGUMENTS"`.
2. Check that the previous sprint is closed (`docs/squad/sprint-<previous>/RELEASE.md` exists and its closing
   commit `docs(squad): close sprint <previous>` is merged into main). If not, tell the owner what is left
   and ask whether to finish it first.
3. Switch to branch `sprint-$ARGUMENTS`, created from the latest main.
4. Start a clean board: the previous sprint's handoff/, qa/ and bugs/ files belong in `docs/squad/sprint-<previous>/`;
   write a new `docs/squad/PLAN.md` and `docs/squad/TASKS.md`.
5. Run your role as lead (Phase 0 to Phase 5) for this sprint. Module numbers continue from the previous sprint.
