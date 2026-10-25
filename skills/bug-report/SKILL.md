---
name: bug-report
description: "File a reproducible bug report with severity, expected versus actual and evidence, linked to the acceptance criterion. Use as QA (or any agent) when something does not work as the source documents say."
---
# Bug report

Write one file per bug (Squad Sprint: `docs/squad/bugs/Mxx-Byy.md` from `docs/squad/templates/bug.md`).

## Fields
- `STATUS:` OPEN (developer sets FIXED, QA sets VERIFIED; DEFERRED only with the lead's approval)
- `OWNER:` the developer agent id of the module
- `SEVERITY:` Blocker (no workaround, blocks a main flow or loses data) · Major (a criterion fails, workaround exists) · Minor (small functional issue) · Cosmetic (visual only)
- `KIND:` Function, UI, Security or Data
- `Round:` the QA round that found it

## Body
1. **Steps to reproduce**, numbered, from a clean start.
2. **Expected**, quoting the acceptance criterion or the design.
3. **Actual**, what happened, with the error text.
4. **Evidence**: screenshot paths, console or log lines (no secrets, no personal data).

One bug per file. Do not fix product code yourself; tell the lead which module failed and why.
