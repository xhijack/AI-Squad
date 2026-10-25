---
name: handoff-writing
description: "Write a complete handoff for finished work so the lead and QA can check it without asking. Use when a module or task is done, before you tell the lead."
---
# Handoff writing

Write the handoff in the place the squad standard names (Squad Sprint: `docs/squad/handoff/Mxx.md` from `docs/squad/templates/handoff.md`; other squads: `docs/handoffs/<date>-<item>.md`).

## Contents
1. **What was built**, in two or three lines.
2. **Sources:** the PRD story ids and TECH sections (or brief / ICP / offer sections) it implements.
3. **Files changed**, grouped by folder.
4. **How to check:** URL or command, test account (no real secrets), numbered steps.
5. **Acceptance criteria:** each one, checked or not, with a note.
6. **Tests:** the exact command and its result.
7. **Mocks and flags** used, **known limits** and **assumptions**.

Then send the lead a one-line message: "M03 handed off: docs/squad/handoff/M03.md, tests green, ready for QA."
