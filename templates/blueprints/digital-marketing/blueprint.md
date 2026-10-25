---
id: digital-marketing
title: Digital Marketing
version: 1
category: marketing
description: A marketing team that turns a brief, brand rules and a channel plan into content, social posts, SEO and campaigns, and reports results against KPIs.
keywords: [marketing, digital marketing, seo, content, blog, social, "social media", instagram, tiktok, linkedin, facebook, ads, advertising, campaign, brand, branding, awareness, traffic, newsletter, email marketing, influencer, launch, growth, audience, followers, copywriting]
workflow: free-team
layout: open-space
roles:
  - { template: marketing-strategist, min: 1, default: 1, max: 1, lead: true, why: "Leads the squad: collects the marketing brief, brand rules and channel plan from you, plans campaigns and reports the KPIs." }
  - { template: seo-specialist, min: 0, default: 1, max: 1, why: "Makes the site findable: technical SEO, keywords and content optimisation, measured against a baseline." }
  - { template: content-writer, min: 0, default: 1, max: 2, why: "Writes articles, landing pages and emails in your brand voice, with every claim sourced." }
  - { template: social-media-specialist, min: 0, default: 1, max: 2, why: "Turns the content calendar into posts per platform and tracks engagement." }
  - { template: ads-analytics-specialist, min: 0, default: 1, max: 1, why: "Sets up tracking and paid campaigns and reports honest numbers per KPI." }
  - { template: ui-ux-designer, min: 0, default: 0, max: 1, why: "Optional: visuals, landing page layouts and campaign creatives within your brand rules." }
sourceDocs:
  - { path: docs/MARKETING-BRIEF.md, title: Marketing Brief, purpose: "Goals, audience, offer, KPIs", owner: marketing-strategist, readers: all }
  - { path: docs/BRAND.md, title: Brand, purpose: "Voice, visual rules, words to use and to avoid", owner: marketing-strategist, readers: all }
  - { path: docs/CHANNELS.md, title: Channels, purpose: "Channel plan and content calendar", owner: marketing-strategist, readers: all }
gates: [source documents approved, brand and voice review, fact check, owner approval before publishing, KPI report]
kickoff: "Start as the lead of this squad. Read AISQUAD.md (the squad standard) first. Then ask me for the marketing brief, the brand rules and the channel plan. For anything missing, interview me and draft it in docs/ for my approval. No campaign work starts until all three are approved."
---
## Purpose
A marketing team that turns an approved brief, brand rules and channel plan into content, social posts, SEO and campaigns, and reports results against the KPIs.

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
- **Handoff files:** finished pieces are handed over in `docs/handoffs/<date>-<piece>.md`; drafts live in `content/drafts/` (articles, pages, emails) and `content/social/<channel>/` (posts).
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
