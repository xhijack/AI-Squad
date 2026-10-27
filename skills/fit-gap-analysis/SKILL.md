---
name: fit-gap-analysis
description: "Map business requirements onto ERPNext: standard fit, configuration, or a gap that needs development, with the feature used, the effort and the risk. Use when a BRD or a client's process description arrives, and before any customisation is planned."
---
# Fit-gap analysis

Output: `docs/FIT-GAP.md`, one table row per requirement, grouped by module (Selling, Buying, Stock, Accounting,
Manufacturing, Projects, HR and Payroll, CRM, Assets, POS, custom).

| Req | Process step | Result | ERPNext feature, setting or DocType | Effort | Risk | Notes |
|---|---|---|---|---|---|---|

## Result
- **Fit:** works with ERPNext standard as installed (name the feature: e.g. Sales Order → Delivery Note → Sales Invoice).
- **Configure:** standard plus settings, a workflow, a print format, a custom field, a report (Report Builder or a
  script report), naming series, permissions. Still upgrade-safe.
- **Gap:** needs a custom app (DocType, server script, integration). Write why configuration is not enough, the
  smallest change that closes it, the effort in days, and whether it touches accounting or stock ledgers (high risk).
- **Process change:** the client changes how they work instead; only with the client's agreement.

## Rules
1. Standard first; never propose editing ERPNext core: a gap is always a custom app.
2. Every row cites its requirement id from `docs/BRD.md`; a requirement without a row is a finding.
3. Effort in person-days with a range; risk Low / Medium / High with one line why.
4. Accounting, tax (PPN, e-Faktur, PPh), stock valuation and payroll rules: mark **verify with the client's
   accountant** when the requirement depends on their policy.
5. End with a summary: counts of Fit / Configure / Gap / Process change, total gap effort, and the gaps the owner
   must approve before development starts.
