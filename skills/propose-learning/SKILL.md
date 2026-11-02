---
name: propose-learning
description: "Propose what you learned so the whole company keeps it: a company fact every agent should know, a Company Brain document (SOP, template, brand rule, product), or a reusable skill. The owner approves it. Use after a task taught you something that other agents or later sessions would need, or when the owner says \"learn this\" / \"remember this for everyone\"."
---
# Propose what you learned

You cannot change the Company Brain or other Spaces. You **propose**: one Markdown file in `docs/squad/proposals/`
of this Space. The server picks it up within a minute, puts it on the owner's desk, and after the owner's decision
writes the answer to `docs/squad/proposals/answered/<id>.md` (read it before you propose the same thing again).

## When it is worth proposing
- A **fact** that every agent of the company should know and that is not in the Company Brain yet ("Wedding
  leads answer best after 19:00", "Prices include VAT since November").
- A **document** of the Company Brain that is missing or wrong: a procedure that worked, a template you made twice,
  a brand rule the owner gave you in a chat.
- A **skill**: a way of working you repeated, with steps another agent can follow (a checklist, a triage flow).

Not worth it: facts about one client or project (they stay in this Space: `docs/squad/LEARNINGS.md`), guesses, and
anything with personal data, prices for one customer, passwords or keys.

## The file
```
---
kind: fact                 fact | brain | skill
from: rina-sales           your agent id
title: Wedding leads answer best after 19:00
why: 3 of 4 replies this month came after 19:00 (CRM-LEAD-12, 15, 19)
target: sop/lead-follow-up.md     only for brain: the file in the Company Brain (brand/, sop/, templates/, products/)
skill: lead-follow-up              only for skill: its name in kebab case
---
```
Below the header:
- **fact**: one line per fact (each becomes a pinned line in the Company Brain's `FACTS.md`).
- **brain**: the **whole new text** of the document (read the current one first and keep what is still right).
- **skill**: the **whole SKILL.md**: a header with `name` and `description` (when to use it), then the steps.

Name the file after what it is (`lead-follow-up-skill.md`). One proposal per file. `why` is evidence, not opinion:
what happened, with references. A proposal that cannot be read is moved to `answered/` as `.invalid.md` with the
reason on its first line: fix it and save it again in `docs/squad/proposals/`.
