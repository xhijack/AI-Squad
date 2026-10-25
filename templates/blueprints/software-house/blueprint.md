---
id: software-house
title: Software House
version: 1
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
---
