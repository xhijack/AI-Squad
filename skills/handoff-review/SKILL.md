---
name: handoff-review
description: "Review a teammate's handoff before it goes to QA or the owner: does it cite its sources, meet the acceptance criteria, pass the gates and stay in scope. Use as the lead whenever a handoff arrives."
---
# Handoff review

## Check every handoff for
1. **Sources:** it names the PRD story / brief section and the TECH section (or the Blueprint's source document) it implements.
2. **Scope:** it changes only what its module or item asked for, in its owned folders.
3. **Acceptance criteria:** each criterion is listed and marked met, with how to check it.
4. **Gates:** the test command and its result (green), or the Blueprint's gate result (brand/voice, fact check, data hygiene).
5. **Honesty:** mocks, flags, known limits and assumptions are written down.
6. **Hygiene:** no secrets, no personal data, no unrelated refactors.

## Then
- Complete and correct: move it on (to QA, or to the owner for approval) and update the board.
- Something missing: send it back to the author with a numbered list of what to fix. Do not fix it yourself.
- A document turned out wrong: update the source document (with the owner's approval when it changes scope) before the work continues.
