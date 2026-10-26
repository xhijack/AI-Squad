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
