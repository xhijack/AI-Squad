---
name: prd-writing
description: "Write a PRD engineering can build from: the problem with its evidence, who has it, the smallest version, acceptance criteria, out of scope, and the number that says it worked. Use as the product lead before anything goes to engineering, and to record the result after it shipped."
---
# Write a PRD

One PRD per feature or change, in `docs/prd/<short-name>.md`, starting with `STATUS: DRAFT`.

## The sections
1. **Problem**: one paragraph in the user's words. Who has it, how often, what it costs them.
2. **Evidence**: research findings and feedback items, each with its source and date (`docs/RESEARCH.md`, the Company
   Brain's `research/`, a support ticket id). No evidence: say so, and make the first step a cheap test.
3. **Goal and measure**: the number that moves (a target in `docs/squad/KPI.md` when there is one), its value now, the
   value we expect, and when we measure it.
4. **The smallest version**: what we build first; what can wait.
5. **Acceptance criteria**: numbered, testable ("Given … when … then …"); QA tests these and nothing vaguer.
6. **Out of scope**: what we explicitly do not do now.
7. **Screens and flows**: links to the designer's work, or "to design".
8. **Risks and open questions**: each with who decides.

## Rules
- Write for engineering: no marketing words, no "should be fast" without a number.
- The owner approves (`STATUS: APPROVED`) before it is handed over; changes after approval go back to the owner.
- After shipping, add **Result**: the measured number, the date, and what we learned (propose it to the Company
  Brain when the whole company should know it).
