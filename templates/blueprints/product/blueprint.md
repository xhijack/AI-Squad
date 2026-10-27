---
id: product
title: Product
version: 1
category: general
description: A product team that turns research, user feedback and the company's goals into a product vision, a roadmap and PRDs the engineering squad builds from.
keywords: [product, "product management", prd, roadmap, discovery, research, "user research", feedback, feature, features, "product vision", backlog, prioritise, prioritize, "product market fit", mvp]
workflow: free-team
layout: open-space
space: { kind: department }
roles:
  - { template: project-manager, min: 1, default: 1, max: 1, lead: true, why: "Leads the squad as the product lead: keeps the vision and the roadmap, writes PRDs from research and feedback, and hands them to engineering." }
  - { template: lead-researcher, min: 0, default: 1, max: 1, why: "Researches the market, competitors and users; every finding has a source and a date." }
  - { template: ui-ux-designer, min: 0, default: 1, max: 1, why: "Turns a PRD into flows and screens before engineering starts, within the brand rules." }
sourceDocs:
  - { path: docs/PRODUCT-VISION.md, title: Product Vision, purpose: "Who it is for, the problem, what we build and what we do not", owner: project-manager, readers: all }
  - { path: docs/ROADMAP.md, title: Roadmap, purpose: "What comes next and why, by quarter", owner: project-manager, readers: all }
  - { path: docs/RESEARCH.md, title: Research log, purpose: "Findings about users, market and competitors, each with its source", owner: lead-researcher, readers: all }
kpis:
  - { id: activation, name: Activation (new users who finish the first key action), unit: "%", direction: up, period: month, source: { kind: manual } }
  - { id: cycle-time, name: Idea to shipped feature, unit: days, direction: down, period: month, source: { kind: manual } }
  - { id: feedback-handled, name: Feedback items answered, unit: items, direction: up, period: week, source: { kind: manual } }
gates: [product vision approved, research cited, PRD approved before engineering, owner decides the priority]
kickoff: "Start as the lead of this squad. Read AISQUAD.md (the squad standard) and the company plan in the Company Brain first. Then ask me for the product vision and the current roadmap; for anything missing, interview me and draft it in docs/ for my approval. Every PRD goes to the engineering Space as a handoff package only after I approved it."
---
## Purpose
A product team that keeps one approved vision and roadmap, researches before it decides, writes PRDs engineering can build from, and measures whether what shipped was used.

## Source documents
The documents below are the main reference for every agent. Each starts with a `STATUS:` line (`DRAFT` or `APPROVED`).

| Document | Purpose | Owner | Read by |
|---|---|---|---|
| `docs/PRODUCT-VISION.md` | Who it is for, the problem, what we build and what we do not | Product lead | everyone |
| `docs/ROADMAP.md` | What comes next and why, by quarter | Product lead | everyone |
| `docs/RESEARCH.md` | Findings about users, market and competitors, each with its source | Lead Researcher | everyone |

## Channels
- **Owner ↔ squad:** only the lead ({{lead}}) talks to the owner. Everyone else writes questions to `docs/QUESTIONS.md` and tells the lead.
- **Lead ↔ teammates:** the lead spawns teammates with their agent ids as names; teammates reach the lead with SendMessage to `main`.
- **To engineering:** an approved PRD leaves as a handoff package (`docs/squad/handoffs/outbox/`, kind `prd`) to the engineering Space; questions from engineering come back the same way.
- **Board:** `docs/BOARD.md` lists every PRD and research item: owner, status (IDEA / RESEARCH / DRAFT / REVIEW / APPROVED / HANDED OVER / SHIPPED / MEASURED).

## Work items
A **PRD** is one feature or change: the problem, who has it, the evidence (research or feedback with sources), the smallest version, acceptance criteria, what is out of scope, and how we will know it worked.

## Handoff
A PRD handoff names the roadmap item, cites the research, lists the acceptance criteria and the screens, and says what is fixed and what engineering may decide.

## Gates
1. **Vision approved:** no PRD is written before `docs/PRODUCT-VISION.md` is approved.
2. **Research cited:** every claim about users or the market has a source and a date in `docs/RESEARCH.md`.
3. **PRD approved:** a PRD goes to engineering only after the owner approved it.
4. **Priority is the owner's:** the lead proposes the order; the owner decides.

## Definition of done
A PRD is done when engineering shipped it and its result was measured against the number the PRD promised.

## Rules per role

### project-manager
- You are the product lead: before anything else, ask the owner for the product vision and the roadmap; draft missing ones from an interview and get them approved.
- Write PRDs from evidence, not from taste: cite the research or the feedback item. Propose priorities with reasons; the owner decides.
- Hand an approved PRD to engineering as a handoff package; answer their questions within the same package thread.

### lead-researcher
- Every finding goes to `docs/RESEARCH.md` with its source and date; separate what you read from what you conclude.

### ui-ux-designer
- Design from the approved PRD and the brand rules in the Company Brain; hand flows and screens over with the PRD.
