# Phase 2.1 brief: visual quality to the level of squad-3d

Product owner, 25 Oct 2026, after installing Phase 2 on another machine: **"the result is
disappointing visually; compared with squad-3d it looks messy and the design is not as good."**
Features stay as they are. This phase is about how The AI Squad looks and feels.

Reference: `/home/erpnext/dtamu/squad-3d/index.html` (read, do not modify) and the screenshots in
`playground/reference/` (`dt-office.png` = the target quality; `ai-floor.png`, `ai-lobby.png` =
today). Do not commit these screenshots and do not copy any DTamu branding: the repo is open
source.

## What is wrong today (side-by-side at 1440x900)

| # | Today | Target (squad-3d) |
|---|---|---|
| V1 | Dark navy everywhere; the office reads as a dim box | Warm, light, cozy office: cream background, honey wood floor, light walls, soft shadows |
| V2 | Perspective camera far away; the room fills ~35% of the canvas and agents are tiny | **Isometric** orthographic camera that frames the Floor to fill the free canvas; agents are big and readable |
| V3 | Room is a flat empty box: no windows, no identity, sparse furniture | Two walls with windows, a **brand wall** with the Floor name + a short tagline (from `floor.json`), a whiteboard with sticky notes, plants, a lounge (sofa, TV, beanbags, rug, ping-pong table), a pantry counter |
| V4 | Three heavy dark panels (left team, right activity, top bar) leave the 3D in a narrow strip | **Floating cards** over the scene: a small status pill top-left (Floor name, sprint/progress, n active, warning chip), one collapsible panel on the right (Agents list, then tabs Activity / Messages). Everything else lives in dialogs from the dock |
| V5 | Text-heavy dock ("CPU 91 % RAM 54 % ... Performance  Voice off") | **Icon dock** centred at the bottom (board, performance, cost, server dot + worst metric, add agent, voice, legend), tooltips on hover |
| V6 | System sans font, many small pills and chips competing (model differs, opus, today $0.16 ...) | One UI font (Plus Jakarta Sans, vendored as woff2 with its OFL license in `ui/vendor/fonts/`, no CDN), mono only for logs. One status chip per agent; secondary facts go into the Desk panel |
| V7 | Name tags small and dark | Name chip in the agent's colour above the head, status bubble under it ("working", "waiting", "idle"), zzz when idle, as in squad-3d |
| V8 | Lobby: dark stacked boxes, labels overlap the floors | Lobby as a light **dollhouse cutaway** building: each Floor a warm mini office with its brand colour stripe, labels to the side of each floor with no overlap, Attention as one floating card |

## Requirements

1. **Theme tokens** in one place (`ui/style.css` `:root`), light theme as the default, matching
   the squad-3d palette (cream page `#efe9df`-ish, white cards, ink text, honey wood, accent per
   Floor). Keep a dark theme as an option (`prefers-color-scheme` + toggle), but the light theme
   is what we judge.
2. **Scene**: port the squad-3d room (walls, windows, brand wall, wood floor planks, lighting,
   shadows, plants, lounge, pantry, ping-pong) into the Floor scene so that every Floor, including
   Floor 1, looks like that office. Desk layout presets still apply; spacing like squad-3d.
3. **Camera**: orthographic isometric by default, auto-framed to the area not covered by the
   floating cards, smooth zoom/pan. First person and screen views stay as they are.
4. **Layout**: floating cards as described in V4 and V5. The left team panel goes away; its
   content moves to the right panel's agent list and to the Desk panel. Edit Mode, Settings and
   Performance stay reachable (dock or Floor menu).
5. **Phone (390 px)**: the scene on top, a bottom sheet for the agent list; the dock stays a
   single row of icons.
6. **Characters and props**: keep the chibi; make sure scale and name chips match squad-3d.
7. Keep every existing feature and test working. Update the screenshot tests.

## Acceptance

- Headless screenshots at 1440x900 and 390x844 of: Lobby, a Squad Sprint Floor with agents
  working and idle, Floor 1, Desk panel, Set up Squad step 1. Save them in
  `playground/reference/after-*.png` and compare each with `dt-office.png`. Iterate until a Floor
  at 1440 is at least as polished as `dt-office.png`. The owner judges it by eye.
- Review with the `design-critique` and `design-elevation` ideas in
  `/home/erpnext/dtamu/design-skills/` (read for ideas only), and fix every critical and medium
  finding before you finish.
- Run tests one module at a time and use at most one headless Chrome at a time.
- One Conventional Commit per step, no AI attribution, never push. Add a "Phase 2.1" section to
  `PROGRESS.md` when done.
