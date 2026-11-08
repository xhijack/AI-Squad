---
id: digital-marketing
title: Digital Marketing
version: 7
category: marketing
description: A marketing team that turns a brief, brand rules and a channel plan into content, social posts, SEO and campaigns, and reports results against KPIs.
keywords: [marketing, digital marketing, seo, content, blog, social, "social media", instagram, tiktok, linkedin, facebook, ads, advertising, campaign, brand, branding, awareness, traffic, newsletter, email marketing, influencer, launch, growth, audience, followers, copywriting]
workflow: free-team
layout: open-space
space: { kind: department, shift: { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], from: '22:00', to: '05:00' } }
intakeDoc: docs/SITE.md
intake:
  - { id: platform, kind: choice, required: true, label: "How is the site's content managed?", options: [{ value: wordpress, label: WordPress, hint: "The web developer prepares ready-to-paste drafts; you paste and publish." }, { value: cms, label: Another CMS, hint: "Webflow, Ghost, Strapi, Shopify, Wix, ...; ready-to-paste drafts as well." }, { value: code, label: Code in a repository, hint: "Next.js, Astro, Hugo, plain HTML, ...: the web developer commits pages on a branch; you push and merge." }] }
  - { id: url, kind: url, required: true, label: "Site URL:", placeholder: "https://sopwer.id" }
  - { id: cms, kind: text, required: true, label: "Which CMS?", placeholder: "Webflow", when: { platform: cms } }
  - { id: repo, kind: repo, required: true, label: "Repository (clone URL or folder on this machine):", placeholder: "git@github.com:you/site.git", when: { platform: code }, agents: [web-developer, seo-specialist], hint: "Linked to the squad with write access for the roles that change the site; they commit on their own branches and never push." }
  - { id: branch, kind: branch, repo: repo, required: true, label: "Base branch for changes:", default: main, placeholder: main, when: { platform: code } }
  - { id: channels, kind: text, required: true, label: "Which channels do you post on?", placeholder: "Instagram, LinkedIn, TikTok" }
roles:
  - { template: marketing-strategist, min: 1, default: 1, max: 1, lead: true, why: "Leads the squad: collects the marketing brief, brand rules and channel plan from you, plans campaigns and reports the KPIs." }
  - { template: seo-specialist, min: 0, default: 1, max: 1, why: "Makes the site findable: technical SEO, keywords and content optimisation, measured against a baseline." }
  - { template: content-writer, min: 0, default: 1, max: 2, why: "Writes articles, landing pages and emails in your brand voice, with every claim sourced." }
  - { template: social-media-specialist, min: 0, default: 1, max: 2, why: "Turns the content calendar into posts per platform and tracks engagement." }
  - { template: ads-analytics-specialist, min: 0, default: 1, max: 1, why: "Sets up tracking and paid campaigns and reports honest numbers per KPI." }
  - { template: web-developer, min: 0, default: 1, max: 1, why: "Puts the pages you approved on the site: commits them on a branch of the site's repository, or prepares ready-to-paste drafts for WordPress or another CMS. You approve the merge (in the app or on Telegram) or publish." }
  - { template: ui-ux-designer, min: 0, default: 0, max: 1, why: "Optional: visuals, landing page layouts and campaign creatives within your brand rules." }
sourceDocs:
  - { path: docs/MARKETING-BRIEF.md, title: Marketing Brief, purpose: "Goals, audience, offer, KPIs", owner: marketing-strategist, readers: all }
  - { path: docs/BRAND.md, title: Brand, purpose: "Voice, visual rules, words to use and to avoid", owner: marketing-strategist, readers: all }
  - { path: docs/CHANNELS.md, title: Channels, purpose: "Channel plan and content calendar", owner: marketing-strategist, readers: all }
kpis:
  - { id: organic-traffic, name: Organic traffic, unit: sessions, direction: up, period: month, source: { kind: manual }, requires: "mcp:analytics", note: "GA4 organic sessions; a CSV or GA4 integration can feed it" }
  - { id: leads, name: Leads from the site, unit: leads, direction: up, period: month, source: { kind: manual } }
  - { id: posts, name: Posts published, unit: posts, direction: up, period: week, source: { kind: manual }, requires: "mcp:social-scheduler", mcp: { tool: "post", args: { from: "{{from}}", to: "{{to}}", status: published }, pick: { type: count, path: posts } } }
  - { id: engagement, name: Engagement rate, unit: "%", direction: up, period: week, source: { kind: manual } }
cadence:
  - { id: daily-content-draft, title: Daily content draft, agent: content-writer, every: daily, at: "22:30", budget: 1, task: "Draft the next piece of the content calendar in docs/CHANNELS.md as a DRAFT in content/drafts/ (or content/social/<channel>/), in the brand voice of docs/BRAND.md. Update its row in docs/BOARD.md. Publish nothing." }
  - { id: weekly-report, title: Weekly report vs targets, agent: marketing-strategist, every: "weekly:mon", at: "23:00", budget: 2, task: "Write the weekly marketing report in docs/reports/<date>-weekly.md: each target from docs/squad/KPI.md with its value and status, what was published, what worked, and the plan for this week against the targets that are behind. Use only the numbers in KPI.md." }
  - { id: approved-to-site, title: Approved pages to the site, agent: web-developer, every: daily, at: "01:00", budget: 1, task: "Take the pieces on docs/BOARD.md that the owner APPROVED and that are not on the site yet, at most two, and put them on the site with the site-content-update skill, as docs/SITE.md says: a commit on your branch of the site's repository, or a ready-to-paste draft in content/ready/. Write the handoff, set each to REVIEW and tell the lead. Never push or publish." }
  - { id: approved-posts, title: Approved posts to the Outbox, agent: social-media-specialist, every: daily, at: "23:30", budget: 0.5, task: "Take the posts on docs/BOARD.md that the owner APPROVED and that are not requested yet, and request each in the Outbox with the publish-request skill, with its channel and time from the content calendar. Set them to PUBLISHED only when the answer says sent. Publish nothing yourself." }
  - { id: weekly-numbers, title: Weekly campaign numbers, agent: ads-analytics-specialist, every: "weekly:fri", at: "23:00", budget: 1, task: "Write docs/reports/<date>-numbers.md with the campaign-report skill: each live campaign and published piece against its KPI, with sources and date ranges. Use only real numbers; mark a missing source as unknown." }
flows:
  A content piece:
    - { by: lead, does: "Plans it in the content calendar with its channel and KPI", status: TODO }
    - { by: content-writer, does: "Drafts it in the brand voice", status: DRAFT }
    - { by: seo-specialist, does: "Adds the keywords, title and meta for search", optional: true }
    - { by: lead, does: "Checks brand, voice and facts", status: REVIEW }
    - { by: owner, does: "Approves it", status: APPROVED }
    - { by: social-media-specialist, does: "Requests the posts in the Outbox; the server sends them on schedule", status: PUBLISHED }
    - { by: ads-analytics-specialist, does: "Measures it against its KPI in the weekly numbers" }
  A web page:
    - { by: content-writer, does: "Drafts the page copy", status: DRAFT }
    - { by: lead, does: "Checks brand, voice and facts", status: REVIEW }
    - { by: owner, does: "Approves it", status: APPROVED }
    - { by: web-developer, does: "Puts it on the site: a commit on a branch, or a ready-to-paste CMS draft", status: REVIEW }
    - { by: seo-specialist, does: "Checks titles, meta and links on the change" }
    - { by: owner, does: "Approves the merge (in the app or on Telegram), or pastes and publishes", status: PUBLISHED }
  A campaign:
    - { by: lead, does: "Writes the campaign brief, the budget and the KPI" }
    - { by: ui-ux-designer, does: "Designs the visuals", optional: true }
    - { by: ads-analytics-specialist, does: "Sets up tracking and drafts the ads" }
    - { by: owner, does: "Approves the budget and the ads" }
    - { by: ads-analytics-specialist, does: "Requests the ads in the Outbox and reports the results weekly" }
gates: [source documents approved, brand and voice review, fact check, owner approval before publishing, KPI report]
kickoff: "Start as the lead of this squad. Read AISQUAD.md (the squad standard) first. Then ask me for the marketing brief, the brand rules and the channel plan. For anything missing, interview me and draft it in docs/ for my approval. No campaign work starts until all three are approved."
---
## Purpose
A marketing team that turns an approved brief, brand rules and channel plan into content, social posts, SEO and campaigns, and reports results against the KPIs.

## Shift
The squad works at night (22:00-05:00, every day): automated work waits for the shift, so it does not take the machine's slots from the day's work, and its results reach the owner in the morning digest. Change it in Admin → Spaces.

## Source documents
The documents below are the main reference for every agent. Each starts with a `STATUS:` line (`DRAFT` or `APPROVED`).

| Document | Purpose | Owner | Read by |
|---|---|---|---|
| `docs/MARKETING-BRIEF.md` | Goals, audience, offer, KPIs | Marketing Strategist | everyone |
| `docs/BRAND.md` | Voice, visual rules, words to use and to avoid | Marketing Strategist | everyone |
| `docs/CHANNELS.md` | Channel plan and content calendar | Marketing Strategist | everyone |

## Channels
- **Owner ↔ squad:** only the lead ({{lead}}) talks to the owner. Everyone else writes questions to `docs/QUESTIONS.md` and tells the lead.
- **Lead ↔ teammates:** the lead spawns teammates with their agent ids as names; teammates reach the lead with SendMessage to `main`.
- **Handoff files:** finished pieces are handed over in `docs/handoffs/<date>-<piece>.md`; drafts live in `content/drafts/` (articles, pages, emails) and `content/social/<channel>/` (posts). Ready-to-paste CMS drafts go in `content/ready/<slug>/`; how the site is managed is in `docs/SITE.md`.
- **Posts go out through the Outbox:** after the owner approves, the social media specialist requests them (publish-request) and the server sends them on schedule.
- **Board:** `docs/BOARD.md` lists every piece: owner, channel, KPI, due date, status (TODO / DRAFT / REVIEW / APPROVED / PUBLISHED).

## Work items
A **piece** is one deliverable (an article, a landing page, a batch of posts, a campaign setup). Each piece names its channel, its audience, its KPI, its source documents and its due date in the content calendar.

## Handoff
Every handoff names the piece, the channel, the target keyword or audience, the KPI, the claims with their sources, and the brand/voice check result. Nothing is published or scheduled by an agent.

## Gates
1. **Source documents approved:** no campaign work starts before the brief, brand and channel plan are approved.
2. **Brand and voice review:** the lead checks every piece against `docs/BRAND.md`.
3. **Fact check:** every claim has a source in the brief or a cited public source; nothing is invented.
4. **Owner approval:** publishing, posting and ad spend need the owner's approval.
5. **KPI report:** after each period the lead reports the KPIs with their data sources.

## Definition of done
A piece is done when it passed the brand/voice review and the fact check, the owner approved it, and its KPI is being measured. A campaign is done when its KPI report is written.

## Rules per role

### marketing-strategist
- Before any campaign work, ask the owner for the marketing brief, the brand rules and the channel plan; draft missing ones from an interview and get them approved.
- Every task you give names its KPI, channel and source document.

### seo-specialist
- Work from the brief's audience and offer; record a baseline before every change and report against it.

### content-writer, social-media-specialist
- Follow `docs/BRAND.md` exactly; every claim needs a source; never invent quotes, numbers or testimonials.

### ads-analytics-specialist
- Every KPI gets a measurement plan; no spend without the owner's approval; report numbers with source and date range.

### ui-ux-designer
- Visuals follow the visual rules in `docs/BRAND.md`; propose new styles to the lead instead of inventing them.

### web-developer
- Only APPROVED pages, the wording unchanged; code on your own branch from the base branch in `docs/SITE.md`, CMS as ready-to-paste drafts in `content/ready/`. Never push, merge or publish.
