---
name: design-review
description: "Review built screens against docs/DESIGN.md and its fidelity map, on mobile and desktop, and report findings with evidence. Use as designer after a UI module is handed off."
---
# Design review

## Steps
1. Open the screens the module built, at 390 px and 1280 px width (see `ui-evidence`).
2. Compare each against the fidelity map: every "must match" item matches; "may be improved" items are acceptable or better.
3. Check states the map lists: empty, loading, error, focus, hover, long text.
4. Report per screen: OK, or a finding with severity (Major for a must-match miss, Minor or Cosmetic otherwise), the screenshot and the expected design.
5. Findings go to the lead (and into the QA report or a bug file, as the squad standard says). Do not change product code yourself.

A screen passes the design review when there is no open Major finding.
