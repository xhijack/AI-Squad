---
name: keyword-clustering
description: "Group keywords into page-level clusters by search intent and map each cluster to an existing or a proposed page, flagging cannibalisation from Search Console. Use after keyword research, before writing content briefs, or when two pages compete for the same query."
---
# Keyword clustering

The goal is a keyword map: which page targets which cluster. Similar words do not make a cluster; the same intent and the same kind of result page do.

## Steps
1. Gather the keywords: `docs/seo/KEYWORDS.md`, the latest `keyword-research` shortlist, and `aisquad-google` `gsc_performance` with `dimensions: ["query","page"]` for the pages already earning impressions.
2. Remove duplicates, irrelevant terms and terms for another product or audience.
3. Cluster by intent and page type. Split when the buyer stage, the intent or the kind of result page differs.
4. For borderline terms, WebSearch both and compare the top results: mostly the same pages means one cluster.
5. Assign each cluster to an existing URL (from the repository or GSC), a new page (label it *proposed*), or *later / do not target* with the reason.
6. Cannibalisation: the same query sending impressions to two or more URLs in GSC. Name the page to keep; propose a merge, a redirect or a change of focus to the lead.

## Output
In `docs/seo/KEYWORDS.md` (DRAFT until the lead approves):

| Cluster | Primary keyword | Intent | Target page | Priority | Evidence |
|---|---|---|---|---|---|

Then one short brief per cluster (searcher's problem, sections it needs, internal links), and the cannibalisation table only when GSC shows it.

## Rules
- Fewer than 10 usable keywords: a simple map, no forced clusters.
- SERP intent beats word similarity.
- A target page without a URL is *proposed*.

---
Method adapted from OpenSEO (MIT, every-app/open-seo): see LICENSE-NOTICE. Rewritten for The AI Squad to use free sources only (the `aisquad-google` tools, WebSearch / WebFetch and the site's repository); no OpenSEO or paid tool is used.
