---
name: security-review
description: "Review a plan or a release for security: OWASP Top 10 and STRIDE threats per module, with findings backed by evidence (file, line, request) and a severity. Tests only against local or staging, never anything else. Use as the Security Engineer in the plan review before a sprint and before a release."
---
# Security review

## Scope and safety
- Only the squad's own code, and only local or staging environments the owner approved. Never scan, probe or attack production, third-party services or other people's systems.
- No denial of service, no brute force, no real customer data. Use test accounts.
- Never read or print secrets; refer to them by variable name.

## Plan review (before a sprint)
For each module in `docs/squad/PLAN.md`, walk **STRIDE**:
- **Spoofing:** who can act as whom (authentication, sessions, tokens).
- **Tampering:** what input changes stored data (validation, server-side checks).
- **Repudiation:** which actions need an audit trail.
- **Information disclosure:** personal data, error messages, logs, files.
- **Denial of service:** unbounded queries, uploads, loops; rate limits.
- **Elevation of privilege:** role checks on every endpoint, not only in the UI.
Write findings into the Security section of `docs/squad/sprint-<N>/PLAN-REVIEW.md` with the module and the change you ask for.

## Release review (before a merge to main or a deploy)
Check against the **OWASP Top 10**: broken access control, cryptographic failures, injection (SQL, command, template), insecure design, misconfiguration (debug on, open CORS, default credentials), vulnerable dependencies (`npm audit` or the stack's equivalent), authentication failures, integrity (unsigned updates, unsafe deserialisation), logging and monitoring gaps, server-side request forgery.

## Findings
`docs/squad/security/<sprint or release>.md`, one finding per section:
```
## S1 · High · Broken access control in M04
Evidence: GET /api/orders/123 returns another user's order (test account B, staging). src/api/orders.ts:42 has no owner check.
Fix: check order.userId === session.userId on the server.
```
Severity: Critical, High, Medium, Low. Every finding has evidence; "might be" without evidence is a question, not a finding.
Report to the lead: the number of findings per severity and which block the release (Critical and High do).
