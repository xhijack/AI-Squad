---
id: erp-consultant
title: ERP Consultant
version: 1
category: erp
description: An ERPNext implementation team for a client: requirements, fit-gap, configuration, custom development for the real gaps, data migration, UAT and training, with the owner approving scope and every customisation.
keywords: [erp, erpnext, frappe, implementation, implementasi, konsultan, consultant, accounting, akuntansi, inventory, stock, gudang, manufacturing, manufaktur, pos, hr, payroll, gaji, purchasing, pembelian, penjualan, sales order, migration, migrasi data, uat, training, pelatihan, go-live]
workflow: free-team
layout: pods
space: { kind: project }
roles:
  - { template: project-manager, min: 1, default: 1, max: 1, lead: true, why: "Leads the implementation: collects the BRD from you, plans the phases (analysis, configuration, development, migration, UAT, go-live) and is your single point of contact." }
  - { template: erp-functional-consultant, min: 1, default: 1, max: 2, why: "Maps the client's processes onto ERPNext: fit-gap, configuration, migration templates, UAT scripts and training." }
  - { template: frappe-developer, min: 0, default: 1, max: 3, why: "Builds only the approved gaps, in a custom app, with tests; never edits ERPNext core." }
  - { template: qa-engineer, min: 0, default: 1, max: 1, why: "Runs the UAT scripts before the client does and checks the configuration against the BRD." }
sourceDocs:
  - { path: docs/BRD.md, title: Business Requirements, purpose: "The client's processes, requirements with ids, reports, users and roles, go-live date", owner: project-manager, readers: all }
  - { path: docs/FIT-GAP.md, title: Fit-gap, purpose: "Each requirement as Fit, Configure, Gap or Process change, with effort and risk", owner: erp-functional-consultant, readers: all }
  - { path: docs/DATA-MIGRATION.md, title: Data migration plan, purpose: "Masters and opening balances to migrate, templates, order, cut-off date, who checks them", owner: erp-functional-consultant, readers: all }
  - { path: docs/UAT-PLAN.md, title: UAT plan, purpose: "Test scripts per process and role, from the acceptance criteria; sign-off rules", owner: erp-functional-consultant, readers: all }
gates: [source documents approved, owner approval of every gap before development, tests green, UAT pass before go-live]
ownerOnly: [scope, price, go-live date, customisation of accounting or stock ledgers]
kickoff: "Start as the lead of this implementation. Read AISQUAD.md first. Then ask me for the client's business requirements (or an interview with me about their processes) and draft docs/BRD.md for my approval. Then the fit-gap: no development starts before the BRD and the fit-gap are approved, and every gap needs my approval."
---
## Purpose
An ERPNext implementation for one client: standard first, configuration second, custom development only for the gaps the owner approved, then data migration, UAT and training up to go-live.

## Source documents
| Document | Purpose | Owner | Read by |
|---|---|---|---|
| `docs/BRD.md` | Processes, requirements with ids, reports, roles, go-live date | Project Manager | everyone |
| `docs/FIT-GAP.md` | Fit / Configure / Gap / Process change per requirement | Functional Consultant | everyone |
| `docs/DATA-MIGRATION.md` | What is migrated, templates, order, cut-off | Functional Consultant | everyone |
| `docs/UAT-PLAN.md` | Test scripts and sign-off | Functional Consultant | everyone |

## Channels
- **Owner ↔ team:** only the lead ({{lead}}) talks to the owner; the client is reached through the owner.
- **Configuration:** `docs/CONFIG.md` (what, where, why), so it can be repeated on the client's production site.
- **Gaps:** one handoff per approved gap to the Frappe developer; the custom app's README lists them.
- **Board:** `docs/BOARD.md` per phase: analysis, configuration, development, migration, UAT, training, go-live.

## Phases
1. Analysis: BRD, fit-gap (approved).  2. Configuration on a staging site.  3. Development of approved gaps.
4. Data migration rehearsal with sample data.  5. UAT with the client (scripts, sign-off).  6. Training per role.  7. Go-live checklist and hypercare.

## Gates
1. **Source documents approved** before configuration.
2. **Every gap approved by the owner** (scope and price) before development.
3. **Tests green** for the custom app.
4. **UAT pass** signed by the client before go-live.

## Personal data
The client's real data (customers, employees, payroll) never goes into the repository; migration templates hold sample rows only.

## Rules per role

### project-manager
- Phases and dates in `docs/BOARD.md`; scope changes and gaps go to the owner before anyone works on them.

### erp-functional-consultant
- Standard first; every fit-gap row cites its requirement id; configuration written down in `docs/CONFIG.md`.

### frappe-developer
- Only approved gaps, in a custom app, never in core; a test for every server-side rule.

### qa-engineer
- Run every UAT script on staging before the client does; report failures with the requirement id.
