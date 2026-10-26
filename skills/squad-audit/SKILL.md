---
name: squad-audit
description: "Audit how an AI squad worked from a Squad Log digest: judge process correctness and token / AI-usage efficiency, cite evidence, and propose concrete changes to Role Templates, Blueprints or Floor settings. Use when The AI Squad asks for an audit of a sprint, a day or the time since the last audit."
---
# Squad audit

You review one squad's work for The AI Squad. You get a **digest**: metric tables computed in code from the Squad Log, the team, and the most relevant events, each with a reference like `E12`. You never see the raw log or the project files. Judge only what the digest shows.

## What to judge
1. **Process** (was the work done the right way?)
   - Source documents approved before the first sprint (Software House: PRD, TECH, DESIGN, ENVIRONMENTS).
   - Every module has a handoff; QA reported before the merge; QA first-round pass rate; bugs per story point by severity.
   - Modules built in parallel as planned; questions to the owner and how long they waited; refused gates; rework (rows reopened).
2. **Efficiency** (were tokens and money well spent?)
   - Cost and tokens per story point, per module and per agent; cache hit rate; share of cost by model; turns per module.
   - Debug loops (`process.debug`): a problem with three or more failed fix attempts and no escalation, or more than three, is a `high` finding; propose a rule for that role.
   - Waste: the same file read many times by one agent, failed tool calls and retries, very long outputs, idle time while work was open, time blocked on the owner, an expensive model on simple work (for example opus on docs-only modules).
3. **Quality** (did what shipped meet the bar?): QA failures, bug severity, gates that caught problems late.
4. **Autopilot** (when the digest has an Autopilot section): decisions taken without the owner, the share the owner changed later (a high rate means the lead decides too much on its own: propose a lead rule or a lower level), critical items decided without the owner (must be 0: always a `critical` finding), and the waiting it saved. A finding may propose a lead rule (`role-template`), a squad rule (`blueprint`), the `autopilot` setting, or, as advice (`none`), a change to the hard-stop list.

## Rules
- Every finding cites **evidence**: event refs from the digest (`E12`) and/or metric names as they appear in the digest (`metric:efficiency.cacheHitRate`). No evidence, no finding.
- Be concrete and proportionate. A tiny sprint with few events gets few findings. Do not invent numbers. Say "insufficient data" in the summary when the digest is too thin to judge an area.
- Severity: `critical` (broke the process or wasted most of the money), `high` (clear, repeated problem), `medium` (worth fixing), `low` (polish).
- A **recommendation** says what to change, in one or two sentences.
- Give a **target** when a change to a template or setting would fix it, so the owner can apply it with one click:
  - `role-template` with the role id from the team table (`fullstack-developer`). `proposedChange.addRules` are new rule lines for that role (short, imperative, testable). `removeRules` quotes existing rules to drop (rarely). `appendPrompt` is extra prompt text (optional, short). `model` / `effort` only when the evidence shows the model is wrong for the work (`opus`, `sonnet`, `haiku`; `low` to `max`).
  - `blueprint` with the Blueprint id. `addRules` become lines in its standard (for the whole squad).
  - `floor-setting` with the Floor id; `setting` is one of `budget.usd`, `sprint.autoNext`, `audit.model`, `log.messages`, `autopilot` (`off`, `balanced`, `full`), and `value` the new value as text.
  - `none` when the fix is for the owner (a habit, a decision), not a template.
- Prefer one good rule over several vague ones. Never propose rules that weaken security (secrets, permissions, pushing) or remove a gate.
- Write in English. Keep the summary to three sentences: what went well, the biggest problem, the most valuable change.
