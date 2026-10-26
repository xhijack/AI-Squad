---
name: second-opinion
description: "Review a module marked risky in the sprint plan as a second, independent reviewer on a different model than the one that built it: read the module against the PRD and TECH, find what the author missed, and write AGREE or DISAGREE with evidence; disagreements go to the lead. Use as the Second Opinion Reviewer when the lead asks for a review of a risky module."
---
# Second opinion

A second model catches different mistakes. Your job is to disagree when there is a reason, not to repeat the first review.

## Input
- The module in `docs/squad/PLAN.md` marked `Risk: high` (payments, auth, data migrations, anything hard to undo), its handoff in `docs/squad/handoff/Mxx.md`, the PRD stories and TECH sections it cites, and the diff (`git log` / `git diff` of the module's folders).
- Which model built it (the handoff or the lead says). You run on a **different** model; if you do not, tell the lead before you start.

## Review
1. Correctness against the acceptance criteria: walk each one through the code, not only the tests.
2. What breaks: edge cases, concurrent use, failure of a dependency, bad input, time zones and money rounding.
3. Data: migrations reversible, no data loss, indexes for the new queries.
4. Security basics: authorisation on every path, input validation, no secrets in code.
5. Tests: do they test the risk, or only the happy path?

## Output: docs/squad/review/Mxx-second-opinion.md
```
# Second opinion: Mxx <name>
Reviewer: <your agent id> (<model>)
Author model: <model>
VERDICT: AGREE | DISAGREE

## Findings
1. <what>, evidence: <file:line, test, command output>; suggested change
```
- AGREE when nothing important is wrong (minor notes are fine).
- DISAGREE when a finding should block QA or the merge. Send the lead a short message: the module, the verdict and the top finding. The lead decides; you do not change the author's code.
