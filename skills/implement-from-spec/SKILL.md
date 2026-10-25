---
name: implement-from-spec
description: "Build an assigned module strictly from the PRD stories, the TECH spec and the DESIGN document, in the planned order. Use as a developer when you start a module."
---
# Implement from the spec

## Before writing code
1. Read your module in `docs/squad/PLAN.md`: stories, SP, owned folders, dependencies, acceptance criteria.
2. Read the cited PRD stories, the TECH sections (stack, data model, APIs, conventions) and, for UI, the DESIGN screens and the fidelity map.
3. Check the dependencies are done. If not, tell the lead and take the next module instead of guessing.
4. List what is unclear or contradictory and ask the lead before you build on a guess.

## While building
- Stay inside your owned folders; shared files go through the lead.
- Follow the conventions in TECH (naming, folders, error handling, commit style).
- Match the design where the fidelity map says "must match"; note any deliberate deviation.
- Work test-first where it pays off (see the `tdd` skill) and keep the quality gate green.
- External services go behind an adapter with a mock and a flag when they are not available yet.

## Done means
Every acceptance criterion works, tests are green, and the handoff (see `handoff-writing`) cites the PRD story and TECH section.
