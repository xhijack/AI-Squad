---
name: local-seo
description: "Check a local business's Google Business Profile against a checklist, NAP consistency (name, address, phone) across the site and listings, and its local pages; compare with the businesses that win the local results. Use for a clinic, shop or any business whose customers search near a location."
---
# Local SEO

No paid local data: the profile is checked by hand from what the owner shares and what WebSearch and WebFetch show.

## Inputs
- From `docs/SEO-BRIEF.md`: the business name, every location's address and phone, opening hours, the service area, and one to three searches customers really make ("dentist near Kemang", not the brand).

## Steps
1. **Profile checklist** (ask the owner for a screenshot or the profile link when needed): claimed and verified; primary category right for the main search; additional categories; hours including holidays; phone; website link pointing to that location's page (not the home page); photos; services or products; Q&A; recent posts; review count, recency, rating and owner replies.
2. **NAP consistency**: WebFetch the site's contact and location pages and WebSearch the business name; list every place the name, address or phone differ (site, directories, social profiles, marketplaces).
3. **Who wins locally**: WebSearch each customer search with the area; note the businesses shown first and compare their category, reviews and pages with this one.
4. **Local pages**: one page per location with the NAP, hours, map, services, local proof and LocalBusiness schema; check them in GSC (`gsc_performance` with `dimensions: ["page","query"]`).
5. Prioritise: category and claim problems first, then NAP, then reviews and replies, then posts and Q&A.

## Output
`docs/seo/LOCAL.md`: the checklist with status, the NAP table, the head-to-head table and an ordered fix list. Review replies are DRAFTS for the owner.

## Rules
- Never write fake reviews or ask for reviews in exchange for anything.
- Changes to the profile and replies are the owner's to approve.

---
Method adapted from OpenSEO (MIT, every-app/open-seo): see LICENSE-NOTICE. Rewritten for The AI Squad to use free sources only (the `aisquad-google` tools, WebSearch / WebFetch and the site's repository); no OpenSEO or paid tool is used.
