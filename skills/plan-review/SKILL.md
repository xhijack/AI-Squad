---
name: plan-review
description: "Review a sprint plan before anyone builds it: an engineering review (architecture, data flow, edge cases, test plan), a design review scored 0-10 per dimension with what would make it a 10, and a security review. Only taste decisions go to the owner. Writes docs/squad/sprint-<N>/PLAN-REVIEW.md. Use as the lead after writing PLAN.md and before spawning the team."
---
# Plan review

A mistake in the plan costs a whole sprint. Review it while it is still text.

## Who reviews
- **Engineering:** you (the lead), or a senior developer teammate you spawn only for the review.
- **Design:** the UI/UX designer when the team has one, otherwise you.
- **Security:** the Security Engineer when the team has one (their `security-review` skill), otherwise you with the same checklist.
Give each reviewer `docs/squad/PLAN.md`, the PRD and TECH sections the modules cite, and DESIGN for UI modules.

## 1. Engineering review
- **Architecture:** does each module fit TECH? New dependencies, new services, migrations: named and justified?
- **Data flow:** where data comes from, where it is stored, who changes it; any two modules writing the same table or file?
- **Edge cases:** empty, error, slow network, permissions, time zones and currencies, concurrent edits.
- **Test plan:** each module has acceptance criteria that QA can test, and the developer knows which tests to write.
- **Order and parallelism:** dependencies right; no two parallel modules in the same folders.

## 2. Design review (UI modules)
Score each dimension 0-10 and write what would make it a 10:

| Dimension | Score | What would make it a 10 |
|---|---|---|
| Matches DESIGN.md (fidelity map) | | |
| Empty, loading and error states | | |
| Mobile (390 px) and desktop | | |
| Accessibility (contrast, focus, labels) | | |
| Consistency with existing screens | | |

## 3. Security review
Authentication and roles, input validation, secrets handling (names only), personal data, file uploads, rate limits, dependencies with known issues. Findings with the module they belong to.

## Output: docs/squad/sprint-<N>/PLAN-REVIEW.md
```
# Plan review: sprint <N>
Scope mode: <the mode from PLAN.md>

## Engineering review
VERDICT: OK | CHANGES
- findings, each with the module and the change made to the plan

## Design review
DESIGN SCORE: <average>/10
| Dimension | Score | What would make it a 10 |

## Security review
VERDICT: OK | CHANGES
- findings with severity and module

## Decisions for the owner
- only taste decisions (look and feel, naming, which of two equal options), each asked with AskUserQuestion with a recommended option
```
Then update PLAN.md for every CHANGES finding before the team starts.

## Never
- Send the owner technical decisions you can make: decide, record, move on.
- Start the sprint with a CHANGES verdict that is not fixed in the plan.
