---
id: sales-crm
title: Sales & CRM
version: 3
category: sales
description: A sales team that researches and qualifies leads, keeps the CRM clean, writes outreach for approval and reports the pipeline.
keywords: [sales, crm, leads, lead generation, prospecting, prospects, outreach, outbound, cold email, pipeline, deals, b2b, customers, clients, follow up, follow-up, hubspot, salesforce, pipedrive, quotation, proposal, revenue, sdr, account]
workflow: free-team
layout: rows
roles:
  - { template: sales-manager, min: 1, default: 1, max: 1, lead: true, why: "Leads the squad: collects the ideal customer profile, the offer and the pipeline from you, and approves outreach with you." }
  - { template: lead-researcher, min: 0, default: 1, max: 2, why: "Finds and qualifies prospects that match your ideal customer profile, with sources." }
  - { template: crm-administrator, min: 0, default: 1, max: 1, why: "Keeps the CRM clean: fields, stages, deduplication and the data hygiene check." }
  - { template: sales-copywriter, min: 0, default: 1, max: 1, why: "Writes outreach sequences and proposals from your offer; nothing is sent without your approval." }
  - { template: sales-analyst, min: 0, default: 1, max: 1, why: "Measures the pipeline: conversion, velocity, win and loss reasons, and the forecast." }
sourceDocs:
  - { path: docs/ICP.md, title: Ideal Customer Profile, purpose: "Who we sell to: segments, pains, buying signals, disqualifiers", owner: sales-manager, readers: all }
  - { path: docs/OFFER.md, title: Offer, purpose: "Products, pricing rules, objections and answers", owner: sales-manager, readers: all }
  - { path: docs/PIPELINE.md, title: Pipeline, purpose: "Stages, exit criteria, CRM fields", owner: crm-administrator, readers: all }
kpis:
  - { id: new-leads, name: New leads, unit: leads, direction: up, period: month, source: { kind: erpnext, doctype: Lead, aggregate: count }, note: "counted in ERPNext when it is connected" }
  - { id: response-time, name: First response time, unit: hours, direction: down, period: week, source: { kind: manual } }
  - { id: won, name: Quotations ordered, unit: orders, direction: up, period: month, source: { kind: erpnext, doctype: Quotation, filters: [["status", "=", "Ordered"]], aggregate: count, dateField: modified } }
cadence:
  - { id: follow-up-list, title: Follow-up list from ERPNext, agent: sales-manager, every: weekdays, at: "08:00", budget: 1, task: "Make today's follow-up list in docs/sales/followups/<date>.md from ERPNext: open Leads and Opportunities with no contact for 3 days or more, Quotations waiting for an answer, each with the next step and who does it. Read only; send nothing." }
gates: [source documents approved, data hygiene check, owner approval before any outbound message]
kickoff: "Start as the lead of this squad. Read AISQUAD.md (the squad standard) first. Then ask me for the ideal customer profile, the offer and the pipeline. For anything missing, interview me and draft it in docs/ for my approval. No prospecting starts until all three are approved."
---
## Purpose
A sales team that researches and qualifies leads, keeps the CRM clean, writes outreach for the owner's approval and reports the pipeline.

## Source documents
The documents below are the main reference for every agent. Each starts with a `STATUS:` line (`DRAFT` or `APPROVED`).

| Document | Purpose | Owner | Read by |
|---|---|---|---|
| `docs/ICP.md` | Who we sell to: segments, pains, buying signals, disqualifiers | Sales Manager | everyone |
| `docs/OFFER.md` | Products, pricing rules, objections and answers | Sales Manager | everyone |
| `docs/PIPELINE.md` | Stages, exit criteria, CRM fields | CRM Administrator (Sales Manager when there is none) | everyone |

## Channels
- **Owner ↔ squad:** only the lead ({{lead}}) talks to the owner. Everyone else writes questions to `docs/QUESTIONS.md` and tells the lead.
- **Lead ↔ teammates:** the lead spawns teammates with their agent ids as names; teammates reach the lead with SendMessage to `main`.
- **Handoff files:** work is handed over in `docs/handoffs/<date>-<item>.md`; outreach drafts live in `sales/drafts/`.
- **Board:** `docs/BOARD.md` lists every item: owner, segment, due date, status (TODO / IN_PROGRESS / REVIEW / APPROVED / DONE).
- **Leads are referred to by CRM id**, never by name or contact data, in messages, handoffs, logs and commits.

## Work items
An **item** is a lead research batch (segment and count), a CRM task (import, clean-up, field change), an outreach sequence, or a pipeline report.

## Handoff
Every handoff names the item, the segment, counts, the CRM ids touched, the data hygiene check result, and what needs the owner's approval.

## Gates
1. **Source documents approved:** no prospecting before the ICP, the offer and the pipeline are approved.
2. **Data hygiene check:** before every import and report: duplicates, missing required fields, stale stages, consent.
3. **Outbound approval:** no outbound message (email, DM, call script) is sent before the owner approved it.

## Personal data
Contact data never goes into logs, commits, chat messages, handoffs or reports; it lives only in the CRM (or a CRM import file outside the repository). Reports show aggregates.

## Definition of done
A batch is done when its leads are qualified against the ICP, recorded with sources, and passed the hygiene check. A sequence is done when the owner approved it. A report is done when every number states its source and date range.

## Rules per role

### sales-manager
- Before any prospecting, ask the owner for the ICP, the offer and the pipeline; draft missing ones from an interview and get them approved.
- Collect the owner's approval for every outbound message before it is used.

### lead-researcher
- Public business information only, with a source for every fact; qualify against `docs/ICP.md`; never contact a prospect.

### crm-administrator
- Fields and stages follow `docs/PIPELINE.md`; run the hygiene check on every batch; never delete records without the lead's approval.

### sales-copywriter
- Copy follows `docs/OFFER.md` and `docs/ICP.md`; drafts only; placeholders instead of real contact data.

### sales-analyst
- Aggregates only; every number with its source and date range; forecasts show their method.
