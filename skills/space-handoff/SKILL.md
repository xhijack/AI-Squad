---
name: space-handoff
description: "Hand work to another Space (or a draft Quotation to the Owner) as a package the server delivers, and answer packages that arrive in this Space. Use whenever work leaves this Space or arrives from another one."
---
# Space handoff

Work that another Space does goes as a **package**: one Markdown file in `docs/squad/handoffs/outbox/` of this
Space. The server picks it up within a minute (or when your job ends), gives it an id, keeps a copy in
`docs/squad/handoffs/sent/`, delivers it to the other Space's `docs/squad/handoffs/inbox/<id>.md` and starts the
receiving agent. A package that cannot go is renamed `.invalid` with the reason on its first line: fix it and save
it again as `.md`.

## The header
```
---
to: Website Revamp        the Space: its name, number or id ("owner" only for a quotation)
agent: budi-dev           optional: who receives it (default: the Space's lead)
kind: task                task, lead, opportunity, quotation, project
title: Build the webinar landing page
erpnext: Opportunity/CRM-OPP-2026-00012     optional: the ERPNext document it is about (DocType/name)
from: mira-mkt            your agent id
---
```

## The body: what the receiver needs, so it does not have to ask
1. **What** is needed, in two or three lines, and **why** (the customer's or the campaign's goal).
2. **Context:** the files in this repository and the ERPNext ids it builds on. Link, do not paste: the receiver
   reads them from the package's mention. Keep the package under 64 KB.
3. **Done means:** the acceptance criteria, the date if there is one.
4. **Limits:** what not to do, what needs the owner.

Never put contact data (names of people, e-mail, phone) or prices in a package: refer to the ERPNext id. Secrets are
removed by the server anyway.

## Answering a package that arrived
- Missing something essential? Do not guess: write `outbox/<id>-clarify.md` with `reply-to: <id>` and
  `kind: clarify`, list the questions, and stop. The sender is woken and answers with `kind: answer`.
- Done: write `outbox/<id>-done.md` with `reply-to: <id>`, `kind: done` and a short result (what, where, ERPNext ids).

## A quotation for the Owner's price approval
Only a draft Quotation goes to the Owner: `to: owner`, `kind: quotation`, `erpnext: Quotation/<name>`, and a note on
how you priced it (which price list and discount rule, and why), without amounts: the Owner reads them from ERPNext. Never submit a Quotation yourself, not with `update_document` either. The Owner approves (the server submits
it, or the Owner does) or sends it back with a note: revise the draft and hand it in again with `reply-to:` the id of the note.

## Packages from an Owner-only Space
They wait for the Owner before they are delivered. Leave legal, finance and pricing details out of them.
