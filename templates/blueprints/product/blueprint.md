---
id: product
title: Product
version: 3
category: general
description: A product team that turns research, user feedback and the company's goals into a product vision, a roadmap and PRDs the engineering squad builds from.
keywords: [product, "product management", prd, roadmap, discovery, research, "user research", feedback, feature, features, "product vision", backlog, prioritise, prioritize, "product market fit", mvp]
workflow: free-team
layout: open-space
space: { kind: department }
intake:
  - { id: stage, kind: choice, required: true, label: "Where is the product now?", options: [{ value: idea, label: An idea, hint: "The squad starts with research and the vision." }, { value: building, label: Being built, hint: "The squad sharpens the roadmap and the next PRDs." }, { value: live, label: Live with users, hint: "The squad works from feedback and numbers." }] }
  - { id: url, kind: url, label: "Product URL (optional):", placeholder: "https://app.sopwer.id" }
roles:
  - { template: product-manager, min: 1, default: 1, max: 1, lead: true, why: "Leads the squad: keeps the vision and the roadmap, writes PRDs from research and feedback, and hands them to engineering." }
  - { template: market-researcher, min: 0, default: 1, max: 2, why: "Researches users, the market and competitors; every finding has a source and a date, and the company's research library stays current." }
  - { template: ui-ux-designer, min: 0, default: 1, max: 1, why: "Turns a PRD into flows and screens before engineering starts, within the brand rules." }
sourceDocs:
  - { path: docs/PRODUCT-VISION.md, title: Product Vision, purpose: "Who it is for, the problem, what we build and what we do not", owner: product-manager, readers: all }
  - { path: docs/ROADMAP.md, title: Roadmap, purpose: "What comes next and why, by quarter", owner: product-manager, readers: all }
  - { path: docs/RESEARCH.md, title: Research log, purpose: "Findings about users, market and competitors, each with its source", owner: market-researcher, readers: all }
kpis:
  - { id: activation, name: Activation (new users who finish the first key action), unit: "%", direction: up, period: month, source: { kind: manual } }
  - { id: cycle-time, name: Idea to shipped feature, unit: days, direction: down, period: month, source: { kind: manual } }
  - { id: feedback-handled, name: Feedback items answered, unit: items, direction: up, period: week, source: { kind: manual } }
cadence:
  - { id: research-digest, title: Weekly research digest, agent: market-researcher, every: "weekly:tue", at: "10:00", budget: 1, task: "Research the open questions on docs/BOARD.md with the market-research skill and add the findings to docs/RESEARCH.md with sources and dates. Tell the lead which PRD each finding supports or contradicts." }
  - { id: roadmap-review, title: Monthly roadmap review, agent: product-manager, every: "monthly:1", at: "10:00", budget: 1.5, task: "Review docs/ROADMAP.md against the research, the shipped PRDs and their measured results. Propose the next month's priorities in docs/ROADMAP.md as a DRAFT section for the owner; change no approved part yourself." }
flows:
  A PRD:
    - { by: market-researcher, does: "Researches the problem and the evidence, with sources", status: RESEARCH }
    - { by: lead, does: "Writes the PRD: problem, evidence, smallest version, acceptance criteria", status: DRAFT }
    - { by: ui-ux-designer, does: "Sketches the screens", status: REVIEW, optional: true }
    - { by: owner, does: "Approves the PRD and its priority", status: APPROVED }
    - { by: lead, does: "Hands it to the engineering Space as a package", status: HANDED OVER }
    - { by: lead, does: "Measures the result after engineering shipped it", status: MEASURED }
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
| `docs/RESEARCH.md` | Findings about users, market and competitors, each with its source | Market Researcher | everyone |

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

### product-manager
- Before anything else, ask the owner for the product vision and the roadmap; draft missing ones from an interview and get them approved.
- Write PRDs with the prd-writing skill, from evidence, not from taste: cite the research or the feedback item. Propose priorities with reasons; the owner decides.
- Hand an approved PRD to engineering as a handoff package; answer their questions within the same package thread.

### market-researcher
- Every finding goes to `docs/RESEARCH.md` with its source and date; separate what you read from what you conclude.
- Start from the Company Brain's `research/`; propose what the whole company should keep there (propose-learning).

### ui-ux-designer
- Design from the approved PRD and the brand rules in the Company Brain; hand flows and screens over with the PRD.
