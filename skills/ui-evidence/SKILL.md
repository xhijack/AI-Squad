---
name: ui-evidence
description: "Capture visual evidence for UI checks: screenshots at mobile (390 px) and desktop (1280 px) width for every screen and state tested, named and referenced in the QA report. Use as QA or designer when checking screens."
---
# UI evidence

## Rules
- Every screen and state you check gets two screenshots: **mobile 390 × 844** and **desktop 1280 × 800**.
- Name files `Mxx-<screen>-<state>-<width>.png` (for example `M03-checkout-error-390.png`) and store them in `docs/squad/qa/screenshots/` (The AI Squad shows the newest one on the QA desk).
- Use the browser tool the project has (Playwright, a headless browser script, or an MCP browser). One browser at a time on shared machines; close it when done.
- Capture the state the criterion is about: after the action, with the message or result visible.
- Reference each screenshot in the QA report next to the test case it proves.

## Also check while you are there
Text overflow, touch targets at least 44 px, visible focus, horizontal scrolling on mobile, console errors (note them in the report).

Never put real customer data or secrets in a screenshot.
