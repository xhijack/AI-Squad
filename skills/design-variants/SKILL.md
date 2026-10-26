---
name: design-variants
description: "When the owner gives only a mockup or a vague wish for a screen, make 3-4 clearly different variants as static HTML files, let the owner compare them side by side in The AI Squad and pick one, then follow the taste note written into docs/DESIGN.md. Use as the UI/UX designer before building a screen whose look is not decided."
---
# Design variants

Showing beats asking. Four quick drafts settle a taste question faster than a long interview.

## When
- The owner gave a rough mockup, a reference ("like Airbnb but warmer"), or only words, and DESIGN.md does not decide the look of this screen.
- Not for screens the fidelity map in DESIGN.md already fixes: follow those.

## Make the variants: docs/design/variants/<screen>/
- `<screen>` is a short kebab-case name (`rsvp`, `guest-list`).
- `README.md`: one heading and **one question** for the owner (for example "Which layout fits a wedding with 300 guests?").
- 3 or 4 files `variant-a.html` … `variant-d.html`, each **one self-contained static page**: inline CSS only, no scripts, no external fonts, images or links (the preview runs sandboxed and loads nothing from outside). Give each a `<title>` that names its idea ("Cards", "Compact list", "Timeline").
- Make them **really different** in one or two big decisions (layout, density, colour mood, type scale), not four shades of the same page. Use the real content of the screen from the PRD (sample names, real labels), mobile-first at 390 px with a desktop breakpoint.
- Tell the lead the variants are ready; the owner sees them under Attention ("Pick a design") and in the Floor menu (Design variants).

## After the pick
- The AI Squad writes `CHOSEN` in the folder and a dated line under `## Taste notes` in `docs/DESIGN.md` (what was picked over what, and why when the owner said so).
- Build the screen from the chosen variant, and read the taste notes before every later design round: they are the owner's taste, not a one-off.

## Never
- Pick for the owner, also under Autopilot: choosing between design variants is the owner's taste.
- Put real personal data or secrets in a variant.
