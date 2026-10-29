---
id: support
title: Support
version: 1
category: support
description: A support team that triages tickets against SLAs, drafts replies from a knowledge base it keeps, escalates bugs and product gaps to the product and engineering Spaces, and reports the numbers every week.
keywords: [support, customer support, customer service, layanan pelanggan, helpdesk, help desk, tickets, tiket, sla, csat, faq, knowledge base, kb, complaints, keluhan, issue, hd ticket, zendesk, freshdesk, intercom, crisp, chat support, onboarding]
workflow: free-team
layout: rows
space: { kind: department }
roles:
  - { template: support-lead, min: 1, default: 1, max: 1, lead: true, why: "Leads the squad: triages tickets against the SLAs, reviews replies and KB articles, escalates to product and engineering, and reports the week." }
  - { template: support-agent, min: 0, default: 1, max: 3, why: "Drafts replies from the knowledge base and turns resolved tickets into articles, without customers' personal data." }
sourceDocs:
  - { path: docs/SUPPORT-POLICY.md, title: Support policy, purpose: "Channels, hours, SLAs per priority, tone, what only the owner decides, where to escalate", owner: support-lead, readers: all }
kpis:
  - { id: first-response, name: First response time, unit: hours, direction: down, period: week, source: { kind: manual }, requires: "mcp:helpdesk", note: "median hours to the first reply; a help desk integration can measure it" }
  - { id: open-tickets, name: Open tickets, unit: tickets, direction: down, period: total, every: hour, source: { kind: erpnext, doctype: Issue, filters: [["status", "in", ["Open", "Replied", "On Hold"]]], aggregate: count }, note: "ERPNext Issues; for a help desk, switch the source to its integration" }
  - { id: resolved, name: Tickets resolved, unit: tickets, direction: up, period: week, source: { kind: erpnext, doctype: Issue, filters: [["status", "in", ["Resolved", "Closed"]]], aggregate: count, dateField: modified } }
  - { id: csat, name: Customer satisfaction, unit: "%", direction: up, period: month, source: { kind: manual }, requires: "mcp:helpdesk", note: "share of good ratings; entered by hand or from the help desk" }
cadence:
  - { id: morning-triage, title: Morning triage, agent: support-lead, every: weekdays, at: "08:00", budget: 1, task: "Triage the tickets in docs/support/triage/<date>.md: new and open tickets by priority and SLA from docs/SUPPORT-POLICY.md, who answers each, which wait for the customer, which need the owner. Ticket ids only, no customers' personal data. Send nothing." }
  - { id: weekly-report, title: Weekly support report, agent: support-lead, every: "weekly:fri", at: "16:00", budget: 2, task: "Write the weekly support report in docs/support/reports/<date>.md: each target from docs/squad/KPI.md with its value, the top 5 topics, escalations to product and engineering with their status, and the KB articles added. Use only the numbers in KPI.md." }
  - { id: kb-gaps, title: Weekly KB gaps, agent: support-agent, every: "weekly:wed", at: "10:00", budget: 1, task: "List in docs/support/kb-gaps-<date>.md the questions of the last week that had no APPROVED article in docs/kb/, and draft the two most frequent as articles with the kb-writer skill (STATUS: DRAFT, no personal data)." }
gates: [source documents approved, owner approval before refunds, credits or promises, KB articles free of personal data]
ownerOnly: [refunds, credits, discounts, deleting customer accounts, promised dates]
kickoff: "Start as the lead of this squad. Read AISQUAD.md first. Then ask me for the support policy (channels, hours, SLAs per priority, tone, what only I decide, where to escalate) and where the tickets live (ERPNext Issues or a help desk). Draft docs/SUPPORT-POLICY.md from my answers for my approval. No ticket is answered before it is approved."
---
## Purpose
A support team: tickets triaged against the SLAs, replies drafted from the knowledge base in `docs/kb/`, bugs and product gaps escalated to the Spaces that own them, and a weekly report against the targets.

## Source documents
| Document | Purpose | Owner | Read by |
|---|---|---|---|
| `docs/SUPPORT-POLICY.md` | Channels, hours, SLAs, tone, owner decisions, escalation | Support Lead | everyone |

## Channels
- **Owner ↔ squad:** only the lead ({{lead}}) talks to the owner.
- **Tickets** live in the help desk (an MCP integration) or in ERPNext (Issue, or HD Ticket with the Helpdesk app); the repository holds ticket ids only.
- **Drafts:** `docs/support/drafts/<ticket-id>.md`; **triage:** `docs/support/triage/<date>.md`; **reports:** `docs/support/reports/<date>.md`.
- **Escalations** leave as handoff packages (`docs/squad/handoffs/outbox/`): a reproducible bug to the engineering Space, a feature gap or a recurring confusion to the product Space.

## Knowledge base
`docs/kb/*.md`, one article per question, written with the `kb-writer` skill. An article starts as DRAFT; the lead approves it. Customers' names, phone numbers, e-mail addresses and ticket numbers never go into an article.

## Replies
- **Supervised:** every reply is a draft; the lead or the owner sends it.
- **Automatic:** an agent may answer by itself only with an APPROVED KB article, cited in the reply; everything else waits for approval.

## Gates
1. **Source documents approved:** no ticket is answered before `docs/SUPPORT-POLICY.md` is approved.
2. **Owner approval:** refunds, credits, discounts, deleted accounts and promised dates.
3. **KB articles free of personal data.**

## Rules per role

### support-lead
- An escalation names the KB article or the ticket id, the steps to reproduce and the impact; never a customer's data.

### support-agent
- Cite the KB article in every reply; no article, no automatic answer.
