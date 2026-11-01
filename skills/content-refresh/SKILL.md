---
name: content-refresh
description: "Refresh a page whose Search Console clicks fell or that sits just off page one: diagnose from GSC and the current results, then propose a bounded update with a baseline and a re-measure date. Use for the monthly decay list or when a page underperforms the demand it targets."
---
# Content refresh

## Find the page
- The decay list: `aisquad-google` `gsc_performance` with `dimensions: ["page"]` for each of the last three months; a page whose clicks fell two months in a row is a candidate.
- Striking distance: queries at position 5 to 20 with impressions, whose page could move up.
- Never refresh a page that already ranks near the top for its main query without a clear reason; protect it instead.

## Diagnose
1. GSC with `dimensions: ["query"]` for that page (filter by reading the rows): which queries lost clicks, impressions or position.
2. WebSearch the main queries; WebFetch the pages that now rank above it. What do they answer that this page does not (newer facts, a direct answer near the top, a comparison, a table, an FAQ)?
3. Check the basics: `gsc_inspect` for index status and the canonical Google chose; `psi_run` for speed on mobile.
4. Write the observation, not a cause you cannot prove: similar content and a ranking drop do not prove a penalty.

## Propose
A DRAFT in `content/drafts/<slug>-refresh.md`: what changes and why (one bounded change set), the new answer-first paragraph, sections added or cut, facts updated with sources, FAQ, internal links, and the SEO checklist.

## Measure
Record the baseline (clicks, impressions, position for the page's queries, 28 days, with dates) in the handoff. Re-measure 28 days after the owner publishes it.

## Rules
- Drafts only; the owner approves and publishes.
- No invented numbers; date every figure.

---
Method adapted from OpenSEO's SEO audit (underperforming pages, sizing the benefit honestly) (MIT, every-app/open-seo): see LICENSE-NOTICE. Rewritten for The AI Squad to use free sources only (the `aisquad-google` tools, WebSearch / WebFetch and the site's repository); no OpenSEO or paid tool is used.
