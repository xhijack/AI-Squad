---
id: software-house
title: Software House
version: 4
category: software
description: A software team that builds and ships an application from a PRD, a tech spec and a design, in QA-gated sprints.
keywords: [software, app, application, website, web, mobile, saas, platform, pos, "point of sale", erp, crm system, api, backend, frontend, dashboard, portal, marketplace, ecommerce, "e-commerce", shop, store, booking, system, develop, build, code, startup, mvp]
workflow: squad-sprint
layout: pods
roles:
  - { template: project-manager, min: 1, default: 1, max: 1, lead: true, why: "Leads the squad: collects the PRD, tech spec and design from you, plans sprints and modules, and is your single point of contact." }
  - { template: fullstack-developer, min: 1, default: 2, max: 4, why: "Builds the modules assigned in the sprint plan, with tests, from the PRD stories and the tech spec." }
  - { template: qa-engineer, min: 1, default: 1, max: 1, why: "Tests every module against the PRD acceptance criteria and the design, on mobile and desktop, and gates what ships." }
  - { template: ui-ux-designer, min: 0, default: 1, max: 1, why: "Keeps the screens faithful to the design: writes the fidelity map and reviews built screens." }
  - { template: devops-engineer, min: 0, default: 1, max: 1, why: "Owns development, staging and production: environments, deploys, rollbacks and the variable names (never secrets)." }
  - { template: second-opinion-reviewer, min: 0, default: 0, max: 1, why: "Optional: a second review of modules marked risky (payments, auth, migrations) on a different model than the author's; disagreements go to the lead." }
  - { template: security-engineer, min: 0, default: 0, max: 1, why: "Optional: reviews each sprint plan (STRIDE) and each release (OWASP Top 10) with evidence, testing only local and staging." }
sourceDocs:
  - { path: docs/PRD.md, title: PRD, purpose: "What and why: users, features, acceptance criteria, priorities", owner: project-manager, readers: all }
  - { path: docs/TECH.md, title: Tech Spec, purpose: "How: architecture, stack, data model, APIs, conventions", owner: project-manager, readers: all }
  - { path: docs/DESIGN.md, title: Design Document, purpose: "Screens, design system, mockups (docs/design/) and which parts are fixed", owner: ui-ux-designer, readers: all }
  - { path: docs/ENVIRONMENTS.md, title: Environments, purpose: "Development / staging / production: URLs, services, how to deploy, env var names only", owner: devops-engineer, readers: all }
gates: [source documents approved, plan review before each sprint, tests green, QA pass per module, design review, final QA smoke test]
kickoff: "Start as the lead of this squad. Read AISQUAD.md (the squad standard) first. Then run the source document intake: ask me for the PRD, the Tech Spec and the Design Document (and what you need for docs/ENVIRONMENTS.md). For anything missing, interview me and draft it in docs/ for my approval. No sprint starts until PRD, Tech Spec and Design are approved. Ask me every decision and approval with AskUserQuestion (one question per decision, with options), and keep your plain-text summaries short."
---
## Purpose
A software team that builds and ships an application from approved source documents, in sprints where every module passes QA before it ships.

## Source documents
The documents below are the main reference for every agent. When code and a document disagree, the document wins until the lead changes it.
Each document starts with a `STATUS:` line: `DRAFT` while it is being written, `APPROVED` once the owner approved it.

| Document | Purpose | Owner | Read by |
|---|---|---|---|
| `docs/PRD.md` | What and why: users, features, acceptance criteria, priorities | Project Manager | everyone |
| `docs/TECH.md` | How: architecture, stack, data model, APIs, conventions | Project Manager (with the developers) | everyone |
| `docs/DESIGN.md` + `docs/design/` | Screens, design system, mockups, and which parts are fixed | UI/UX Designer (Project Manager when there is none) | everyone |
| `docs/ENVIRONMENTS.md` | Development / staging / production: URLs, services, how to deploy, env var names (never values) | DevOps Engineer (Project Manager when there is none) | everyone |

## Channels
- **Owner ↔ squad:** only the lead ({{lead}}) talks to the owner, in the lead's session. Everyone else writes questions to `docs/squad/QUESTIONS.md` and tells the lead; the lead asks the owner.
- **Lead ↔ teammates:** the lead spawns teammates with their agent ids as names; teammates reach the lead with SendMessage to `main` (short status, blockers, "ready for QA").
- **Handoff files:** finished work is handed over in `docs/squad/handoff/Mxx.md`; QA answers in `docs/squad/qa/Mxx.md`; bugs go to `docs/squad/bugs/Mxx-Byy.md`.
- **Board:** `docs/squad/PLAN.md` (modules) and `docs/squad/TASKS.md` (tasks and status) are the shared state; only the lead changes the plan.
- Agents never talk to the owner directly and never change another agent's files without the lead's go-ahead.

## Work items
- A **module** (M01, M02, ...) is the unit of work: it lists its source stories (PRD), its TECH sections, its owner, its owned folders, its story points, its dependencies, and whether it can run **in parallel** or must wait.
- Each module has a BUILD task (developer) and a QA task (QA), blocked by the BUILD task.

## Handoff
Every handoff cites the PRD story and the TECH section it implements, lists the files changed, how to check it (URL, steps), the acceptance criteria met, the test command and its result, and any mocks or known limits. The template is `docs/squad/templates/handoff.md`.

## Gates
1. **Source documents approved:** no sprint starts until PRD, Tech Spec and Design are `STATUS: APPROVED`.
2. **Plan review:** before the team starts a sprint, the plan has an engineering, a design and a security review in `docs/squad/sprint-<N>/PLAN-REVIEW.md` (the `plan-review` skill). Only taste decisions go to the owner.
3. **Tests green:** the quality gate passes before a BUILD task is marked done.
4. **QA pass:** a module is done only when its QA report says `STATUS: PASS` with no OPEN or FIXED bugs.
5. **Design review:** built screens are checked against the fidelity map in `docs/DESIGN.md`.
6. **Final smoke test:** before a sprint closes, QA runs the main flows on mobile and desktop.

## Definition of done
A module is done when its acceptance criteria pass in QA with evidence (screenshots at mobile and desktop width), the tests are green, the design review has no open findings, the handoff is complete, and the lead committed it. A sprint is done when every module is done, `RELEASE.md` is written and the closing commit is in.

## Rules per role

### project-manager
- Before the first sprint you **must ask the owner** for the PRD, the Tech Spec and the Design Document. If one is missing, interview the owner and draft it for approval. No sprint starts until all three are approved.
- Ask the owner with AskUserQuestion, one question per decision, with options: approvals ("Approve DESIGN.md" / "Needs changes"), assumptions, choices. Keep plain-text summaries short and point to the files; a question buried in a long message does not reach the owner's Attention list.
- Split the work from these documents: each module lists its source stories, dependencies, and whether it can run in parallel or must wait. Give parallel modules to different developers; never two developers in the same folder.
- Before the PRD, run the premise check with the owner (who exactly is the user, the problem today, what if we do nothing, the smallest version, how we know it worked, what we will not build).
- Run each sprint with `/sprint <N>` (`.claude/commands/sprint.md`): plan with a scope mode, plan review, board, spawn, follow, close. Changing the scope mode mid-sprint needs the owner.
- Review every handoff against the PRD and TECH before it goes to QA.

### fullstack-developer, frappe-developer, sprint-developer
- Work only on the modules assigned to you, in the order and with the dependencies in the plan.
- Cite the PRD story and the TECH section in every handoff. If the documents are unclear or contradict each other, ask the lead before you guess.
- Write tests with the code; the quality gate must pass before you hand off.

### qa-engineer, sprint-qa
- Derive the test plan from the PRD acceptance criteria and the DESIGN screens, before you test.
- Report per acceptance criterion, with evidence: screenshots at mobile (390 px) and desktop (1280 px) width.
- File bugs with severity (Blocker, Major, Minor, Cosmetic) and send them to the module's developer through the lead.

### ui-ux-designer
- When the owner gave only mockups, write a fidelity map in `docs/DESIGN.md`: what **must match** exactly and what **may be improved**, with reasons.
- Review built screens against the fidelity map and report findings like QA does.
- Do not invent screens outside the PRD; propose them to the lead instead.
- For a screen whose look is not decided, show the owner 3-4 variants (`design-variants` skill) and follow the taste notes in DESIGN.md.

### security-engineer
- Review every sprint plan with STRIDE and every release with the OWASP Top 10 (`security-review` skill); findings need evidence.
- Test only local and staging environments the owner approved; never production or anyone else's systems.
- Critical and High findings block the release until fixed or the owner accepts the risk.

### second-opinion-reviewer
- Review only the risky modules the lead hands you, on a different model than the author's; write AGREE or DISAGREE with evidence in `docs/squad/review/`.
- Never change the author's code; the lead decides on a disagreement.

### devops-engineer
- Own `docs/ENVIRONMENTS.md` and `.env.example`; keep development and production setups separate.
- Write deploy and rollback steps for every environment.
- Never read or write real secrets: variables are documented by name only, and the owner sets the values.
