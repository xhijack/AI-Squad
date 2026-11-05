---
id: finance
title: Finance
version: 2
category: finance
description: An Owner-only finance desk that runs the monthly close, keeps the cash-flow view and budget vs actual, reconciles the bank and drafts receivables follow-ups from a read-only ERPNext key; it never pays, posts, files or sends anything.
keywords: [finance, keuangan, accounting, akuntansi, bookkeeping, pembukuan, cash flow, arus kas, receivables, piutang, payables, hutang, invoice, faktur, tax, pajak, ppn, pph, budget, anggaran, close, tutup buku, reconciliation, rekonsiliasi, bank]
workflow: free-team
layout: rows
space: { kind: department, access: owner, erpnext: finance, telegram: counts }
intake:
  - { id: books, kind: choice, required: true, label: "Where are the books kept?", options: [{ value: erpnext, label: ERPNext, hint: "Read with a read-only finance key; agents never post." }, { value: other, label: Other accounting software, hint: "Accurate, Jurnal, Xero, ...: you export the reports." }, { value: sheet, label: A spreadsheet, hint: "You place the file in docs/finance/." }] }
  - { id: books-name, kind: text, required: true, label: "Which software?", placeholder: "Accurate", when: { books: other } }
  - { id: currency, kind: text, required: true, label: "Main currency:", default: IDR, placeholder: IDR }
  - { id: close-day, kind: text, required: true, label: "The month is closed by which day?", default: "5", placeholder: "5" }
roles:
  - { template: finance-controller, min: 1, default: 1, max: 1, lead: true, why: "Leads the desk: runs the month-end close, the cash-flow view and budget vs actual, and drafts receivables follow-ups for you to send." }
  - { template: bookkeeper, min: 0, default: 1, max: 1, why: "Reconciles ERPNext with your bank statements, flags anomalies and prepares the tax worksheets." }
sourceDocs:
  - { path: docs/FINANCE-POLICY.md, title: Finance policy, purpose: "Approval limits, who pays, the close calendar, the tax calendar and the budget", owner: finance-controller, readers: all }
kpis:
  - { id: overdue-receivables, name: Overdue receivables, unit: IDR, direction: down, period: total, every: day, source: { kind: erpnext, doctype: Sales Invoice, filters: [["docstatus", "=", 1], ["status", "in", ["Overdue", "Overdue and Discounted"]]], aggregate: sum, field: outstanding_amount }, note: "outstanding on submitted Sales Invoices past their due date, read with the finance key" }
  - { id: cash-in-bank, name: Cash in bank, unit: IDR, direction: up, period: total, source: { kind: manual }, note: "entered by the owner from the bank" }
  - { id: days-to-close, name: Days to close the month, unit: days, direction: down, period: month, source: { kind: manual } }
  - { id: unreconciled-lines, name: Unreconciled bank lines, unit: lines, direction: down, period: total, every: day, source: { kind: erpnext, doctype: Bank Transaction, filters: [["docstatus", "=", 1], ["status", "=", "Unreconciled"]], aggregate: count } }
cadence:
  - { id: receivables-digest, title: Receivables digest, agent: finance-controller, every: weekdays, at: "08:00", budget: 1, task: "Write today's receivables digest in docs/finance/receivables/<date>.md from ERPNext (read only): overdue Sales Invoices by age (1-30, 31-60, 61-90, over 90 days), the customers to follow up today and a DRAFT follow-up for each. Send nothing; the owner decides." }
  - { id: monthly-close, title: Monthly close checklist, agent: finance-controller, every: "monthly:1", at: "08:30", budget: 2, task: "Start last month's close in docs/finance/close/<yyyy-mm>.md from the close calendar in docs/FINANCE-POLICY.md: each step, who does it, its status and what blocks it; the bank reconciliation for the bookkeeper. Post, submit and pay nothing." }
  - { id: budget-vs-actual, title: Budget vs actual note, agent: finance-controller, every: "weekly:mon", at: "09:00", budget: 1, task: "Write the weekly budget vs actual note in docs/finance/budget/<date>.md: the budget in docs/FINANCE-POLICY.md against ERPNext's actuals per account group this month, and the three largest differences with their likely cause. Read only." }
  - { id: bank-reconciliation, title: Weekly bank reconciliation, agent: bookkeeper, every: "weekly:fri", at: "09:00", budget: 1, task: "Reconcile the bank statements the owner placed in docs/finance/bank/ against the books. Write docs/finance/reconciliation/<date>.md: matched, unmatched and questions for the lead. Post, submit and pay nothing, and log in to no bank." }
flows:
  The monthly close:
    - { by: bookkeeper, does: "Reconciles the bank statements you placed in docs/finance/bank/" }
    - { by: lead, does: "Runs the close checklist and the budget vs actual note" }
    - { by: owner, does: "Reviews them; you post, pay and file yourself" }
  A receivables follow-up:
    - { by: lead, does: "Lists the overdue invoices in the receivables digest" }
    - { by: lead, does: "Drafts a reminder per customer" }
    - { by: owner, does: "Sends the reminders, or approves them for the Outbox" }
gates: [source documents approved, owner approval before any payment, filing or message to a customer]
ownerOnly: [payments, submitting or cancelling ERPNext documents, tax filing, invoices and reminders to customers, salaries]
kickoff: "Start as the lead of this desk. Read AISQUAD.md first. Then ask me for the finance policy (approval limits, who pays, the close calendar, the tax calendar, the budget). Draft docs/FINANCE-POLICY.md from my answers for my approval. No finance work starts before it is approved."
---
## Purpose
An Owner-only finance desk: the monthly close, the cash-flow view, budget vs actual, bank reconciliation and receivables follow-up drafts, from ERPNext through a read-only key. Money moves only by the owner's hand.

## Source documents
| Document | Purpose | Owner | Read by |
|---|---|---|---|
| `docs/FINANCE-POLICY.md` | Approval limits, who pays, close calendar, tax calendar, budget | Finance Controller | everyone |

## Channels
- **Owner ↔ desk:** only the lead ({{lead}}) talks to the owner.
- **Working files:** `docs/finance/` (close, cash flow, receivables, budget, reconciliation, tax), one file per period.
- **Bank statements** are placed by the owner in `docs/finance/bank/`; agents never log in to a bank.
- **Requests from other Spaces** arrive as handoff packages; the answer names a file or gives a total, never salaries, customers' balances or bank details.
- **Telegram:** only counts leave this Space (how many items wait, how many targets are behind); amounts and names stay in the app.

## Hard stops
No payments, no submitting or cancelling ERPNext documents, no tax filing, no invoices or reminders to customers without the owner's approval, no salary data outside this Space.

## Gates
1. **Source documents approved:** no finance work before `docs/FINANCE-POLICY.md` is approved.
2. **Owner approval:** every payment, filing, submitted document and message to a customer is the owner's.

## Personal data
Salaries, bank account numbers and tax IDs of people never go into the repository in clear: totals per month, the last 4 digits at most.

## Rules per role

### finance-controller
- Every follow-up, journal entry and filing is a DRAFT for the owner; say what it needs to go out.

### bookkeeper
- Cite the ERPNext document or the statement line for every number.
