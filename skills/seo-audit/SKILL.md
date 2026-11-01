---
name: seo-audit
description: "Audit a site's search visibility (crawlability, indexing, metadata, structure, structured data, performance, content, access for AI search) against a recorded baseline and produce a short prioritised plan. Use for SEO work, the monthly technical audit and before content goes live."
---
# SEO audit

## Baseline first
Record today's numbers where they exist (indexed pages, impressions, clicks, positions for key terms, Core Web Vitals) with date and source. In an SEO & GEO Space the `aisquad-google` tools give them: `gsc_performance` (28 days, with dates; it lags about 2 days), `gsc_inspect` (index status of up to 20 key URLs), `psi_run` (mobile and desktop). One snapshot is a baseline, not a trend.

## Orient
Read the sitemap and the navigation and write down the site's page families (product, pricing, comparisons, guides, categories, services, locations: whatever it has). A broken or nearly empty crawl (certificate error, 5xx, one page, a dead domain with a live successor) is investigated before anything else.

## Check
1. **Crawling and indexing:** robots.txt, XML sitemap, canonical tags, no accidental noindex, sensible redirects, no broken links; `gsc_inspect` for the URLs that matter (the canonical Google chose, coverage).
2. **Metadata:** unique title (≤ 60 characters) and meta description (≤ 160) per page, matching the page's intent.
3. **Structure:** one H1, logical headings, descriptive URLs, internal links to key pages.
4. **Structured data:** relevant schema.org types, valid.
5. **Performance:** LCP, CLS, INP on mobile; image sizes and formats.
6. **Content:** for each family that could bring buyers, read two pages (the best and a typical one in GSC): does it answer its searcher's question with specific, sourced facts, or swap a name into a shared template? Each target keyword maps to one page; no duplicate or thin pages.
7. **AI search access:** robots.txt rules for `OAI-SearchBot`, `PerplexityBot`, `ClaudeBot`, `GPTBot`, `Google-Extended` (say what each controls), and `/llms.txt` (the `llms-txt` skill).

## Shortlist, then choose
Write five to ten candidates from at least three kinds (an underperforming page, demand with no page, a winning page to protect, an access or indexing defect, helping visitors take the next step): page, problem, evidence with dates, change, effort, main uncertainty. Prefer a bounded change that fixes a demonstrated problem; an access or indexing blocker or a measured traffic loss jumps the queue. Never recommend rewriting a page that already ranks near the top for its query. Every candidate ends as a recommendation or a line in "what else we checked" with a reason.

## Size honestly
Name the mechanism (a new ranking, a higher position, more clicks at the same position). Impressions are not visits; a page that ranks already gets part of them. No invented conversion rate, revenue or volume: without a number, give a direction and why.

## Output
A plan in `docs/seo/plan.md` (and the full audit in `docs/seo/AUDIT.md`): finding, impact, effort, owner, status, then "what else we checked". Fix technical issues as a branch or PR when the site's repository is linked; propose copy changes to the lead. Never use black-hat techniques. Observations are not causes: similar pages and uneven rankings never prove a penalty.

---
Audit steps merged from OpenSEO's SEO audit (MIT, every-app/open-seo): see LICENSE-NOTICE. Uses free sources only (the `aisquad-google` tools, WebSearch / WebFetch and the site's repository); no OpenSEO or paid tool is used.
