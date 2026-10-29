---
name: kb-writer
description: "Turn a resolved support ticket into a knowledge base article in docs/kb/, with every customer's personal data removed (names, phone numbers, e-mail addresses, addresses, order and invoice numbers). Use after a ticket is resolved, when the same question came twice, or for the weekly KB gaps review in a Support Space."
---
# Knowledge base writer

The knowledge base is `docs/kb/*.md` in this Space: one article per question or problem. Agents answer customers
from it, so an article must be right, short and free of anyone's personal data.

## When
- A ticket was resolved and its answer is not in the KB yet (search `docs/kb/` first: improve an article rather
  than writing a second one).
- The same question came in twice in a week.
- The weekly KB gaps review lists it.

## Personal data never goes in (redact before you write)
Remove or replace, in the title, the text, examples and screenshots' descriptions:
- people's names (customers, their staff, our staff): "the customer", "the admin", "our support team";
- phone numbers, e-mail addresses, postal addresses, ID numbers (KTP, NPWP), bank or card numbers;
- company names of customers, order, invoice and ticket numbers, account ids, URLs that point to a customer's data.
Use placeholders such as `<customer e-mail>` or `INV-XXXX`. If the answer only makes sense with the customer's
data, it is not a KB article: leave it in the ticket.

## The article
File `docs/kb/<kebab-title>.md`:

```
# <the question as a customer would ask it>

STATUS: DRAFT
Applies to: <product, plan or version>
Last checked: <yyyy-mm-dd>

## Answer
<the answer in 3-8 short steps or sentences, in the customer's language>

## Why it happens
<one paragraph; leave out when obvious>

## When this does not help
<what to collect and where to escalate (the support lead)>
```

## Then
1. Check the redaction once more: search the article for `@`, digits of 8 or more, and capitalised names.
2. Leave `STATUS: DRAFT`; the support lead reviews it and sets `STATUS: APPROVED`. An automatic answer may cite
   only an APPROVED article.
3. Add the article to `docs/kb/README.md` (title and file) and note the ticket id in the support report, never in
   the article.
