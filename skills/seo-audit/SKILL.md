---
name: seo-audit
description: "Audit a site's search visibility (crawlability, metadata, structure, structured data, performance, content) against a recorded baseline and produce a prioritised plan. Use for SEO work and before content goes live."
---
# SEO audit

## Baseline first
Record today's numbers where they exist (indexed pages, impressions, clicks, positions for key terms, Core Web Vitals) with date and source.

## Check
1. **Crawling:** robots.txt, XML sitemap, canonical tags, no accidental noindex, sensible redirects, no broken links.
2. **Metadata:** unique title (≤ 60 characters) and meta description (≤ 160) per page, matching the page's intent.
3. **Structure:** one H1, logical headings, descriptive URLs, internal links to key pages.
4. **Structured data:** relevant schema.org types, valid.
5. **Performance:** LCP, CLS, INP on mobile; image sizes and formats.
6. **Content:** each target keyword maps to one page that answers the intent; no duplicate or thin pages.

## Output
A plan in `docs/seo/plan.md`: finding, impact, effort, owner, status. Fix technical issues; propose copy changes to the lead. Never use black-hat techniques.
