# three.js 0.160.0 (vendored)

Copied unchanged from the npm package `three@0.160.0`
(tarball sha512-DLU8lc0zNIPkM7rH5/e1Ks1Z8tWCGRq6g8mPowdDJpw1CFBJMU7UoJjC6PefXW7z//SSl0b2+GCw14LB+uDhng==,
checked against the registry before copying) so the UI works offline. MIT licence in `LICENSE`.

- `three.module.js` from `build/`
- `addons/` from `examples/jsm/` (only what the UI imports, with their own imports): controls, CSS2D labels, RoundedBox; since 0.6.0 also the post-processing passes (EffectComposer, RenderPass, GTAOPass, OutputPass, ShaderPass, SMAAPass and their shaders), RGBELoader, GLTFLoader with BufferGeometryUtils, and the meshopt decoder. The tarball hash above was checked again for these.
- Known upstream quirk kept as is: `GTAOPass` in 0.160 does not set its `PERSPECTIVE_CAMERA` define; `ui/render.js` sets it for the camera in use.
