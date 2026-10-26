# Phase 2.4 brief: Autopilot

Product owner, 26 Oct 2026: **"Is there an automation mode, so that when something is not really
important the squad keeps going until it is done?"** Decisions: three levels, default
**Balanced** for new Floors, auto-answer timeout **3 minutes**.

Build after 0.3.4 (Resume, crash detection, Source documents dialog). Same rules as always:
English, zero dependencies, tests per module run one at a time, frugal memory, one commit per
step, no AI attribution, never push, do not restart the owner's service on 8097 or touch live
agent sockets. Version 0.4.0, Phase 2.4 section in `PROGRESS.md`, README section "Autopilot".

## Levels (Floor setting `autopilot`, in `floor.json`)

| Level | Behaviour |
|---|---|
| `off` | Every question waits for the owner (today's behaviour). |
| `balanced` (default) | The lead decides everything that is not critical, records it, and keeps going. Only **critical** items wait for the owner. |
| `full` | The lead decides everything except the hard-stop list, which always waits. |

**Critical / hard-stop list** (always waits, any level): money, prices, payments, billing;
legal, contracts, personal data / privacy law; production deploys, secrets, credentials;
irreversible actions (deleting data, force push, dropping tables, history rewrites); scope or
business changes that alter the PRD or the Blueprint's source documents; a source document that
does not exist at all. Under `balanced`, also: anything the Blueprint marks as owner-only.
Keep the list in one module and in the role/Blueprint text, so the lead and the server agree.

## Mechanics

1. **Lead rules**: the lead's generated prompt gets an Autopilot section for the Floor's level:
   decide non-critical questions yourself, pick the option you would recommend, write each
   decision to `docs/squad/QUESTIONS.md` as `DECIDED BY LEAD (autopilot), owner may correct`,
   and continue. Critical items: AskUserQuestion with options, one recommended.
2. **Auto-answer after 3 minutes** (`autopilotTimeoutSec`, default 180): when an
   AskUserQuestion dialog has an option labelled "(Recommended)" and is not critical (classify
   from the question text + the hard-stop list; when unsure, treat it as critical), the server
   answers it with that option after the timeout. Never auto-answer permission prompts for the
   hard-stop list. The Attention item stays visible as "Decided automatically: <option>" with
   **Change answer** (sends the owner's choice as a follow-up task to that agent).
3. **Waiting for your reply** cards (plain-text asks) under `balanced`/`full`: after the
   timeout, send the agent a nudge "Owner did not answer within 3 minutes: decide yourself per
   Autopilot rules unless it is critical, record the decision, and continue." Not for critical
   asks.
4. **Idle nudge**: when the lead and every teammate are idle while the board has open work
   (TODO/DOING/REVIEW) for more than 5 minutes, send the lead a nudge to continue (max once per
   15 minutes, logged). Replaces nothing in the shout bubble.
5. **Chain**: crash, then auto-resume (0.3.4 setting, on when Autopilot is not `off`), then the
   sprint continues, then the sprint closes, then the merge runs (only if the owner approved
   auto-merge), then the next sprint starts (only if that Floor option is on). Stop when the
   backlog is empty, the budget is reached, memory is under pressure, or a critical item waits.
6. **Guards stay**: budget per Floor, memory guard / max concurrent agents, the source document
   gate (Autopilot never approves a source document), never push.

## UI

- Floor Settings: Autopilot level (Off / Balanced / Full) with one sentence each, timeout,
  and the hard-stop list shown read-only.
- Floor status pill: `Autopilot: Balanced` chip; when something critical waits it says so.
- Attention: auto-decided items in a muted style with the chosen option, **Change answer** and
  **OK**; a daily digest "Decided by autopilot today: N" in the Lobby.
- Set up Squad review step: Autopilot level, default Balanced.

## Log and Audit

- Log events: `autopilot.decided` (who decided: lead or server timeout, question, option,
  critical=false), `autopilot.nudged`, `autopilot.blocked` (critical item waiting).
- Audit gets an Autopilot section: decisions taken, decisions the owner later changed
  (rate = quality signal), critical items that were wrongly auto-decided (must be zero), time
  saved waiting. Findings may propose changes to the hard-stop list or the lead's rules.

## Acceptance

- Unit tests: classification of critical vs non-critical (with tricky examples in English and
  Indonesian: "harga", "hapus data", "deploy produksi", "rename a button"), the timeout
  answer, never answering hard-stop items, idle nudge rate limit, chain stops.
- Playground dogfood with haiku: a lead asks a non-critical question with a recommended option
  and one critical question; after 3 minutes the first is answered automatically and the
  second still waits.
- Screenshots of the settings, the pill and an auto-decided Attention item at 1440 and 390.
