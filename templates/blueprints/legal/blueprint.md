---
id: legal
title: Legal
version: 2
category: legal
description: An Owner-only legal desk that drafts bilingual contracts (Indonesian and English) from locked templates, checks each against Pasal 1320 KUHPerdata, UU PDP and electronic signature rules, and leaves every contract a DRAFT until the owner approves it.
keywords: [legal, contract, contracts, agreement, perjanjian, kontrak, nda, kerahasiaan, terms, sow, mou, spk, legal review, compliance, pdp, privacy, signature, tanda tangan]
workflow: free-team
layout: rows
space: { kind: department, access: owner }
roles:
  - { template: legal-counsel, min: 1, default: 1, max: 1, lead: true, why: "Leads the desk: turns your request into a contract draft from the templates, runs the checklist and brings it to you for approval." }
  - { template: contract-drafter, min: 0, default: 1, max: 2, why: "Drafts and revises the bilingual text clause by clause and fills in the checklist." }
sourceDocs:
  - { path: docs/LEGAL-POLICY.md, title: Legal policy, purpose: "Which contracts we sign, who approves, how we sign (wet ink or certified electronic signature), standard positions on liability, payment and IP", owner: legal-counsel, readers: all }
kpis:
  - { id: turnaround, name: Draft turnaround, unit: days, direction: down, period: month, source: { kind: manual } }
  - { id: revisions, name: Revisions per contract, unit: rounds, direction: down, period: month, source: { kind: manual } }
gates: [source documents approved, legal checklist complete, owner approval before any contract leaves the Space]
ownerOnly: [contract terms, liability, penalties, governing law, signing]
kickoff: "Start as the lead of this desk. Read AISQUAD.md first. Then ask me for the legal policy (which contracts we sign, who approves, how we sign, our standard positions). Draft docs/LEGAL-POLICY.md from my answers for my approval. No contract work starts before it is approved."
---
## Purpose
An Owner-only legal desk: contracts are drafted from the locked bilingual templates in the Company Brain (`legal/templates/`), checked, and stay DRAFT until the owner approves them in the app.

## Source documents
| Document | Purpose | Owner | Read by |
|---|---|---|---|
| `docs/LEGAL-POLICY.md` | Which contracts we sign, approvals, signing method, standard positions | Legal Counsel | everyone |

## Channels
- **Owner ↔ desk:** only the lead ({{lead}}) talks to the owner.
- **Contracts:** `contracts/<yyyy-mm>-<party>-<type>.md`, one file per contract, with its `STATUS:` line on top and its `## Legal checklist` at the end.
- **Requests from other Spaces** arrive as handoff packages; the answer goes back as a done package that names the contract file, never its content.

## Contract status
`DRAFT` → `READY FOR REVIEW` (set by the desk) → `APPROVED` (set only by the owner in the app). The server keeps the fingerprint of every approval: a contract marked APPROVED by anyone else, or changed after approval, is put back to DRAFT and shown to the owner.

## Gates
1. **Source documents approved:** no contract work before `docs/LEGAL-POLICY.md` is approved.
2. **Legal checklist complete:** every item of the `contract-checklist` skill answered in the contract.
3. **Owner approval:** nothing leaves the Space, is signed or is sent before the owner approved it.

## Personal data
Parties' ID numbers, home addresses and signatures never go into the repository; placeholders only.

## Rules per role

### legal-counsel
- Copy templates, never edit them; set READY FOR REVIEW when complete and list the deviations for the owner.

### contract-drafter
- Indonesian and English in step clause by clause; the Indonesian text governs.
