# Phase 3.2 brief: realistic desk, chair, laptop and character (proof of concept first)

Product owner, 26 Oct 2026, after seeing 0.6.x: **"The 3D design is not what I expected, it is
not realistic."** KayKit reads as cartoon toys. The owner wants **the desk, chair, laptop and the
characters close to realistic.** Do this right after the reply 404 fix. Same rules as always
(English, zero runtime dependencies, frugal memory: no Chrome, Blender or model runs while
swap > 80 %, one commit per step, no AI attribution, never push, do not restart 8097 or touch
live agent sockets).

## Step 1: proof of concept only (0.8.0-poc, not the default look yet)

A separate scene `?look=realistic` (the current look stays the default) with ONE desk corner:

- **Desk, office chair, laptop, monitor, desk lamp, mug, keyboard, mouse** that look real:
  physically based materials (wood grain, fabric, brushed metal, plastic, glass screen), real
  proportions in metres, bevelled edges, no toy colours.
- **One realistic human character** sitting on the chair and typing, then standing up and
  walking a few steps and sitting back down: realistic proportions, skin, hair and clothes,
  natural idle motion (breathing, small head movements), no chibi.
- **Lighting**: HDRI image-based light + baked lighting / ambient occlusion for the static
  furniture (Blender Cycles, run headless from a portable Blender in the user's home, no sudo),
  soft shadows, contact shadows under the chair and the character, filmic/AgX tone mapping.
- Camera: the normal isometric-like view and a closer 3/4 view of the desk.

## Asset sources (licence first)

- Furniture, props and textures: **Poly Haven** and **ambientCG** (CC0) first. If a needed
  object (e.g. a laptop or an office chair) is not available in CC0, a **CC-BY** model is allowed
  with the attribution added to `NOTICE` and `ASSETS.md`. Never paid or "editorial only" assets.
- Characters: **Microsoft Rocketbox** avatars (MIT; check the licence file and keep it). Pick a
  few varied business-casual avatars.
- Animations: CC0 humanoid animation libraries (e.g. Quaternius' universal animation library)
  retargeted to the Rocketbox skeleton, or animations that ship with Rocketbox. Do not ship
  Mixamo files in the repo.
- Record every file in `ASSETS.md` with source URL, licence and changes.

## Performance budget

- glTF/GLB with meshopt, KTX2 textures at 1k (2k only for the hero desk on High), LODs for
  characters, total for the PoC scene under ~15 MB, 60 fps on a mid laptop on High, Low mode
  drops AO/shadows quality.

## Deliverable of step 1

- Screenshots at 1440 x 900: wide view and close 3/4 view, plus the same framing of today's
  look side by side, saved in `playground/reference/realistic-poc-*.png`.
- A short note in `PROGRESS.md`: sources, licences, sizes, frame time, what it would take to do
  the whole office and all agents.
- **Stop after step 1** and wait: the owner judges the screenshots before anything else changes.

## Step 2 (only after the owner approves)

Replace every Floor's furniture and all characters with the realistic set, keep navigation,
collisions, seats, Edit Mode, props per role, first person, conversation portraits and voices
working; agent identity via clothing colour, hair and a name tag instead of chibi styles.
