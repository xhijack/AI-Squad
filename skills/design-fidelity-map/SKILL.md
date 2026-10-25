---
name: design-fidelity-map
description: "Write the fidelity map in docs/DESIGN.md: for each screen and element, what must match the mockup exactly and what may be improved, with reasons. Use as designer when the owner gave mockups, before the developers build screens."
---
# Design fidelity map

When the owner gives mockups, developers need to know which details are fixed and which are suggestions.

## Steps
1. List every screen in the mockups and link it to the PRD stories (table in `docs/DESIGN.md`).
2. For each screen, go element by element (layout, navigation, typography, colour, copy, imagery, components, states):
   - **Must match:** brand-critical or explicitly requested (logo, colours, key layout, legal copy).
   - **May be improved:** things the mockup leaves open or gets wrong (spacing, accessibility contrast, missing states, responsive behaviour).
   - **Why**, in one line.
3. Fill the gaps the mockups do not show: empty, loading and error states, mobile layouts, focus states. Mark them as proposals.
4. Do not invent screens outside the PRD; propose them to the lead.
5. Ask the lead to get the owner's approval on the map; it is part of the Design document.
