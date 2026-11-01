---
name: seo-report
description: "Write the weekly SEO & GEO report against the targets in docs/squad/KPI.md: each number with its source and date range, what changed and why it may have, what was published, and the plan for the targets that are behind. Use for the Monday report or any report the owner asks for."
---
# SEO & GEO report

Saved as `docs/reports/<date>-weekly.md`. Plain, calm words; every term of art explained once (canonical, crawler, impression).

## Sources
- `docs/squad/KPI.md`: the targets, their values and status. Use only these numbers for targets.
- `aisquad-google`: `gsc_performance` (this week against last week, with dates; Search Console lags about 2 days), `ga4_report` (organic sessions and key events), `ga4_ai_referrals`, `psi_run` (mobile score of the home page).
- `docs/seo/PROMPTS.md` (the GEO panel), `docs/BOARD.md` (what was drafted, approved and published).

## Sections
1. **This week in three lines**: the most important change, what is working, the first action.
2. **Targets**: a table from KPI.md: target, value, goal, status, source, date range.
3. **Search**: clicks, impressions, average position; the queries and pages that moved most (with GSC numbers).
4. **AI answers**: the panel's citation rate with its denominator, sessions from AI assistants.
5. **Technical**: indexing problems found, Core Web Vitals.
6. **Published and in review**: from the board.
7. **Plan for the targets that are behind**: one to three actions each, with the owner's decisions needed.
8. **How this report was made**: the calls and their date ranges; what was not available (`unknown`).

## Rules
- Observations are not causes: say "may" and what would confirm it.
- Never invent a number, a ranking or a citation; missing data is "no data", not a problem.
- A week of data is noisy: say so before calling a trend.

---
Method adapted from OpenSEO (MIT, every-app/open-seo): see LICENSE-NOTICE. Rewritten for The AI Squad to use free sources only (the `aisquad-google` tools, WebSearch / WebFetch and the site's repository); no OpenSEO or paid tool is used.
