---
name: publish-request
description: "Ask for something to go out of the company: a social post, a message to a lead or a customer, an ad, a deploy to staging or production, or a merge of your branch into a linked repository's main branch. The server sends it after the Space's checks (rules, a second reviewer, the owner). Use whenever your work ends in publishing, sending or deploying; never call a publishing tool yourself."
---
# Ask for it to go out

Publishing tools are blocked for every agent. You write a **request**: one Markdown file in `docs/squad/outbox/` of
this Space. The server picks it up within a minute and applies this Space's rules; `docs/squad/outbox/TOOLS.md`
lists them and every publishing tool you may use, with its input schema. The answer comes to
`docs/squad/outbox/answered/<id>.md`: read it before you ask again.

## What happens to it
- **owner**: it waits for the owner (a card on the desk and in Telegram, one tap to send).
- **review**: a second reviewer checks it against the brand and the company facts; a problem sends it to the owner.
- **auto**: it goes out by itself, up to the day's limit.
- Always the owner: merges, ads, production deploys, tools that cost money, anything about money or legal, and whatever is
  over the day's limit.

## The file
```
---
channel: post              post | message | ad | deploy-staging | deploy-production | merge
from: sinta-marketing      your agent id
title: Five questions before you choose a digital invitation
via: postiz                post, message, ad: the integration, as TOOLS.md names it
tool: schedule_post        post, message, ad: its publishing tool
ref: v1.4.2                deploys: the version, tag or commit
repo: sopwer-landing-page  merge: the linked repository's id (your agent file lists it under Repositories)
branch: web-developer/k1   merge: your own branch there (it starts with your agent id)
---
Notes for the reviewer and the owner: why now, the source of every claim, what to check.

```json
{ "the tool's arguments": "exactly what will be sent, as its input schema in TOOLS.md says" }
```
```

- **post, message, ad**: the ```json block is what is sent, word for word: the final text, the channels, the time.
  Nothing outside it is sent. One request per post or message.
- **deploys**: no json block. Below the header write what goes out (version, what changed), the tests and the QA
  that passed, and how to roll back. After the **go** in `answered/`, deploy it yourself with the deploy skills and
  write what happened in `answered/<id>.result.md`. A production deploy needs the owner's go every time.
- **merge**: no json block. Commit your finished work on your own branch first (`<your-id>/<topic>`, never the main
  branch), then ask. Below the header write what changes and how to check it (pages and URLs, build or tests that
  passed, a preview). The server pushes your branch so the owner can read the change, sends the owner the commits,
  the files and the compare link (also on Telegram), and after the owner's yes merges exactly that commit into the
  main branch, runs the repository's quality gate and pushes it. Do not commit to the branch while it waits: a new
  commit sends it to the owner again. Refused (conflicts, a red gate): update your branch with the main branch, fix
  it, commit and ask again. You never push or merge yourself.

Never put keys, tokens or passwords in a request (it is refused). Never put a client's personal data in a public post.
A request that cannot be read is moved to `answered/` as `.invalid.md` with the reason: fix it and save it again.
