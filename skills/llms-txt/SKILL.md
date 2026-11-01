---
name: llms-txt
description: "Draft or review the site's llms.txt (a Markdown map of the pages an AI assistant should read) and the robots.txt rules for AI crawlers, from the template in docs/seo/llms.txt. Use in the monthly technical audit, after new key pages are published, or when an AI visibility check finds an access problem."
---
# llms.txt

`/llms.txt` is a Markdown file at the site's root (format: llmstxt.org): an H1 with the site name, a one-paragraph summary in a blockquote, then H2 sections listing the key pages as `- [Title](URL): what it answers`. It helps assistants find the pages worth citing; it is not a ranking factor and promises nothing.

## Steps
1. Read `docs/SEO-BRIEF.md`, `docs/seo/KEYWORDS.md` and `docs/seo/PROMPTS.md`: the pages that answer the priority clusters and prompts are the ones to list.
2. Check each page: WebFetch it (200, readable without login or JavaScript-only content), `aisquad-google` `gsc_inspect` (indexed, the canonical Google chose). List only canonical, indexable URLs.
3. Draft from `docs/seo/llms.txt` (the template): H1, summary, sections such as Products, Guides, Comparisons, Company, and an optional "Optional" section for secondary pages. Keep it short (under 50 links).
4. robots.txt: WebFetch it; report the rules for `OAI-SearchBot`, `ChatGPT-User`, `PerplexityBot`, `ClaudeBot`, `GPTBot`, `Google-Extended`. Propose changes; whether to allow training crawlers is the owner's decision.
5. When the site's repository is linked, put the file in a branch and open a PR; otherwise hand it to the lead as a proposal.

## Rules
- No hidden or misleading content; the summary says what the site really offers.
- Publishing the file is a change to the live site: the owner approves it.

---
Access checks adapted from OpenSEO's AI visibility audit (MIT, every-app/open-seo): see LICENSE-NOTICE. The llms.txt format follows llmstxt.org. Written for The AI Squad with free sources only (the `aisquad-google` tools, WebFetch and the site's repository); no OpenSEO or paid tool is used.
