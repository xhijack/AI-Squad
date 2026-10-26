# Phase 3.3 brief: light, solid, roomy, realistic laptop, Indonesian UI

Product owner, 26 Oct 2026, honest feedback: "It feels heavy. Some characters still walk through
desks. The laptop is not realistic enough. The office is too cramped, make it wider. Add an
Indonesian language mode so I can switch the language." Build right after step 1b is reported
(the realistic look decision does not block these), in this order, one patch release per item.
Same rules as always.

## 1. Performance first (measure, then fix)

Server is light (5 % CPU, 200 MB, API ~0.1 s); the weight is in the browser. Measure on the
playground and the owner's Floor (frame time, draw calls, triangles, textures, JS time per poll,
DOM patch time, memory) and record before/after numbers in PROGRESS.
- Render on demand: no frame when nothing moves or changes (characters idle and seated, camera
  still); resume on animation, walking, hover, camera moves.
- Merge static furniture per Floor (merged geometry / InstancedMesh for repeated items), share
  materials and textures, remove per-part outline meshes (use one cheap outline method or none
  on High realistic look).
- Shadows: static shadow map rendered once per layout change; only characters cast dynamic
  shadows (or blob/contact shadows on Low).
- Cap devicePixelRatio (1.5 High, 1 Low), Auto quality picks Low on slow frames quickly and
  stays there; pause rendering in hidden tabs; lighter post-processing.
- Assets: lazy-load per Floor, KTX2/meshopt, LODs; Lobby uses simplified Floors.
- UI: poll payload diffs (ETag or since-version), patch only changed panels, slower polling
  when nothing changes.
Target: idle Floor near 0 % GPU, under 8 ms frame time on a mid laptop on High, smooth on Low.

## 2. Nothing walks through desks (bug)

Characters still pass through desks. Find why (footprints from the old models vs the new bigger
desks? seats' approach points inside the desk? paths computed before assets load? avoidance
sliding through obstacles?) and fix at the root: footprints from the actual loaded mesh bounds,
rebuild the grid after assets load and on layout changes, approach points outside the desk,
never slide into an obstacle. Extend the soak test with the realistic desks and with the exact
owner Floor layout; zero penetrations by geometry checks each step.

## 3. A realistic laptop

A real-looking laptop (CC0 first, CC-BY with attribution if needed): thin aluminium body,
rounded edges, keyboard keys, trackpad, hinge, glossy bezel with a live screen texture, correct
proportions on the desk. Same for the monitor stand if it still looks simple.

## 4. A wider office

More room: wider Floor, wider aisles (at least 2 character widths), more space between desks
and around the lounge and meeting table, layout presets scaled up, the camera auto-framing the
larger room. Keep Edit Mode and collisions working.

## 5. Indonesian UI language

Language switch (English / Bahasa Indonesia) in the menu and Settings, stored per browser; all UI
copy, dialogs, toasts, Attention cards, Autopilot notes and the CLI messages that the UI shows go
through one translation table (`ui/i18n/en.json`, `ui/i18n/id.json`). Indonesian copy: natural,
"kamu", no emoji. Code, file names, JSON keys and docs stay English (D5). Agent-written text is
shown as written. Tests: every key present in both languages.

## 6. Leftovers

- Floor 1 shows the same VS Code session twice: dedupe by session id / transcript.
- The Needs you popover and the side card both open on page load: show only one.
