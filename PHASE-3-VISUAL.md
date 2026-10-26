# Phase 3 brief: "soft 3D" office with KayKit assets and real collisions

Product owner, 26 Oct 2026: the 3D should look as smooth and polished as virtual-workspace shots
on Dribbble (e.g. "Roomeet Virtual Workspace"). Decisions: **stylized soft 3D, not realistic**;
asset style **KayKit** (Kay Lousberg, CC0); and **no character may ever pass through anything**
("make it real").

Order: finish the conversation view you are on, then Phase 3 (0.6.x), then continue Phase 2.5
parts 0.5.2 to 0.5.4 on top of the new office (the meeting table and walking to it must use
the Phase 3 navigation). Same rules as always: English, zero runtime dependencies, tests per
module one at a time, frugal memory (no Chrome, Blender or model runs while swap > 80 %),
one commit per step, no AI attribution, never push, do not restart the owner's service on 8097
or touch live agent sockets.

## A. Rendering quality without new assets (0.6.0)

- Lighting: an HDRI environment (Poly Haven, CC0, small 1k file vendored) for image-based
  light; warm key light + soft fill; tone mapping (ACES or AgX) and correct sRGB output.
- Shadows: soft shadows (PCFSoft or VSM) tuned to the camera frustum, contact shadows under
  furniture and characters.
- Ambient occlusion: SSAO / N8AO-style pass from three.js examples (vendored, no CDN).
- Gentle colour grading, subtle vignette, anti-aliasing (SMAA / FXAA) on High.
- **Quality setting** Low / High / Auto (Auto measures frame time for a few seconds and drops
  effects when the frame rate is low). Low = today's cost.
- Smooth motion: eased camera transitions, damped orbit, characters turning smoothly, a stable
  frame loop that sleeps when nothing moves (battery and CPU friendly).

## B. KayKit asset pack (0.6.1)

- Source: KayKit packs (furniture, office / interior, props, characters if they fit) from the
  official KayKit releases. Verify the CC0 licence of every pack you use and record it.
- `ASSETS.md`: every file, its pack, source URL, licence, and any change made. The repo holds
  only CC0 (or CC-BY with attribution added to `NOTICE`). Paid assets never go in the repo.
- Pipeline: glTF/GLB, merged where possible, compressed with meshopt and KTX2/WebP textures
  (vendored decoders), a shared texture atlas, total download for one Floor under ~3 MB.
- Map every device type (desk, chair, laptop, dual monitor, whiteboard, plant, sofa, TV,
  beanbags, ping-pong, pantry, server rack, printer, meeting table, shelves, rug, lamps) to a
  KayKit model; keep the procedural ones as fallback. Edit Mode, layout presets, props per role
  and the brand wall keep working.
- Characters: keep our chibi look (identity of the product) but align proportions, materials
  and outline with the KayKit style so they belong in the same world. If a KayKit character pack
  fits better, propose it with screenshots first.
- Optional baked lighting: install Blender as a portable tarball in the user's home (no sudo),
  bake lightmaps / AO for the static room per layout preset with a headless Python script,
  ship the baked textures. Skip if it costs too much disk or memory; A must look good without it.

## C. Real collisions (0.6.2), "nothing passes through anything"

- **Navigation grid / navmesh** built from the Floor layout: every desk, chair, device and wall
  is an obstacle with its real footprint (from the model's bounding box, rotated), inflated by
  the character radius. Rebuilt when Edit Mode changes the layout.
- **Path finding** (A* on the grid, then path smoothing / string pulling) for every walk: desk
  to lounge, to the meeting table, to the pantry and back. No straight-line walking through
  objects ever.
- **Character avoidance**: characters never overlap each other (separation steering, waiting or
  re-routing in narrow passages; two characters cannot sit on one seat).
- **Seats and spots**: chairs, sofa places, beanbags and meeting seats are reserved slots with
  an approach point and a facing direction; sitting aligns hips to the seat, no clipping into
  the desk.
- **Edit Mode**: placing a desk or device where it overlaps another object or blocks every path
  to a desk is refused (red ghost) with a hint.
- **Cameras**: the first person view and the follow camera never go through walls or furniture
  (collide and push in); name tags never draw inside geometry.
- Tests: unit tests for the grid (footprints, rotation, inflation), A* (unreachable, narrow
  gaps), avoidance (two agents crossing), seat reservation, Edit Mode refusal. A debug overlay
  (`?nav=1`) shows the grid, obstacles and current paths.

## Acceptance

- Screenshots at 1440 and 390 of the Lobby, a Squad Sprint Floor (agents working and idle in
  the lounge), Floor 1, the Desk, first person, before/after next to the reference shots in
  `playground/reference/`. A short frame-time measurement on Low and High.
- A soak test: 8 agents walking for 10 simulated minutes with zero overlaps with obstacles or
  each other (checked by the test, not by eye).
- `ASSETS.md`, README "Graphics quality", PROGRESS Phase 3 section, versions 0.6.0 / 0.6.1 /
  0.6.2.
