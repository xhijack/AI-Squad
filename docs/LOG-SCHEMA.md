# Squad Log schema (v1)

The Squad Log is an append-only record of how a squad worked: who did what, who talked to whom, and what it cost. It is written so that an AI can read it efficiently (one JSON object per line, a short `summary` on every event) and audit the process and the token use afterwards (`server/audit.js`).

## Files

- `~/.aisquad/logs/<floor-id>/<YYYY-MM-DD>.jsonl`, one file per local day. Floor 1 (independent agents) logs under `independents`.
- Machine-local, never in the project repository: the log can contain prompts and business data.
- Files older than 7 days are gzipped (`<day>.jsonl.gz`); files older than `prefs.logRetentionDays` in `~/.aisquad/building.json` (default 90) are deleted. Both run once an hour.
- `.state.json` in the same folder keeps the collectors' offsets and the last seen board; it is not part of the log.
- Read it with `GET /api/floors/<floor-id>/log?from=&to=&type=&agent=&sprint=&module=&limit=` (PIN). `from` / `to` are ISO times or milliseconds; `type` is a comma list of types (`tool.call`), type prefixes (`question`) or categories (`communication`).

## Common fields

Every line has these fields, in this order. Unknown values are `null`.

| Field | Meaning |
|---|---|
| `v` | Schema version, `1`. |
| `id` | Unique id. Events seen by two sources share an id (`tool:<tool_use_id>`, `msg:<tool_use_id>`, `use:<message id>`), so they are logged once. |
| `ts` | ISO 8601 time (UTC). |
| `floor` | Floor id. |
| `sprint` | Running sprint number on Squad Sprint Floors (`.claude/squad/config.sh`). |
| `module` | Module id (`M01`): from the file or task the event is about, else the module the agent has IN_PROGRESS on the board. |
| `agent` | Agent id (`owner` for the owner's own session in the project, `subagent` when a subagent has no type). |
| `role` | The agent's Role Template id from `team.json`. |
| `session` | Claude Code session id (transcript file name) or tmux session. |
| `model` | Model id, when known. |
| `type` | Event type, below. |
| `summary` | One short sentence for humans and AIs to scan. |
| `data` | Type-specific fields. |

## Sources

| Source | Events |
|---|---|
| Claude Code transcripts (`~/.claude/projects/...`, read incrementally every 15 s) | `task.given`, `task.delegated`, `message.sent`, `question.asked` / `question.answered` (AskUserQuestion), `tool.call`, `usage.turn` |
| Plugin hook events (`hooks/event.js`, live) | `tool.call` (deduplicated with the transcript by tool_use id), `permission.asked` / `permission.answered` |
| `docs/squad` and Blueprint documents (every 15 s) | `board.changed`, `handoff.written`, `qa.report`, `bug.opened` / `bug.closed`, `sprint.planned`, `doc.status`, `question.asked` / `question.answered` (QUESTIONS.md) |
| Squad Sprint gate hooks (`.git/aisquad-gates.jsonl`) | `gate.passed` / `gate.failed` |
| git (every minute) | `commit`, `sprint.closed` |
| Merge executor | `merge.done`, `merge.refused`, `gate.passed` / `gate.failed` (merge gate) |
| Server (start / stop, Watchdog, agent states) | `agent.*`, `watchdog.alert`, `agent.idle`, `agent.busy` |
| Audit | `audit.done`, `improvement.decided` |

The first scan of a Floor only records a baseline (the current board and files are not logged as new events); transcripts and commits are read back 7 days, on Floor 1 transcripts only 1 day (they are other projects' sessions). Agent names in files (`Tester: Sari`) and messages to `main` are resolved to the team's agent ids. Teammate messages that arrive in the lead's transcript are not logged again; the sender's `message.sent` is the event.

## Privacy

- Secrets are always removed (`server/redact.js`): API keys and tokens with known prefixes, JWTs, `Bearer` / `Basic` credentials, passwords in URLs, private keys, and `NAME=value` / `"name": "value"` when a word of the name is sensitive (`PASSWORD`, `SECRET`, `TOKEN`, `API_KEY`, `AUTH`, ...).
- Personal data is masked by default: e-mail addresses, phone numbers, national id numbers (16-digit NIK, US SSN) and bank account numbers (IBAN, or digits after "account" / "rekening").
- File contents and `.env` contents are never logged; tool calls log the path or a trimmed command only.
- Floor settings (`floor.json`): `log.messages: false` keeps message text, prompts and answers out of the log (only their length, e.g. `textChars`); `log.maskPersonalData: false` turns masking off (secrets are still removed).

## Event types


### Lifecycle (`lifecycle`)

**`agent.started`**: The AI Squad started the agent. `data.model` / `data.effort` are the configured values it was started with; the observed model is in each `usage.turn`.

```json
{"v":1,"id":"start-ex","ts":"2026-10-26T02:00:00.000Z","floor":"pos","sprint":1,"module":null,"agent":"budi-dev","role":"fullstack-developer","session":"aisquad-pos-budi-dev","model":"haiku","type":"agent.started","summary":"budi-dev started (haiku, medium)","data":{"model":"haiku","effort":"medium","via":"aisquad","withTask":true}}
```

**`agent.stopped`**: Stopped through The AI Squad (`data.via: aisquad`), a teammate inside the lead's session finished (`teammate finished`), or on Floor 1 the Claude Code process went away (`process ended`).

```json
{"v":1,"id":"fce9123beb5c","ts":"2026-10-26T02:01:00.000Z","floor":"pos","sprint":1,"module":null,"agent":"budi-dev","role":"fullstack-developer","session":"aisquad-pos-budi-dev","model":null,"type":"agent.stopped","summary":"budi-dev stopped","data":{"via":"aisquad"}}
```

**`agent.crashed`**: The agent's own session ended while The AI Squad did not stop it (tmux pane gone, Claude Code exited).

```json
{"v":1,"id":"cbaec9e5475d","ts":"2026-10-26T02:02:00.000Z","floor":"pos","sprint":1,"module":null,"agent":"quinn-qa","role":"qa-engineer","session":null,"model":null,"type":"agent.crashed","summary":"quinn-qa ended without a stop from The AI Squad","data":{"lastState":"working"}}
```

**`agent.model`**: The model seen in the transcript is not the configured one (logged once per observed model).

```json
{"v":1,"id":"fe44695a349a","ts":"2026-10-26T02:03:00.000Z","floor":"pos","sprint":1,"module":null,"agent":"rina-pm","role":"project-manager","session":null,"model":"claude-sonnet-5-5","type":"agent.model","summary":"rina-pm runs claude-sonnet-5-5, configured haiku","data":{"configured":"haiku","observed":"claude-sonnet-5-5"}}
```


**`node.lost`** (0.18, lifecycle): a worker machine went silent (45 s without a heartbeat) or was removed while
running this agent's background job. The job is marked failed (`lost: ...`) and queued again; `queued` is the new queue item.

```json
{"v":1,"id":"a91c0e2d7b13","ts":"2026-10-27T03:10:00.000Z","floor":"pos","sprint":null,"module":null,"agent":"budi-dev","role":"fullstack-developer","session":null,"model":null,"type":"node.lost","summary":"budi-dev's job was lost with the machine box-3 and queued again","data":{"job":"j-20261027-c3d4e5f6","node":"box-3","queued":"q-20261027-0a1b2c"}}
```

**`dispatch.idle-stopped`** (0.13, lifecycle): the dispatcher stopped an agent that sat idle (`idleMin`) to free its
slot; `queue` is true when work was waiting. Resume continues the session.

### Work (`work`)

**`task.given`**: A prompt the owner typed or sent to the agent (from the transcript; `id` is the transcript record uuid).

```json
{"v":1,"id":"task:5f0c...","ts":"2026-10-26T02:04:00.000Z","floor":"pos","sprint":1,"module":null,"agent":"rina-pm","role":"project-manager","session":"1b2c3d4e-0000-4000-8000-00000000aaaa","model":"claude-haiku-5-5","type":"task.given","summary":"owner gave rina-pm a task: Start sprint 1: the cart and the checkout.","data":{"by":"owner","text":"Start sprint 1: the cart and the checkout."}}
```

**`board.changed`**: A row on `docs/squad/TASKS.md` (or `docs/BOARD.md`) changed column. `data.reopened` is set when a row goes back from REVIEW/DONE.

```json
{"v":1,"id":"e0c51e1fdfd4","ts":"2026-10-26T02:06:00.000Z","floor":"pos","sprint":1,"module":"M01","agent":"budi-dev","role":"fullstack-developer","session":"8c1f2e4a-55d1-4c0e-9a7e-0b6f3f1d2a10","model":"claude-haiku-5-5","type":"board.changed","summary":"BUILD M01 Cart: TODO -> IN_PROGRESS (budi-dev)","data":{"task":"BUILD M01 Cart","owner":"budi-dev","from":"TODO","to":"IN_PROGRESS"}}
```

**`handoff.written`**: A new handoff file appeared.

```json
{"v":1,"id":"0e7aad4e489f","ts":"2026-10-26T02:07:00.000Z","floor":"pos","sprint":1,"module":"M01","agent":"budi-dev","role":"fullstack-developer","session":"8c1f2e4a-55d1-4c0e-9a7e-0b6f3f1d2a10","model":"claude-haiku-5-5","type":"handoff.written","summary":"handoff M01 written","data":{"module":"M01","file":"docs/squad/handoff/M01.md"}}
```

**`qa.report`**: A QA report appeared or changed status or round. `data.failed` lists failed rows of its tables (number + scenario).

```json
{"v":1,"id":"e293b2bfb356","ts":"2026-10-26T02:08:00.000Z","floor":"pos","sprint":1,"module":"M01","agent":"quinn-qa","role":"qa-engineer","session":"8c1f2e4a-55d1-4c0e-9a7e-0b6f3f1d2a10","model":"claude-haiku-5-5","type":"qa.report","summary":"QA M01 round 1: FAIL (1 failed)","data":{"module":"M01","round":1,"status":"FAIL","failed":["3 Empty cart shows a message"],"file":"docs/squad/qa/M01.md"}}
```

**`bug.opened`**: A new bug file `docs/squad/bugs/Mxx-Byy.md`.

```json
{"v":1,"id":"1af10cae0230","ts":"2026-10-26T02:09:00.000Z","floor":"pos","sprint":1,"module":"M01","agent":"budi-dev","role":"fullstack-developer","session":"8c1f2e4a-55d1-4c0e-9a7e-0b6f3f1d2a10","model":"claude-haiku-5-5","type":"bug.opened","summary":"bug M01-B01 opened (Major, budi-dev)","data":{"bug":"M01-B01","severity":"Major","owner":"budi-dev","kind":"Function"}}
```

**`bug.closed`**: A bug reached VERIFIED, DEFERRED or CLOSED.

```json
{"v":1,"id":"9707ab76679a","ts":"2026-10-26T02:10:00.000Z","floor":"pos","sprint":1,"module":"M01","agent":"budi-dev","role":"fullstack-developer","session":"8c1f2e4a-55d1-4c0e-9a7e-0b6f3f1d2a10","model":"claude-haiku-5-5","type":"bug.closed","summary":"bug M01-B01 verified","data":{"bug":"M01-B01","status":"VERIFIED","severity":"Major","owner":"budi-dev"}}
```

**`gate.passed`**: A gate accepted work. `data.gate`: `board` and `task-completed` (Squad Sprint hooks, via `.git/aisquad-gates.jsonl`) or `merge` (quality gate of the merge executor).

```json
{"v":1,"id":"59ef50f192e4","ts":"2026-10-26T02:11:00.000Z","floor":"pos","sprint":1,"module":"M01","agent":"budi-dev","role":"fullstack-developer","session":"8c1f2e4a-55d1-4c0e-9a7e-0b6f3f1d2a10","model":"claude-haiku-5-5","type":"gate.passed","summary":"board gate passed for BUILD M01 Cart","data":{"gate":"board","subject":"BUILD M01 Cart"}}
```

**`gate.failed`**: A gate refused work, with `data.reason`.

```json
{"v":1,"id":"6e93d9f7ea1f","ts":"2026-10-26T02:12:00.000Z","floor":"pos","sprint":1,"module":"M01","agent":null,"role":null,"session":null,"model":null,"type":"gate.failed","summary":"merge gate failed for sprint-1: exit 1","data":{"gate":"merge","subject":"sprint-1","command":"npm test","reason":"exit 1"}}
```

**`merge.done`**: The merge executor merged a branch.

```json
{"v":1,"id":"02bf3aec6e0b","ts":"2026-10-26T02:13:00.000Z","floor":"pos","sprint":1,"module":null,"agent":null,"role":null,"session":null,"model":null,"type":"merge.done","summary":"merged sprint-1 into main","data":{"branch":"sprint-1","into":"main","trigger":"sprint","commits":6}}
```

**`merge.refused`**: The merge executor refused or failed (`data.result`), with the reason.

```json
{"v":1,"id":"743c4aef43ea","ts":"2026-10-26T02:14:00.000Z","floor":"pos","sprint":1,"module":null,"agent":null,"role":null,"session":null,"model":null,"type":"merge.refused","summary":"merge of sprint-1 refused: Quality gate failed (exit 1)","data":{"branch":"sprint-1","into":"main","trigger":"sprint","result":"refused","reason":"Quality gate failed (exit 1)"}}
```

**`sprint.planned`**: The first time the running sprint's `PLAN.md` has module rows: module count, story points, owners.

```json
{"v":1,"id":"94eac277b8e1","ts":"2026-10-26T02:15:00.000Z","floor":"pos","sprint":1,"module":null,"agent":null,"role":null,"session":null,"model":null,"type":"sprint.planned","summary":"sprint 1 planned: 2 modules, 8 SP","data":{"modules":2,"sp":8,"list":[{"module":"M01","sp":3,"owner":"budi-dev"},{"module":"M02","sp":5,"owner":"sari-dev"}]}}
```

**`sprint.closed`**: The closing commit `docs(squad): close sprint N` was seen.

```json
{"v":1,"id":"6d3a3580c543","ts":"2026-10-26T02:16:00.000Z","floor":"pos","sprint":1,"module":null,"agent":null,"role":null,"session":null,"model":null,"type":"sprint.closed","summary":"sprint 1 closed","data":{"sha":"3f2a9c1d8e7b"}}
```

**`doc.status`**: A source document of the Blueprint changed status (`missing`, `draft`, `approved`). The first scan of a Floor records the current statuses.

```json
{"v":1,"id":"af86a2b996d5","ts":"2026-10-26T02:17:00.000Z","floor":"pos","sprint":null,"module":null,"agent":null,"role":null,"session":null,"model":null,"type":"doc.status","summary":"docs/PRD.md is approved","data":{"doc":"docs/PRD.md","status":"approved","owner":"project-manager"}}
```

**`commit`**: A new commit on any branch. `agent` is set when the author e-mail is a per-agent identity (`<agent-id>@...`).

```json
{"v":1,"id":"785f02cafb95","ts":"2026-10-26T02:18:00.000Z","floor":"pos","sprint":1,"module":"M01","agent":"budi-dev","role":"fullstack-developer","session":"8c1f2e4a-55d1-4c0e-9a7e-0b6f3f1d2a10","model":"claude-haiku-5-5","type":"commit","summary":"commit 9b1e0c2d4f6a: feat(cart): M01 add and remove items","data":{"sha":"9b1e0c2d4f6a","subject":"feat(cart): M01 add and remove items"}}
```

**`job.started`** (0.11): a background job (headless runner) started for an agent. `via` is `aisquad` (the owner's
Desk) or the part of The AI Squad that started it.

```json
{"v":1,"id":"1f0a6c3e9b21","ts":"2026-10-26T02:19:00.000Z","floor":"pos","sprint":null,"module":null,"agent":"budi-dev","role":"fullstack-developer","session":null,"model":"sonnet","type":"job.started","summary":"budi-dev started a background job: write the README","data":{"job":"j-20261026-a1b2c3d4","kind":"task","title":"write the README","budgetUsd":2,"permissionMode":"dontAsk","via":"aisquad"}}
```

**`job.ended`** (0.11): the job ended: `done`, `failed` (with `error`, e.g. stopped at its budget) or `stopped`. From 0.18 a job that ran on a worker has `node` (the machine) and `branch` (the branch it pushed).

```json
{"v":1,"id":"7c2d1e0f4a65","ts":"2026-10-26T02:21:00.000Z","floor":"pos","sprint":null,"module":null,"agent":"budi-dev","role":"fullstack-developer","session":null,"model":"claude-sonnet-5-5","type":"job.ended","summary":"budi-dev's background job done ($0.04)","data":{"job":"j-20261026-a1b2c3d4","kind":"task","status":"done","cost":0.0421,"turns":2,"ms":121000}}
```


**`dispatch.queued`** (0.13): a start could not run now and waits in the dispatcher's queue. `action` is `start`,
`resume`, `job` or `sprint`; `priority` P0 to P3; `reason` why it waits; `via` who asked (`owner`, `auto-resume`,
`next-sprint`, `autopilot`).

```json
{"v":1,"id":"a3c90e7d1b42","ts":"2026-10-27T01:00:00.000Z","floor":"mkt","sprint":null,"module":null,"agent":"dodi-designer","role":"designer","session":null,"model":null,"type":"dispatch.queued","summary":"dodi-designer queued (job, P2): waiting for a free slot","data":{"action":"job","priority":"P2","reason":"waiting for a free slot","via":"owner"}}
```

**`dispatch.started`** (0.13): a queued start ran; `waitedMs` is how long it waited. **`dispatch.failed`**: it could
not start (`error`; `dropped` after three attempts). **`dispatch.removed`**: the owner removed it from the queue.

### Communication (`communication`)

**`message.sent`**: SendMessage from `agent` to `data.to` (agent-to-agent communication).

```json
{"v":1,"id":"msg:toolu_01B","ts":"2026-10-26T02:19:00.000Z","floor":"pos","sprint":1,"module":"M01","agent":"budi-dev","role":"fullstack-developer","session":"8c1f2e4a-55d1-4c0e-9a7e-0b6f3f1d2a10","model":"claude-haiku-5-5","type":"message.sent","summary":"budi-dev -> main: M01 ready for QA, handoff written.","data":{"to":"main","text":"M01 ready for QA, handoff written."}}
```

**`task.delegated`**: The agent spawned a subagent or teammate with the Agent/Task tool. `data.to` is the subagent type or name.

```json
{"v":1,"id":"deleg:toolu_01A","ts":"2026-10-26T02:05:00.000Z","floor":"pos","sprint":1,"module":null,"agent":"rina-pm","role":"project-manager","session":"1b2c3d4e-0000-4000-8000-00000000aaaa","model":"claude-haiku-5-5","type":"task.delegated","summary":"rina-pm delegated to budi-dev: Build M01 Cart from PLAN.md; write the handoff when tests are green.","data":{"to":"budi-dev","text":"Build M01 Cart from PLAN.md; write the handoff when tests are green."}}
```

**`question.asked`**: A question to the owner: `data.channel` is `AskUserQuestion` or `QUESTIONS.md` (numbered items in the questions file).

```json
{"v":1,"id":"ask:toolu_01C","ts":"2026-10-26T02:20:00.000Z","floor":"pos","sprint":1,"module":null,"agent":"rina-pm","role":"project-manager","session":"1b2c3d4e-0000-4000-8000-00000000aaaa","model":"claude-haiku-5-5","type":"question.asked","summary":"rina-pm asked the owner: Which payment provider should checkout use?","data":{"channel":"AskUserQuestion","text":"Which payment provider should checkout use?","options":["Midtrans","Xendit"]}}
```

**`question.answered`**: The answer and `data.waitMs`, how long the agent waited. In `QUESTIONS.md` an item counts as answered once it has an `Answer:` line.

```json
{"v":1,"id":"ans:toolu_01C","ts":"2026-10-26T02:21:00.000Z","floor":"pos","sprint":1,"module":null,"agent":"rina-pm","role":"project-manager","session":"1b2c3d4e-0000-4000-8000-00000000aaaa","model":"claude-haiku-5-5","type":"question.answered","summary":"owner answered rina-pm after 7 min: Midtrans","data":{"channel":"AskUserQuestion","answer":"Midtrans","waitMs":420000}}
```

**`permission.asked`**: Claude Code showed a permission prompt (hook Notification). `data.target` is what the tool wanted to touch.

```json
{"v":1,"id":"perm:pos/budi-dev:1761444000000","ts":"2026-10-26T02:22:00.000Z","floor":"pos","sprint":1,"module":"M01","agent":"budi-dev","role":"fullstack-developer","session":"8c1f2e4a-55d1-4c0e-9a7e-0b6f3f1d2a10","model":"claude-haiku-5-5","type":"permission.asked","summary":"budi-dev waits for permission (Bash)","data":{"tool":"Bash","target":"npm install express","text":"Claude needs your permission to use Bash"}}
```

**`permission.answered`**: The next event of that agent after the prompt; `data.waitMs` is how long it waited.

```json
{"v":1,"id":"perm:pos/budi-dev:1761444000000:a","ts":"2026-10-26T02:23:00.000Z","floor":"pos","sprint":1,"module":"M01","agent":"budi-dev","role":"fullstack-developer","session":"8c1f2e4a-55d1-4c0e-9a7e-0b6f3f1d2a10","model":"claude-haiku-5-5","type":"permission.answered","summary":"budi-dev got permission after 2 min","data":{"tool":"Bash","waitMs":95000}}
```


**`chat.message`** (0.14): a person sent an agent a direct message (Desk → Chat). `context` is `space` or
`general`; `delivery` is `typed` (into the running Desk session), `job` (a background job answers) or `queued`;
`text` is the first 200 characters. **`chat.reply`**: the agent's answer reached the chat (`status`).

```json
{"v":1,"id":"5d1c0b9e7a33","ts":"2026-10-27T02:00:00.000Z","floor":"sales","sprint":null,"module":null,"agent":"rudi-researcher","role":"lead-researcher","session":null,"model":null,"type":"chat.message","summary":"Dewi → rudi-researcher (chat): Who are the three biggest coffee chains in Bandung?","data":{"context":"space","delivery":"job","from":"Dewi","text":"Who are the three biggest coffee chains in Bandung?","by":"Dewi"}}
```

Since 0.14, an event caused by a person other than the Owner (a member's start, stop, task or chat) carries
`data.by` with their name.

### Tools (`tools`)

**`tool.call`**: One tool call: `data.tool`, `data.target` (a path relative to the project, a trimmed command or a pattern, never file contents), `data.ms`, `data.ok`, `data.error` (first 200 characters).

```json
{"v":1,"id":"tool:toolu_01D","ts":"2026-10-26T02:24:00.000Z","floor":"pos","sprint":1,"module":"M01","agent":"budi-dev","role":"fullstack-developer","session":"8c1f2e4a-55d1-4c0e-9a7e-0b6f3f1d2a10","model":"claude-haiku-5-5","type":"tool.call","summary":"budi-dev Bash npm test FAILED (5 s)","data":{"tool":"Bash","target":"npm test","ms":5400,"ok":false,"error":"2 failing"}}
```


### Usage (`usage`)

**`usage.turn`**: One assistant reply: tokens (`input`, `output`, `cacheRead`, `cacheWrite`) and `cost`, estimated in USD with the price table in `server/transcripts.js`. `model` is the model that answered.

```json
{"v":1,"id":"use:msg_01E","ts":"2026-10-26T02:25:00.000Z","floor":"pos","sprint":1,"module":"M01","agent":"budi-dev","role":"fullstack-developer","session":"8c1f2e4a-55d1-4c0e-9a7e-0b6f3f1d2a10","model":"claude-haiku-5-5","type":"usage.turn","summary":"budi-dev turn: 43312 in, 840 out, $0.0009","data":{"input":12,"output":840,"cacheRead":41000,"cacheWrite":2300,"cost":0.000898}}
```


### Idle and stalls (`idle`)

**`agent.idle`**: The agent went from working to idle. `data.openWork` is true when its team still had open board rows or work items (`teamOpen`, `ownOpen`).

```json
{"v":1,"id":"51f46d862f02","ts":"2026-10-26T02:26:00.000Z","floor":"pos","sprint":1,"module":"M01","agent":"budi-dev","role":"fullstack-developer","session":"8c1f2e4a-55d1-4c0e-9a7e-0b6f3f1d2a10","model":"claude-haiku-5-5","type":"agent.idle","summary":"budi-dev idle with open work","data":{"openWork":true,"ownOpen":1,"teamOpen":3}}
```

**`agent.busy`**: The agent started working again; `data.idleMs` is how long it was idle.

```json
{"v":1,"id":"801241bfa179","ts":"2026-10-26T02:27:00.000Z","floor":"pos","sprint":1,"module":"M01","agent":"budi-dev","role":"fullstack-developer","session":"8c1f2e4a-55d1-4c0e-9a7e-0b6f3f1d2a10","model":"claude-haiku-5-5","type":"agent.busy","summary":"budi-dev working again after 13 min","data":{"idleMs":780000}}
```

**`watchdog.alert`**: A new Watchdog alert for the Floor (stall, budget, merge).

```json
{"v":1,"id":"4a477381040b","ts":"2026-10-26T02:28:00.000Z","floor":"pos","sprint":1,"module":null,"agent":"budi-dev","role":null,"session":null,"model":null,"type":"watchdog.alert","summary":"watchdog stall: Budi has assigned work but has been idle for 12 min","data":{"kind":"stall","text":"Budi has assigned work but has been idle for 12 min"}}
```


### Audit (`audit`)

**`audit.done`**: An audit of the Floor finished (`server/audit.js`).

```json
{"v":1,"id":"c0c68d9f50eb","ts":"2026-10-26T02:29:00.000Z","floor":"pos","sprint":1,"module":null,"agent":null,"role":null,"session":null,"model":null,"type":"audit.done","summary":"audit: 5 findings, cost $0.041","data":{"audit":"2026-10-26T10-30-00Z","findings":5,"cost":0.041,"model":"sonnet"}}
```

**`improvement.decided`**: A proposed change from an audit finding was applied or dismissed.

```json
{"v":1,"id":"7cafc25c4f2d","ts":"2026-10-26T02:30:00.000Z","floor":"pos","sprint":1,"module":null,"agent":null,"role":null,"session":null,"model":null,"type":"improvement.decided","summary":"improvement applied: role-template fullstack-developer","data":{"decision":"applied","target":"role-template fullstack-developer","version":6,"finding":"F2"}}
```
