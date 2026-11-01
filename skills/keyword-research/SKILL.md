---
name: keyword-research
description: "Turn seed topics into a prioritised keyword shortlist from free data: Search Console queries (real impressions), WebSearch, autocomplete and People also ask. Never invents a search volume. Use for keyword work in an SEO & GEO Space, before a content brief, or when the owner asks what to target."
---
# Keyword research

## Inputs
- `docs/SEO-BRIEF.md` (offer, audience, markets and languages) and `docs/seo/KEYWORDS.md` (clusters already chosen).
- Seeds: products, problems the audience has, pages that matter, competitors named in the brief.
- The market and language: from the brief; ask the lead when it would change the result.

## Sources (free only)
- `aisquad-google` `gsc_performance` with `dimensions: ["query"]` (and `["query","page"]`): the queries already earning impressions. Pass `minImpressions` and read positions 5 to 20 as "striking distance".
- `bing_stats` (`report: queries`) when the Bing key is set.
- WebSearch for each seed: the related searches, People also ask questions and autocomplete-style variants it shows; WebFetch to read the pages that rank.
- The site's repository: which page already covers a topic.

## Steps
1. Start from first-party demand: pull GSC queries for the last 28 days. The striking-distance list (position 5 to 20, impressions >= 10) is the fastest opportunity set; work it first.
2. Normalise seeds into a few distinct angles (problem, product, comparison, location, question).
3. For each angle, WebSearch the seed and its question forms; collect variants, questions and the kind of page that ranks (guide, product, list, tool, local).
4. Remove irrelevant, duplicate, branded-only and off-intent terms.
5. Prioritise by practical opportunity, not size: fit with the offer, clear intent, a result page the site can plausibly compete in, GSC impressions where they exist.
6. Write the shortlist into `docs/seo/KEYWORDS.md` as a DRAFT section for the lead; propose, do not overwrite approved clusters.

## Output
A table: keyword, intent (know / do / buy / local), evidence (GSC impressions and position with the date range, or "WebSearch: seen in People also ask"), volume (GSC impressions, or `unknown`), the page to make or improve. Then the longer list, then risks (intent that would change the plan).

## Rules
- Never invent a search volume, difficulty or ranking. Without GSC data the volume is `unknown`.
- Say the date range of every number.
- Next step: `keyword-clustering`, then a `content-brief` per page.

---
Method adapted from OpenSEO (MIT, every-app/open-seo): see LICENSE-NOTICE. Rewritten for The AI Squad to use free sources only (the `aisquad-google` tools, WebSearch / WebFetch and the site's repository); no OpenSEO or paid tool is used.
