---
name: test-plan-from-acceptance
description: "Derive a test plan from the PRD acceptance criteria and the DESIGN screens before testing a module. Use as QA when a module is handed off, or when a sprint is planned."
---
# Test plan from acceptance criteria

## Steps
1. Read the module in `docs/squad/PLAN.md`, its PRD stories with their acceptance criteria, and the DESIGN screens it touches.
2. Turn every acceptance criterion into at least one test case: preconditions, steps, expected result. Number them (TC1, TC2, …) and keep the link to the criterion.
3. Add the cases the criteria imply: empty states, errors, permissions, boundaries, slow or failing network, and both viewports (mobile 390 px and desktop 1280 px) for every screen.
4. Mark which cases are automated (and where) and which are checked by hand.
5. Write the plan at the top of the QA report (`docs/squad/qa/Mxx.md`) before running anything.

## While testing
Report per test case: OK or FAILED, with evidence (see `ui-evidence`). A failed case becomes a bug (see `bug-report`).
The module passes only when every acceptance criterion is OK and no bug is OPEN or FIXED.
