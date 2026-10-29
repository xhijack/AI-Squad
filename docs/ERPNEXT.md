# ERPNext and the Sales pilot (0.19)

The AI Squad works with one ERPNext site (for Sopwer: `office.sopwer.id`) in two ways:

1. **Agents** read and write ERPNext through [Frappe Assistant Core](https://github.com/buildswithpaul/Frappe_Assistant_Core)
   (FAC), an MCP server that runs inside ERPNext. Each agent works as an ERPNext user made for its role, so
   ERPNext's own permissions decide what it may do.
2. **The server** watches the pipeline (code, no model) and moves work between Spaces:
   a new Lead → the Sales Space; a draft Quotation an agent hands to you → a **price approval** that only you can
   give; a Quotation that became an order → a project handoff to the delivery Space, without prices.

```
ERPNext Lead ──watcher──▶ Sales Space (agent qualifies, creates Opportunity + draft Quotation)
                                   │  package: to: owner, kind: quotation
                                   ▼
                     Owner's desk: price approval (hard stop: money)
                       ├─ Approve and submit ──▶ server submits with the owner key ──▶ agent drafts the cover e-mail
                       └─ Send back with a note ──▶ agent revises the draft, hands it in again
ERPNext Quotation "Ordered" ──watcher──▶ delivery Space (agent creates the Project and Tasks)
```

## 1. In ERPNext

1. Install Frappe Assistant Core on the site (see its README; with bench: `bench get-app` its repository, then
   `bench --site <site> install-app frappe_assistant_core`). In **FAC Admin**, switch off the plugins you do not
   need, at least the data science plugin (it can run Python and SQL on the server).
2. Make **one user per role**, each with only what it needs (Role Permission Manager). Suggested:

   | User | Role in The AI Squad | ERPNext permissions |
   |---|---|---|
   | `ai.sales@…` | Sales | Lead, Opportunity, Quotation: read, write, create (**no Submit, Cancel or Delete**); Customer, Item, Item Price, Price List: read |
   | `ai.delivery@…` | Delivery | Project, Task: read, write, create; Customer, Quotation, Sales Order: read |
   | `ai.finance@…` | Finance (1.7) | **Read only**: the standard *Accounts User* role with *Read* and *Report* only (Role Permission Manager: untick Write, Create, Submit, Cancel, Delete, Email, Print and Export on every Accounts DocType it has); Sales Invoice, Purchase Invoice, Payment Entry, Journal Entry, GL Entry, Bank Transaction, Account, Budget: read |
   | you (or `ai.owner@…`) | Owner (optional) | Quotation: Submit (used only by the server, after your approval) |

   **Required:** the Sales user must not have Submit on Quotation. The standard *Sales User* role has it: give the
   Sales user a custom role instead. This is the guard that holds even if an agent tries `update_document` with
   `docstatus: 1`; the watcher's alert only tells you afterwards.
3. For each user: **User → Settings → API Access → Generate Keys**. Copy the key and the secret.

## 2. In The AI Squad

1. **Menu → Admin → ERPNext** (Owner only):
   - the site address (`https://office.sopwer.id`, the site only), how often to check (5 minutes), **Watch the pipeline**;
   - where new Leads go (the Sales Space and, optionally, its agent) and where orders go (the delivery Space);
   - the key and secret of each role. They are checked against the site (`frappe.auth.get_logged_user`) and stored in
     `~/.aisquad/secrets.json` (mode 600); the page only shows `····abcd` and the ERPNext user.
   - **Test the keys** checks all three; **Check now** runs the watcher once. The first run only remembers where the
     pipeline is: Leads and orders from before are not handed over.
2. **Admin → Spaces → ERPNext**: *Sales key* for the Sales Space, *Delivery key* for project Spaces. Agents of those
   Spaces then get the `erpnext` MCP server (tools `mcp__erpnext__*`):
   - allowed without asking: list, get, search, create and update documents, reports, CRM activity;
   - always denied: `delete_document`, `document_action` (submit, cancel), `run_workflow`, `send_email`,
     `send_crm_email`, `reply_to_helpdesk_ticket`, `run_python_code`, `run_database_query`.
   Background jobs of these Spaces run on this machine only (the keys never go to a worker).
3. Make the Sales Space **Owner only** (Admin → Spaces → Access) when its agents see prices and customers: then every
   package leaving it waits for you as well.

How a session gets the key: `~/.aisquad/erpnext/mcp.json` (no secrets in it) points Claude Code at
`${AISQUAD_ERP_URL}/api/method/frappe_assistant_core.api.fac_endpoint.handle_mcp` with the header
`Authorization: token ${AISQUAD_ERP_KEY}:${AISQUAD_ERP_SECRET}`; Claude Code fills in the variables when it starts.
A background job gets them in its environment; a Desk session through a mode 600 file that the shell reads and
deletes before it starts Claude Code. They never appear in an argument list, a repository, a log or the browser.

## The finance key (1.7)

The Finance Space (Blueprint *Finance*, Owner-only) reads the books with its own key, never with the Owner's:

- **In ERPNext**: a user `ai.finance@…` with the *Accounts User* role restricted to Read and Report (a copy of the
  role, e.g. *AI Finance Read*, is the safest: untick everything but Read and Report). The user must not be able to
  write, submit, cancel, pay or e-mail anything. Salary slips: give it *Read* on Salary Slip only if you want payroll
  totals in the close; they stay in the Finance Space.
- **In The AI Squad**: Admin → ERPNext → *Finance* key; Admin → Spaces → the Finance Space → *ERPNext: Finance key*
  (the Blueprint sets it). Only an Owner-only Space can have it: a team Space is put back to *No*.
- **What agents get**: the `erpnext` tools for reading only. `create_document`, `update_document` and
  `add_crm_activity` are denied on top of the usual list, so even a finance user with too many rights cannot write
  through an agent. The role files deny them as well.
- **Targets**: the Finance Space measures with the finance key (*Overdue receivables*: the sum of
  `outstanding_amount` of submitted Sales Invoices whose status is Overdue; *Unreconciled bank lines*: the count of
  submitted Bank Transactions with status Unreconciled). Without a finance key the Owner's key reads for it.
- **Telegram**: the Finance Space sends counts only (Admin → Spaces → Telegram: *Counts only*): no amounts, names,
  customers or answer buttons leave the app.

## 3. The price approval

A Quotation is never submitted by an agent. The Sales agent hands the draft to you with a package
(`to: owner`, `kind: quotation`, `erpnext: Quotation/<name>`). The server reads it and puts a card on your desk
(Attention, the Owner's room in the Office view, and Telegram as a hard stop with a 4-digit code):

- customer, total, discount, validity and each line, and the agent's note on prices and discounts;
- **Approve and submit**: the server checks that the Quotation is still exactly the version on the card you
  answered (a changed draft becomes a new card, also on Telegram) and submits that version with the owner key;
  ERPNext itself refuses it if it changed in between. Without an owner key the button is **Approve (you submit it
  in ERPNext)**: the approval is recorded and you press Submit in ERPNext yourself. That keeps the key that can
  submit off this machine entirely. The agent is told to draft the cover
  e-mail for you to send; it sends nothing itself.
- **Send back with a note**: the agent revises the draft and hands it in again.

Only the Owner sees these cards (they are hidden from Members and Viewers, also on Telegram). Telegram shows only
the first line (customer and total); the lines and the note are opened in the app. Amounts are never written to the
Squad Log.

If an agent's ERPNext user submits a Quotation anyway (a permission left open), the watcher raises an alert:
remove the Submit permission from that user's role.

## 4. Numbers

Admin → ERPNext → **Sales pipeline**: Leads handed over, prices approved, orders, and the median time from the
Lead to the draft Quotation and to the approved Quotation (ERPNext's own timestamps). Admin → **Handoffs**: every
package between Spaces and the share of handoffs done without a round of questions.

## Files

```
~/.aisquad/secrets.json             erpnext.{sales,delivery,finance,owner}: key, secret, ERPNext user (mode 600)
~/.aisquad/erpnext/mcp.json         the MCP configuration sessions share (variables only)
~/.aisquad/erpnext.json             the watcher: where the pipeline was, Leads and orders handed over, approvals, alerts
~/.aisquad/handoffs.json            every package between Spaces (the last 500)
<repo>/docs/squad/handoffs/         outbox/ (written by agents), sent/ (copies), inbox/ (delivered packages)
```

## Not yet

- The pilot's acceptance (three real Sopwer opportunities through the flow) runs on the Sopwer machine against
  `office.sopwer.id`; the cloud tests use a fake ERPNext.
- OAuth sign-in for FAC (API keys only for now), Sales Orders and invoices, and sending the cover e-mail from the app.
