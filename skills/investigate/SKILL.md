---
name: investigate
description: "Root cause first: before fixing a bug or a failing test, find and write down the cause (symptom, reproduction, cause, evidence); count fix attempts and stop after three failed ones to escalate to the lead with what was tried. Use as a developer or QA whenever something fails and the reason is not obvious, before changing code to make it pass."
---
# Investigate (root cause first)

Guessing at fixes burns tokens and hides the real problem. Find the cause, then fix it once.

## The record: docs/squad/debug/<slug>.md
One file per problem (`docs/debug/` on Floors without a `docs/squad` folder). Start it before you change any code:

```
# <short name of the problem>
Owner: <your agent id>
Module: <M03, or the area>
STATUS: INVESTIGATING

## Symptom
What fails, exactly (the error, the wrong output, the test name).
## Reproduction
The shortest steps or command that show it every time.
## Cause
What is actually wrong and where (file and line), once you know it.
## Evidence
What proves the cause: a log line, a failing assertion, a value you printed, a git blame.
```

## Steps
1. **Reproduce** it first. If you cannot reproduce it, write that down and what you tried; do not fix blind.
2. **Narrow it down:** read the error and the code path, check recent changes (`git log -p` on the files), add one temporary print or a smaller test. Change one thing at a time.
3. **Write the cause and the evidence** in the record before writing the fix.
4. **Fix** the cause, not the symptom. Add or keep a test that fails without the fix.

## Attempts
Each fix you try that does not make the problem go away is an attempt. Add a section for every one:

```
## Attempt 1
Tried: what you changed and why you thought it was the cause.
Result: what happened.
```

- After **three failed attempts**, stop. Set `STATUS: ESCALATED`, add `## Escalation` with what you know, what you tried and what you suspect, and tell the lead (SendMessage, or the owner if you work for them directly). Do not start a fourth guess.
- When it is fixed: `STATUS: FIXED`, the commit, and one line for `docs/squad/LEARNINGS.md` if others could hit the same pitfall.

## Never
- Weaken or delete a test to make it pass, or skip it, unless the test itself is wrong. If it is, say why in the record.
- Fix several unrelated things in one attempt.
