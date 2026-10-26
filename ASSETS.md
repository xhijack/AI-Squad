# Assets

Every file The AI Squad ships that it did not write itself: where it comes from, its licence, and what was changed.
The repository holds only CC0 assets (or CC-BY with the attribution in `NOTICE`). Paid assets never go in the repository.

| File | Source | Author | Licence | Changes |
|---|---|---|---|---|
| `ui/assets/hdri/studio_small_09_1k.hdr` | Poly Haven, "Studio Small 09", 1k HDR: https://polyhaven.com/a/studio_small_09 (downloaded from dl.polyhaven.org) | Sergej Majboroda | CC0 1.0 (all Poly Haven assets) | none |
| `ui/vendor/three/**` | npm `three@0.160.0` (see `ui/vendor/three/README.md`) | three.js authors | MIT | none |
| `ui/assets/kaykit/office.glb` (390 KB) | KayKit "Furniture Bits 1.0": https://github.com/KayKit-Game-Assets/KayKit-Furniture-Bits-1.0 (glTF folder): armchair_pillows, cabinet_medium_decorated, cactus_medium_A, cactus_small_A, chair_A, chair_C, couch_pillows, lamp_standing, pictureframe_large_A, rug_oval_A, rug_rectangle_stripes_A, shelf_B_large_decorated, table_low, table_medium, table_medium_long, table_small, and the atlas `furniturebits_texture.png` | Kay Lousberg (kaylousberg.com) | CC0 1.0 (`ui/assets/kaykit/LICENSE-furniture-bits.txt`) | packed into one GLB with `scripts/pack-glb.js`: one root node per model, textures embedded; geometry and textures unchanged |
| (same GLB) | KayKit "Restaurant Bits 1.0": https://github.com/KayKit-Game-Assets/KayKit-Restaurant-Bits-1.0 (glTF folder): fridge_A, kitchencabinet, kitchencounter_straight_A_decorated, and the atlas `restaurantbits_texture.png` | Kay Lousberg | CC0 1.0 (`ui/assets/kaykit/LICENSE-restaurant-bits.txt`) | as above |

Credit (not required by CC0): KayKit by Kay Lousberg, www.kaylousberg.com.

Not compressed with meshopt or KTX2: the two packs together are 390 KB (two 1024×1024 PNG atlases of 15 KB and about 40 KB, simple low-poly meshes), well under the 3 MB budget for one Floor, so the extra decoders were not worth it. `scripts/pack-glb.js` rebuilds the GLB from the source glTF files.

## Realistic look, proof of concept (Phase 3.2 step 1, `?look=realistic`)

Only CC0 and MIT here; no CC-BY model was needed. Sources were downloaded to `playground/assets-src/` (not in the repository) and converted with the scripts named below.

| File | Source | Author | Licence | Changes |
|---|---|---|---|---|
| `ui/assets/realistic/character.glb` (2.8 MB) | Microsoft Rocketbox, avatar `Assets/Avatars/Professions/Business_Male_04` (`Export/Business_Male_04.fbx`, `Textures/m015_*.tga`): https://github.com/microsoft/Microsoft-Rocketbox | Microsoft (Rocketbox Studios) | MIT (`ui/assets/realistic/LICENSE-rocketbox.txt`) | textures 2048 TGA to 1024 JPEG, specular turned into a roughness map (`scripts/rocketbox-textures.py`); FBX to GLB with three.js FBXLoader and GLTFExporter in headless Chrome (`scripts/convert-assets.js character`), centimetres to metres, materials to glTF PBR |
| (same GLB, animations) | Microsoft Rocketbox `Assets/Animations`: `all_animations_max_motextr_xy/m_walk_neutral`, `all_animations_max_motextr_xyz/m_sit_down_chair_01`, `m_sit_stand_up_chair_01`, `all_animations_max_motextr_static/m_sit_table_breathe_01`, `m_idle_breathe_01` | Microsoft (Rocketbox Studios) | MIT | named walk, sitDown, standUp, sit, idle; only bone rotations and the root position kept (the avatar keeps its own proportions), still tracks equal to the rest pose dropped, the walk made to play in place. No Mixamo files. |
| `ui/assets/realistic/desk-props.glb` (1.9 MB) | Poly Haven models, glTF 1k: `metal_office_desk` (Ulan Cabanilla), `desk_lamp_arm_01` (Kuutti Siitonen, rigging Yann Kervran), `potted_plant_04` (James Ray Cock), `office_notepads` (Ulan Cabanilla): https://polyhaven.com/models | as listed | CC0 1.0 (all Poly Haven assets) | packed into one GLB with `scripts/pack-glb.js`; the lamp, plant and notepad textures resized to 512; the lamp's orange diffuse turned to graphite grey; Poly Haven's `arm` texture also wired as the occlusion map (its red channel is baked ambient occlusion) |
| `ui/assets/realistic/textures/laminate_floor_02_*.jpg` | Poly Haven texture "Laminate Floor 02", 1k: https://polyhaven.com/a/laminate_floor_02 | Dario Barresi, Charlotte Baglioni | CC0 1.0 | re-saved JPEG quality 84 |
| `ui/assets/realistic/textures/beige_wall_001_*.jpg` | Poly Haven "Beige Wall 001": https://polyhaven.com/a/beige_wall_001 | Dimitrios Savva, Rico Cilliers | CC0 1.0 | 1k resized to 512 |
| `ui/assets/realistic/textures/poly_wool_herringbone_*.jpg` | Poly Haven "Poly Wool Herringbone" (chair fabric): https://polyhaven.com/a/poly_wool_herringbone | colormass, Rico Cilliers | CC0 1.0 | 1k resized to 512 |
| `ui/assets/realistic/textures/oak_veneer_01_*.jpg` | Poly Haven "Oak Veneer 01" (desktop): https://polyhaven.com/a/oak_veneer_01 | Jenelle van Heerden | CC0 1.0 | re-saved JPEG quality 84 |
| `scripts/vendor/three-jsm/**` (dev tool only, not shipped to the browser) | npm `three@0.160.0`, `examples/jsm`: FBXLoader, TGALoader, fflate, NURBS curves, GLTFExporter, TextureUtils (same tarball as `ui/vendor/three`, sha512 checked again) | three.js authors | MIT | none |

| `ui/assets/realistic/office-props.glb` (3.3 MB, step 1b: the office at `?look=realistic`) | Poly Haven models, glTF 1k: `potted_plant_02` (Rico Cilliers), `modern_wooden_cabinet` (Patrik Pangerl, the TV console): https://polyhaven.com/models | as listed | CC0 1.0 | packed with `scripts/pack-glb.js`, textures resized to 512, `arm` wired as occlusion; the cabinet's door animations dropped (it stays closed) |

Built in code, no asset file: the office chair, monitor, laptop, keyboard, mouse, mug and oak desk (`ui/realistic-props.js`), and for the office (step 1b, `ui/realistic-office.js`) the room, sofa, rug, beanbags, ping-pong table, floor lamp, whiteboard, server rack, pantry and meeting table, with the textures above and plain PBR materials. The polished chibis are the same procedural chibis (`ui/chibi.js`) with physical materials.

Step 1 (`?look=desk-poc`) uses the Rocketbox person; after the owner's correction (chibis stay, no human characters) `character.glb` is only used by that step 1 page and goes away if step 2 is approved.

Not done in this step: Blender Cycles baking (the download of a portable Blender was refused by the permission check in this session; the models' own baked AO maps, GTAO and contact shadows stand in), meshopt and KTX2 (gltfpack was refused the same way; the PoC is 5.7 MB without them).
