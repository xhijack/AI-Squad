# Phase 2.2 brief: Squad Log and AI Audit

Product owner, 26 Oct 2026: **"When a squad builds a product and the agents talk to each other,
keep a log. The log will be read by AI again to analyse and audit whether the process was right
and whether the token / AI usage was efficient, so The AI Squad keeps improving."**

Read `SPEC.md`, `CLAUDE.md`, `PROGRESS.md` first. Same rules: English, zero dependencies, tests
per server module, one Conventional Commit per step, no AI attribution, never push, tests one
module at a time, at most one headless Chrome.

## Goals

1. A **Squad Log**: a complete, structured, append-only record of how a squad worked (who did
   what, who talked to whom, what it cost), written so that **an AI can read it efficiently**.
2. An **Audit**: deterministic metrics + an AI review that judges process correctness and token
   efficiency and proposes concrete improvements.
3. A **feedback loop**: audit findings become proposed changes to Role Templates and Blueprints
   that the owner can apply with one click (new template version), so squads get better over
   time.

## A. Squad Log

- **Where**: machine-local, never in the project repo (it can contain prompts and business
  data): `~/.aisquad/logs/<floor-id>/<YYYY-MM-DD>.jsonl`. One JSON object per line. Rotate daily,
  gzip files older than 7 days, delete after `logRetentionDays` (default 90, in
  `building.json`). Floor 1 (independent agents) is logged too, under `independents`.
- **Schema**: versioned (`"v": 1`), documented in `docs/LOG-SCHEMA.md` with an example for every
  event type. Common fields: `ts`, `floor`, `sprint`, `module`, `agent`, `role`, `session`,
  `model`, `type`, plus a short `summary` sentence a human or an AI can scan.
- **Events** (at least):
  - lifecycle: agent started / stopped / crashed, session id, model + effort configured vs
    observed;
  - work: task given by the owner (text), board row changes (TODO → DOING → DONE, from
    `TASKS.md`/`BOARD.md`), handoff written, QA report (round, status, failed criteria), bug
    opened / closed (severity, owner), gate pass / fail with the reason, merge done / refused,
    sprint planned / closed;
  - communication: every agent-to-agent message (SendMessage: from, to, text), questions to
    the owner (AskUserQuestion, QUESTIONS.md) and their answers with the waiting time,
    permission prompts and how long they waited;
  - tools: one event per tool call with tool name, target (file path or command, trimmed),
    duration, success / error. No file contents;
  - usage: per assistant turn: input, output, cache read, cache write tokens, model, estimated
    cost (prices in one table, as today);
  - idle and stalls: when an agent was idle while its team had open work, watchdog alerts.
- **Sources**: the existing hook event stream, transcripts (usage, SendMessage, AskUserQuestion),
  `docs/squad` files, git commits, the Watchdog and the merge executor. Deduplicate (a message
  seen in both a hook and a transcript is logged once; use message ids).
- **Privacy and safety**: redact secrets and env values (token-like strings, `KEY=value` for
  sensitive names, private keys), and mask personal data patterns (emails, phone numbers,
  national id numbers, bank account numbers) by default. Never log `.env` content or file
  contents. Redaction rules in one module with tests. A Floor setting can turn message text
  logging off (metadata only).
- **API and UI**: `GET /api/floors/:id/log?from=&to=&type=&agent=` (PIN). On the Floor, a
  **Log** dock button opens a timeline (filter by agent, type, sprint) with the communication
  view: who talked to whom, as a simple sequence list.

## B. Audit

- **Digest first**: `server/audit.js` turns a time range (a sprint, a day, or since the last
  audit) into a compact digest that fits comfortably in a prompt: metrics tables plus the most
  relevant events, not the raw log. Metrics, computed in code:
  - process: source documents approved before the first sprint (Software House: PRD, TECH,
    DESIGN, ENVIRONMENTS); every module has a handoff; QA report before merge; QA first-round
    pass rate; bugs per story point by severity; modules done in parallel vs plan; questions to
    the owner and how long they waited; gates refused; rework (modules reopened);
  - efficiency: tokens and cost per story point, per module and per agent; cache hit rate
    (cache read / total input); share of cost by model; turns per module; the same file read
    many times by one agent; failed tool calls and retries; long outputs; idle time with open
    work; time blocked on the owner; expensive model on simple work (e.g. opus for docs-only
    modules).
- **AI review**: `claude -p` with a bundled **`squad-audit`** skill (write it; English) reads
  the digest and returns JSON (`--json-schema`): findings `{ area: process|efficiency|quality,
  severity, evidence (metric or event refs), recommendation, target: { kind: role-template |
  blueprint | floor-setting, id, proposedChange } }` plus a short summary. Default model
  sonnet, configurable; show the audit's own cost.
- **Where**: `~/.aisquad/audits/<floor-id>/<timestamp>.json` + `.md` (human-readable report).
- **Triggers**: `/aisquad audit [floor] [--sprint N]`, an **Audit** button on the Floor, and
  automatically after a sprint closes when the Floor turns it on (default on for Squad Sprint
  Floors).
- **UI**: an Audit dialog with the score per area, findings sorted by severity, evidence links
  into the Log timeline, and the history of audits so trends show (cost per SP, pass rate,
  cache hit rate over sprints).

## C. Improvement loop

- A finding with a `target` can be turned into a **proposed change**: a diff against the Role
  Template or Blueprint text, shown for review. **Apply** saves it as a new template version
  (existing versioning, `.history`), so Floors see "Update available". **Dismiss** records why.
- Keep an **improvement ledger** `~/.aisquad/improvements.jsonl` (finding, proposal, decision,
  version created, and the metric before / after on the next audit) so we can see which changes
  actually helped.
- **Export for product improvement**: `/aisquad audit export` writes an anonymised bundle
  (metrics, findings, decisions; no message text, paths hashed) that the owner may send to
  Sopwer. Never upload anything automatically.

## Acceptance

- Unit tests for the log writer (rotation, retention, dedupe), redaction (every pattern, with
  false-positive checks), digest metrics on a fixture log, audit JSON parsing, and the apply flow
  (new template version created).
- A real dogfood on the playground with haiku: a small Software House sprint, then an audit that
  produces findings with evidence; one finding applied as a new template version.
- Screenshots (1440 and 390) of the Log timeline and the Audit dialog, in the Phase 2.1 look.
- `docs/LOG-SCHEMA.md` and a README section "Log and Audit". Phase 2.2 section in
  `PROGRESS.md`. Bump the version to 0.3.0.
