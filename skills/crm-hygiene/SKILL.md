---
name: crm-hygiene
description: "Run the data hygiene check on CRM data: duplicates, required fields, valid stages, stale records and consent, and fix or flag issues without deleting. Use before imports, before reports, and weekly."
---
# CRM hygiene check

## Check
1. **Duplicates:** same company domain or same person (same email or name + company); merge, keep the oldest record, keep history.
2. **Required fields** from `docs/PIPELINE.md` are filled and valid (formats for email, phone, country).
3. **Stages:** every deal is in a defined stage and meets that stage's exit criteria; no deal skips stages without a note.
4. **Staleness:** deals without activity past the threshold in `docs/PIPELINE.md` are flagged for the owner of the deal.
5. **Consent:** contact records have a lawful basis or consent note before any outreach; opt-outs are respected everywhere.
6. **Ownership:** every open deal has an owner.

## Output
A short report: counts checked, issues found per type, fixed, needs a decision. Use CRM ids only; no personal data in reports, logs or commits. Never delete records without the lead's approval.
