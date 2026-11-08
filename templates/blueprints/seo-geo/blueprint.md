---
id: seo-geo
title: SEO & GEO
version: 5
category: marketing
description: A search-only marketing team that grows organic search and visibility in AI answers from free data (Search Console, GA4, PageSpeed, Bing, IndexNow), with keyword research, technical SEO, content, a web developer who puts approved pages on the site (code, WordPress or another CMS) and a monthly AI prompt panel; nothing is published without the owner.
keywords: [seo, geo, aeo, search, "search engine", google, "search console", ranking, keywords, organic, "organic traffic", "ai answers", chatgpt, perplexity, "ai visibility", "llms.txt", "technical seo", "local seo", backlinks, content, blog, sitemap, "core web vitals", wordpress, cms, website, pencarian, "mesin pencari"]
workflow: free-team
layout: open-space
space: { kind: department, shift: { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], from: '22:00', to: '05:00' } }
mcp: [aisquad-google]
intakeDoc: docs/SITE.md
intake:
  - { id: platform, kind: choice, required: true, label: "How is the site's content managed?", options: [{ value: wordpress, label: WordPress, hint: "The web developer prepares ready-to-paste drafts; you paste and publish." }, { value: cms, label: Another CMS, hint: "Webflow, Ghost, Strapi, Shopify, Wix, ...; ready-to-paste drafts as well." }, { value: code, label: Code in a repository, hint: "Next.js, Astro, Hugo, plain HTML, ...: the web developer commits pages on a branch; you push and merge." }] }
  - { id: url, kind: url, required: true, label: "Site URL:", placeholder: "https://sopwer.id" }
  - { id: cms, kind: text, required: true, label: "Which CMS?", placeholder: "Webflow", when: { platform: cms } }
  - { id: repo, kind: repo, required: true, label: "Repository (clone URL or folder on this machine):", placeholder: "git@github.com:you/site.git", when: { platform: code }, agents: [web-developer, technical-seo-specialist], hint: "Linked to the squad with write access for the web developer and the technical SEO specialist; they commit on their own branches and never push." }
  - { id: branch, kind: branch, repo: repo, required: true, label: "Base branch for changes:", default: main, placeholder: main, when: { platform: code } }
roles:
  - { template: seo-geo-strategist, min: 1, default: 1, max: 1, lead: true, why: "Leads the squad: collects the SEO brief from you, picks the priority keywords and AI prompts, runs the board and writes the weekly report. The only one who talks to you." }
  - { template: technical-seo-specialist, min: 0, default: 1, max: 1, why: "Keeps the site crawlable, indexed and fast (robots, sitemap, canonicals, schema, Core Web Vitals, llms.txt); fixes go as a pull request to your site's repository." }
  - { template: keyword-researcher, min: 0, default: 1, max: 1, why: "Finds the keywords and questions people search from your Search Console data and the search results, clusters them and writes a brief per page. Never invents a volume." }
  - { template: content-writer, min: 0, default: 1, max: 2, why: "Writes and refreshes pages answer first, in your brand voice, with sources and an FAQ. Everything stays a draft until you approve it." }
  - { template: web-developer, min: 0, default: 1, max: 1, why: "Puts the pages you approved on the site: commits them on a branch of the site's repository, or prepares ready-to-paste drafts for WordPress or another CMS. You approve the merge (in the app or on Telegram) or publish." }
  - { template: geo-analyst, min: 0, default: 1, max: 1, why: "Checks every month whether AI answers cite you for the prompts that matter, tracks visits from AI assistants and proposes pages that are easier to cite." }
  - { template: local-seo-specialist, min: 0, default: 0, max: 1, why: "Optional, for clinics, shops and local services: Google Business Profile, name-address-phone consistency and local pages." }
sourceDocs:
  - { path: docs/SEO-BRIEF.md, title: SEO brief, purpose: "Goals, audience, offer, markets and languages, the site's repository or CMS", owner: seo-geo-strategist, readers: all }
  - { path: docs/BRAND.md, title: Brand, purpose: "Voice, words to use and to avoid, visual rules", owner: seo-geo-strategist, readers: all }
  - { path: docs/seo/KEYWORDS.md, title: Keywords, purpose: "The priority keyword clusters and the page for each", owner: seo-geo-strategist, readers: all }
  - { path: docs/seo/PROMPTS.md, title: AI prompt panel, purpose: "Up to 30 prompts a buyer asks an AI assistant, checked once a month", owner: seo-geo-strategist, readers: all }
kpis:
  - { onBehind: { task: "Research why and draft fixes only (briefs, refresh drafts, technical proposals) for the lead; publish, submit and send nothing." }, id: organic-clicks, name: Organic clicks, unit: clicks, direction: up, period: month, every: day, source: { kind: google, call: gsc.performance, args: { from: "{{from}}", to: "{{to}}" }, pick: { type: path, path: totals.clicks } }, note: "Google Search Console, web search; ends 2 days ago" }
  - { onBehind: { task: "Research why and draft fixes only (briefs, refresh drafts, technical proposals) for the lead; publish, submit and send nothing." }, id: impressions, name: Impressions, unit: impressions, direction: up, period: month, every: day, source: { kind: google, call: gsc.performance, args: { from: "{{from}}", to: "{{to}}" }, pick: { type: path, path: totals.impressions } }, note: "Google Search Console, web search" }
  - { onBehind: { task: "Research why and draft fixes only (briefs, refresh drafts, technical proposals) for the lead; publish, submit and send nothing." }, id: top10-keywords, name: Keywords in the top 10, unit: keywords, direction: up, period: month, every: day, source: { kind: google, call: gsc.performance, args: { dimensions: [query], rowLimit: 5000, minImpressions: 10, maxPosition: 10, from: "{{from}}", to: "{{to}}" }, pick: { type: path, path: count } }, note: "queries with an average position of 10 or better and at least 10 impressions" }
  - { onBehind: { task: "Research why and draft fixes only (briefs, refresh drafts, technical proposals) for the lead; publish, submit and send nothing." }, id: organic-sessions, name: Organic sessions, unit: sessions, direction: up, period: month, every: day, source: { kind: google, call: ga4.report, args: { metrics: [sessions], where: { sessionDefaultChannelGroup: Organic Search }, from: "{{from}}", to: "{{to}}" }, pick: { type: path, path: totals.sessions } }, note: "GA4, channel Organic Search" }
  - { onBehind: { task: "Research why and draft fixes only (briefs, refresh drafts, technical proposals) for the lead; publish, submit and send nothing." }, id: organic-key-events, name: Organic key events, unit: key events, direction: up, period: month, every: day, source: { kind: google, call: ga4.report, args: { metrics: [keyEvents], where: { sessionDefaultChannelGroup: Organic Search }, from: "{{from}}", to: "{{to}}" }, pick: { type: path, path: totals.keyEvents } }, note: "GA4 key events from Organic Search" }
  - { onBehind: { task: "Research why and draft fixes only (briefs, refresh drafts, technical proposals) for the lead; publish, submit and send nothing." }, id: ai-sessions, name: Sessions from AI assistants, unit: sessions, direction: up, period: month, every: day, source: { kind: google, call: ga4.aiReferrals, args: { from: "{{from}}", to: "{{to}}" }, pick: { type: path, path: total.sessions } }, note: "GA4: ChatGPT, Perplexity, Gemini, Copilot, Claude, You.com, Phind" }
  - { onBehind: { task: "Research why and draft fixes only (briefs, refresh drafts, technical proposals) for the lead; publish, submit and send nothing." }, id: ai-citations, name: AI prompt citations, unit: "%", direction: up, period: month, source: { kind: manual }, note: "from the GEO panel: cited prompts / panel size" }
  - { onBehind: { task: "Research why and draft fixes only (briefs, refresh drafts, technical proposals) for the lead; publish, submit and send nothing." }, id: mobile-score, name: Mobile performance score (home page), unit: points, direction: up, period: week, every: day, source: { kind: google, call: psi.run, args: { strategy: mobile }, pick: { type: path, path: score } }, note: "PageSpeed Insights, 0-100" }
  - { onBehind: { task: "Research why and draft fixes only (briefs, refresh drafts, technical proposals) for the lead; publish, submit and send nothing." }, id: pages-published, name: Pages published or refreshed, unit: pages, direction: up, period: month, source: { kind: manual } }
cadence:
  - { id: daily-content-draft, title: Daily content draft, agent: content-writer, every: daily, at: "22:30", budget: 1, task: "Draft the next piece on docs/BOARD.md from its content brief in docs/seo/briefs/ as a DRAFT in content/drafts/, answer first, in the voice of docs/BRAND.md, with the SEO checklist filled in. Update its row on the board. Publish nothing." }
  - { id: approved-to-site, title: Approved pages to the site, agent: web-developer, every: daily, at: "01:00", budget: 1, task: "Take the pieces on docs/BOARD.md that the owner APPROVED and that are not on the site yet, at most two, and put them on the site with the site-content-update skill, as docs/SITE.md says: a commit on your branch of the site's repository, or a ready-to-paste draft in content/ready/. Write the handoff, set each to REVIEW and tell the lead. Never push or publish." }
  - { id: gsc-anomaly, title: Search Console anomaly check, agent: technical-seo-specialist, every: daily, at: "23:00", budget: 0.5, task: "Compare Search Console clicks for the last 7 days with the 7 days before (gsc_performance, dimensions date; the data ends 2 days ago). Only if clicks fell more than 20 % week over week: find the pages and queries that lost most and write docs/seo/anomalies/<date>.md for the lead. Otherwise write nothing and stop." }
  - { id: weekly-report, title: Weekly report vs targets, agent: seo-geo-strategist, every: "weekly:mon", at: "23:30", budget: 2, task: "Write the weekly SEO & GEO report with the seo-report skill in docs/reports/<date>-weekly.md: each target from docs/squad/KPI.md with its value and status, search and AI-answer changes with their date ranges, what was published, and the plan for the targets that are behind. Use only real numbers." }
  - { id: geo-panel, title: GEO panel check (a third of the prompts), agent: geo-analyst, every: "weekly:wed", at: "23:00", budget: 1.5, task: "Check the third of docs/seo/PROMPTS.md that is due this week with the ai-visibility-audit skill (WebSearch each prompt as written; record brand named, site cited, competitors and sources, with the date), so each prompt is checked once a month. Read ga4_ai_referrals. Propose at most three changes to the lead. Send nothing." }
  - { id: technical-audit, title: Full technical audit, agent: technical-seo-specialist, every: "monthly:1", at: "00:00", budget: 3, task: "Run the full technical audit with the seo-audit skill: crawling, indexing (gsc_inspect for the key URLs), canonicals, redirects, schema, Core Web Vitals (psi_run mobile and desktop), AI search access and llms.txt. Write docs/seo/AUDIT.md and the prioritised fixes in docs/seo/plan.md, each with a baseline. Fixes go as a branch or PR; change nothing live." }
  - { id: decay-list, title: Decay list for refresh, agent: keyword-researcher, every: "monthly:1", at: "00:30", budget: 1, task: "Find the pages whose Search Console clicks fell two months in a row (gsc_performance, dimensions page, for each of the last three months). Write docs/seo/decay/<yyyy-mm>.md: page, clicks per month, the queries that dropped, and a refresh proposal per page (content-refresh). Add the top three to docs/BOARD.md as TODO for the lead." }
  - { id: strategy-review, title: Strategy and cluster review, agent: seo-geo-strategist, every: "quarterly:1", at: "01:00", budget: 3, task: "Review the quarter: targets against goals, which clusters in docs/seo/KEYWORDS.md and which prompts in docs/seo/PROMPTS.md earned results, and propose the next quarter's clusters and prompts in docs/seo/plan.md as a DRAFT for the owner. Change no approved document yourself." }
flows:
  A content piece:
    - { by: keyword-researcher, does: "Writes the brief from Search Console queries and the search results", status: TODO }
    - { by: content-writer, does: "Drafts it answer first, in the brand voice, with sources", status: DRAFT }
    - { by: lead, does: "Checks brand, facts and the SEO checklist", status: REVIEW }
    - { by: owner, does: "Approves the draft", status: APPROVED }
    - { by: web-developer, does: "Puts it on the site: a commit on a branch, or a ready-to-paste CMS draft", status: REVIEW }
    - { by: technical-seo-specialist, does: "Checks the site change against the SEO checklist" }
    - { by: owner, does: "Approves the merge (in the app or on Telegram), or pastes and publishes", status: PUBLISHED }
    - { by: lead, does: "Re-measures it after 28 days in the weekly report", status: MEASURED }
  A technical fix:
    - { by: technical-seo-specialist, does: "Finds it in the audit or the daily anomaly check, with a baseline" }
    - { by: technical-seo-specialist, does: "Fixes it on a branch of the site's repository, or writes a proposal" }
    - { by: owner, does: "Approves the merge (in the app or on Telegram), or applies the proposal" }
    - { by: lead, does: "Re-measures it after 28 days in the weekly report" }
  The AI prompt panel:
    - { by: geo-analyst, does: "Checks a third of the prompts every week" }
    - { by: geo-analyst, does: "Proposes at most three changes to the lead" }
    - { by: owner, does: "Picks the changes to make; they become content pieces or technical fixes" }
  A local listing:
    - { by: local-seo-specialist, does: "Drafts profile updates and review replies", optional: true }
    - { by: owner, does: "Posts them on Google Business Profile" }
gates: [source documents approved, baseline recorded before every change, brand and voice review, fact check, SEO checklist per piece, technical SEO check of the site change, owner approval before publishing, re-measure after 28 days]
ownerOnly: [publishing, pushing or merging to the site's repository, live copy, IndexNow submit, outreach e-mail, paid SEO tools, black-hat techniques]
kickoff: "Start as the lead of this squad. Read AISQUAD.md (the squad standard) first. Then ask me, in my language and one step at a time, for the SEO brief, the brand rules and Google access (how the site is managed is in docs/SITE.md; for a site in code, link its repository in Floor settings → Repositories if it is not linked yet): explain how to add the service account's e-mail in Search Console and GA4 and where to enter the properties: Floor settings → Google (in the office: the Floor menu ⋯ → Google; or Admin → Spaces → this Space → All settings → Google). Draft missing documents in docs/ for my approval. No content or technical change starts before the brief, brand, keywords and prompt panel are approved and a baseline is recorded."
---
## Purpose
A search-only marketing team: more organic search traffic and more citations in AI answers, from free official data, with every change measured against a baseline. Publishing, live changes, IndexNow submits and outreach wait for the owner.

## Shift
The squad works at night (22:00-05:00, every day): automated work waits for the shift and its results reach the owner in the morning digest. Change it in Admin → Spaces.

## Source documents
The documents below are the main reference for every agent. Each starts with a `STATUS:` line (`DRAFT` or `APPROVED`).

| Document | Purpose | Owner | Read by |
|---|---|---|---|
| `docs/SEO-BRIEF.md` | Goals, audience, offer, markets and languages, the site's repository or CMS | SEO & GEO Strategist | everyone |
| `docs/BRAND.md` | Voice, words to use and to avoid, visual rules | SEO & GEO Strategist | everyone |
| `docs/seo/KEYWORDS.md` | Priority keyword clusters and their pages | SEO & GEO Strategist | everyone |
| `docs/seo/PROMPTS.md` | The AI prompt panel (up to 30 prompts) | SEO & GEO Strategist | everyone |

## Data
Free official sources only, through the `aisquad-google` tools (the server makes every call; no agent holds a key): Search Console performance and URL Inspection, GA4 reports and sessions from AI assistants, PageSpeed Insights, Bing Webmaster stats, and IndexNow (the only write, the owner approves it). Besides them: WebSearch, WebFetch and the site's repository. How the site is managed (WordPress, another CMS, or code with its repository and base branch) is in `docs/SITE.md`. No paid SEO tool unless the owner added and approved one. Search Console data lags about 2 days.

## Channels
- **Owner ↔ squad:** only the lead ({{lead}}) talks to the owner. Everyone else writes questions to `docs/QUESTIONS.md` and tells the lead.
- **Lead ↔ teammates:** the lead spawns teammates with their agent ids as names; teammates reach the lead with SendMessage to `main`.
- **Handoff files:** finished pieces go in `docs/handoffs/<date>-<piece>.md`; drafts live in `content/drafts/`; briefs in `docs/seo/briefs/`; ready-to-paste CMS drafts in `content/ready/<slug>/`.
- **From draft to site:** writer drafts → lead reviews → owner APPROVES → web developer commits it on a branch of the site's repository (or prepares it for the CMS) → technical SEO checks it → the web developer asks for the merge in the Outbox; the server pushes the branch, the owner reads it and says yes (in the app or on Telegram), the server merges and pushes the main branch (or, for a CMS, the owner pastes and publishes).
- **Board:** `docs/BOARD.md` lists every piece: owner, cluster or prompt, target, due date, status (TODO / DRAFT / REVIEW / APPROVED / PUBLISHED / MEASURED).

## Work items
A **piece** is one deliverable: a page to write or refresh, a technical fix, a content brief, a GEO panel check, a report. Each names its cluster or prompts, its target, its baseline and its source documents.

## Hard stops
- No push or merge to the site's repository, no publishing, no change to live copy, no IndexNow submit and no outreach e-mail without the owner's approval.
- No black-hat techniques: hidden text, keyword stuffing, link schemes, AI spam pages.
- No paid SEO tool calls unless the owner has added and approved one (it is marked "costs money" and never runs by itself).
- Never invent a ranking, a volume, a citation or a quote.

## When behind
A target behind its goal raises, by mode: supervised, a plan for the owner to approve (`suggest`); manual, a notice (`notify`); automatic, the agents act (`act`), but only drafting and research, never publishing.

## Gates
1. **Source documents approved:** the brief, brand, keywords and prompt panel are approved before work starts.
2. **Baseline recorded:** before every change, its numbers with dates (GSC, GA4, PageSpeed).
3. **Brand and voice review:** the lead checks every piece against `docs/BRAND.md`.
4. **Fact check:** every claim has a source in the brief or a cited public source.
5. **SEO checklist per piece:** title ≤ 60 characters, meta description ≤ 160, one H1, valid schema, internal links, the answer in the first paragraph.
6. **Technical SEO check of the site change:** the technical SEO specialist checks the web developer's branch or ready-to-paste draft against the SEO checklist.
7. **Owner approval before publishing**, and before any IndexNow submit.
8. **Re-measure after 28 days:** the result against the baseline goes into the weekly report.

## Definition of done
A piece is done when it passed the gates, the owner published it, and it was re-measured after 28 days.

## Rules per role

### seo-geo-strategist
- Before any work, get the SEO brief, the brand rules, the site and Google access; draft missing documents from an interview and get them approved.
- Every task you give names its cluster or prompts, its target and its baseline.

### technical-seo-specialist
- Fixes go as a branch or PR to the site's repository; without one, as a proposal. Record a baseline first.
- Check every piece the web developer sets to REVIEW (its branch or `content/ready/` folder) against the SEO checklist before the lead takes it to the owner.

### web-developer
- Only APPROVED pieces, the wording unchanged; code on your own branch from the base branch in `docs/SITE.md`, CMS as ready-to-paste drafts. Never push, merge or publish.

### keyword-researcher
- Volumes are Search Console impressions with dates, or "unknown"; never an estimate.

### content-writer
- Answer first, in the voice of `docs/BRAND.md`, every claim sourced; drafts only.

### geo-analyst
- Record only citations you saw, with the date; rates with their denominator.

### local-seo-specialist
- No fake reviews; profile changes and review replies are drafts for the owner.
