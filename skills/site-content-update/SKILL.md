---
name: site-content-update
description: "Put an owner-approved piece on the site the way the site is managed: a page on a content branch in the site's repository (code), or a ready-to-paste draft for WordPress or another CMS. Use as the web developer when a piece on the board is APPROVED; never publish, push or log in to a CMS yourself."
---
# Put approved content on the site

## Before
1. Read `docs/SITE.md` (how the site is managed: WordPress, another CMS, or code in a repository; its URL; the repository and its base branch). If it is missing or unclear, ask the lead; do not guess.
2. Take only pieces whose row on `docs/BOARD.md` is **APPROVED** by the owner. A DRAFT or REVIEW piece is not yours yet.
3. Read the approved draft in `content/drafts/`, its brief in `docs/seo/briefs/` and `docs/BRAND.md`.

## Code in a repository
1. Learn the site first: framework (Next.js, Astro, Hugo, Nuxt, plain HTML, ...), where pages or posts live, how front matter, images and the sitemap work. Copy the pattern of an existing page of the same kind; add no dependency.
2. Work in the linked repository on your own branch from the base branch in `docs/SITE.md` (`<your-id>/content-<slug>`); never commit to the base branch.
3. Build the page: the approved text unchanged, title (60 characters or less), meta description (160 or less), one H1, the slug from the brief, canonical, schema (Article or FAQPage as the brief says), image alt texts, internal links from the brief, and the page in the sitemap and navigation when the site lists it there.
4. Run the site's build or lint when it has one; fix what you broke. Commit with Conventional Commits (`feat(content): <slug>`). Never push and never deploy.

## WordPress or another CMS
You do not log in to the CMS. Write `content/ready/<slug>/` for the owner to paste:
- `page.html`: the body as clean HTML (WordPress: block-editor friendly, no inline styles);
- `seo.md`: title, slug, meta description, focus keyword, category and tags, featured image, alt texts, canonical, schema JSON-LD, internal links to add on other pages.

## Hand off
Write `docs/handoffs/<date>-<slug>.md`: what changed, the branch and commit (code) or the `content/ready/` folder (CMS), how to preview, the checklist, and the steps left for the owner (push and merge, or paste and publish). Set the piece to **REVIEW** for the SEO check (the technical SEO specialist or the SEO specialist of the squad), and tell the lead.

## Rules
- Never change the approved wording; a needed change goes back to the lead.
- Never push, merge, deploy, publish or submit to IndexNow: the owner does that.
- No secret in the repository, a handoff or a message.
