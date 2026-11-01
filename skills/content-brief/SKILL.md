---
name: content-brief
description: "Write a content brief for one page from a keyword cluster: the searcher's question, the answer first, entities and FAQ to cover, sources, internal links and the SEO checklist. Use before a writer drafts or refreshes a page in an SEO & GEO Space."
---
# Content brief

One brief per page, in `docs/seo/briefs/<slug>.md`, from the template `docs/seo/briefs/TEMPLATE.md`.

## Steps
1. Take one cluster from `docs/seo/KEYWORDS.md`: primary keyword, secondary keywords, intent, target page (existing or proposed).
2. Read what ranks: WebSearch the primary keyword, WebFetch the top three to five results. Note the question they answer, the format (guide, list, comparison, tool), the entities they all mention and what they miss.
3. Read the site's own page (repository or WebFetch) if it exists.
4. Check the AI prompt panel (`docs/seo/PROMPTS.md`): which prompts this page should be cited for.
5. Write the brief:
   - **Searcher and question**: who searches and what they need to decide.
   - **Answer first**: the two or three sentences the page opens with.
   - **Outline**: H1 (one), H2s and H3s, each with what it must say.
   - **Entities and facts to cover**, with a source for each fact (the brief, `docs/BRAND.md`, or a cited public page).
   - **FAQ**: questions from People also ask and the prompt panel.
   - **Schema**: Article, FAQPage, Product, LocalBusiness or HowTo, as fits.
   - **Internal links**: from and to which pages.
   - **Checklist**: title <= 60, meta description <= 160, one H1, the answer in the first paragraph, schema valid.
   - **Baseline**: the page's GSC clicks, impressions and position for the cluster today (or "new page").

## Rules
- No invented facts, quotes, numbers or volumes; `unknown` where data is missing.
- The brief goes to the lead for review before the writer starts.

---
Method adapted from OpenSEO's keyword clustering page briefs (MIT, every-app/open-seo): see LICENSE-NOTICE. Rewritten for The AI Squad to use free sources only (the `aisquad-google` tools, WebSearch / WebFetch and the site's repository); no OpenSEO or paid tool is used.
