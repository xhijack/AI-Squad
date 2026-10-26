// SPDX-License-Identifier: Apache-2.0
// Rendering quality ("soft 3D", Phase 3): image-based light from a small studio HDRI, ambient occlusion (GTAO),
// gentle colour grading with a vignette, SMAA, and soft contact shadows under the characters. Quality Low renders
// like before (one pass); High adds the effects; Auto starts on High and drops to Low (and stays there) as soon as
// back-to-back frames are slow. The pixel ratio is capped: 1.5 on High, 1 on Low.
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

export const QUALITIES = ['auto', 'high', 'low'];
const KEY = 'aisquad.quality';
export const savedQuality = () => { try { const q = localStorage.getItem(KEY); return QUALITIES.includes(q) ? q : 'auto'; } catch { return 'auto'; } };
const saveQuality = (q) => { try { localStorage.setItem(KEY, q); } catch { /* private mode */ } };

// warm grading, a touch of contrast and saturation, and a soft vignette (runs after tone mapping, in sRGB)
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, warmth: { value: .02 }, contrast: { value: 1.08 }, saturation: { value: 1.08 }, vignette: { value: .18 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float warmth, contrast, saturation, vignette; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb + vec3(warmth, warmth * .4, -warmth * .6);
      col = (col - .5) * contrast + .5;
      float l = dot(col, vec3(.2126, .7152, .0722));
      col = mix(vec3(l), col, saturation);
      vec2 d = vUv - .5;
      col *= 1. - vignette * smoothstep(.35, .85, length(d * vec2(1.15, 1.)));
      gl_FragColor = vec4(clamp(col, 0., 1.), c.a);
    }`,
};

// a soft round shadow under each character (cheap "contact shadow"), shared texture
let blobTex = null;
export function contactShadow(radius = .42, opacity = .32) {
  if (!blobTex) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grd.addColorStop(0, 'rgba(40,28,18,1)'); grd.addColorStop(.55, 'rgba(40,28,18,.45)'); grd.addColorStop(1, 'rgba(40,28,18,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    blobTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, opacity, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = .012; m.renderOrder = 1; m.userData.contact = true;
  return m;
}

// GTAOPass of three 0.160 never sets its camera type define; the main camera here is orthographic
function setCameraDefine(pass, cam) {
  const v = cam.isPerspectiveCamera ? 1 : 0;
  for (const m of [pass.gtaoMaterial, pass.pdMaterial, pass.depthRenderMaterial]) {
    if (m?.defines && m.defines.PERSPECTIVE_CAMERA !== v) { m.defines.PERSPECTIVE_CAMERA = v; m.needsUpdate = true; }
  }
}

export class Quality {
  // renderer, scene; hemi: the hemisphere light (dimmed when the environment lights the room)
  // exposure: tone mapping exposure per level (the realistic look uses AgX, which needs more)
  constructor(renderer, scene, { hemi = null, hdri = './assets/hdri/studio_small_09_1k.hdr', exposure = { high: .8, low: 1.05 } } = {}) {
    Object.assign(this, { renderer, scene, hemi, hdri, exposure, chosen: savedQuality(), active: null, composer: null, env: null, frames: [], size: { w: 1, h: 1 } });
    this.apply(this.chosen === 'low' ? 'low' : 'high');
  }
  set(q) { if (!QUALITIES.includes(q)) return; this.chosen = q; saveQuality(q); this.frames = []; this.apply(q === 'low' ? 'low' : 'high'); }
  apply(level) {
    if (this.active === level) return;
    this.active = level;
    const high = level === 'high';
    if (high && !this.env) this.loadEnv();
    this.scene.environment = high ? this.env : null;
    if (this.hemi) this.hemi.intensity = high && this.env ? .35 : 1.15;
    this.renderer.toneMappingExposure = high ? this.exposure.high : this.exposure.low;
    this.renderer.setPixelRatio(Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, high ? 1.5 : 1));
    if (!high) { this.composer?.dispose(); this.composer = null; }
    else this.buildComposer();
    this.renderer.shadowMap.needsUpdate = true;
  }
  loadEnv() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    new RGBELoader().load(this.hdri, (hdr) => {
      if (this.disposed) { hdr.dispose(); pmrem.dispose(); return; }        // the scene was switched away meanwhile
      this.env = pmrem.fromEquirectangular(hdr).texture;
      hdr.dispose(); pmrem.dispose();
      if (this.active === 'high') { this.scene.environment = this.env; if (this.hemi) this.hemi.intensity = .35; }
    }, undefined, () => { /* offline without the file: the lights alone */ });
  }
  buildComposer() {
    const { w, h } = this.size, pr = this.renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType });
    const c = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this.scene, null);
    this.ao = new GTAOPass(this.scene, new THREE.PerspectiveCamera(), w, h);
    this.ao.updateGtaoMaterial({ radius: .9, distanceExponent: 1.6, thickness: 1.6, scale: 1.4, samples: 12 });
    this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    this.ao.blendIntensity = 1;
    this.ao.enabled = this.aoOn !== false;
    c.addPass(this.renderPass); c.addPass(this.ao);
    c.addPass(new OutputPass());                                       // tone mapping and sRGB
    c.addPass(new ShaderPass(GradeShader));
    c.addPass(new SMAAPass(w * pr, h * pr));
    c.setSize(w, h);
    this.composer = c;
  }
  // ambient occlusion on or off (off in the Lobby, where Floors are small: one scene pass less)
  setAO(on) { this.aoOn = on; if (this.ao) this.ao.enabled = on; }
  resize(w, h) { this.size = { w, h }; this.composer?.setSize(w, h); }
  // one frame with the camera in use
  render(camera, dt) {
    if (!this.composer) { this.renderer.render(this.scene, camera); return; }
    if (this.renderPass.camera !== camera) { this.renderPass.camera = camera; this.ao.camera = camera; setCameraDefine(this.ao, camera); }
    this.composer.render(dt);
  }
  // Auto: the time between two back-to-back frames (seconds); 30 samples after 10 warm-up frames decide
  sample(sec) {
    if (this.chosen !== 'auto' || this.active !== 'high' || !(sec > 0)) return;
    this.frames.push(sec);
    if (this.frames.length < 40) return;
    const avg = this.frames.slice(10).reduce((a, b) => a + b, 0) / (this.frames.length - 10);
    if (avg > 1 / 40) this.apply('low');                                 // under 40 fps on High: drop the effects for good
    this.frames = [];
  }
}

// Contact shadows (like three's webgl_shadow_contact example): the objects above a floor patch are rendered from
// below into a depth-darkness texture, blurred twice and laid on the floor. Soft and grounded where the shadow map
// is too coarse (chair casters, feet). Re-render each frame only when something moves.
const BlurShader = {
  uniforms: { tDiffuse: { value: null }, dir: { value: new THREE.Vector2() } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 dir; varying vec2 vUv;
    void main() {
      vec4 s = texture2D(tDiffuse, vUv) * .2270270270;
      s += (texture2D(tDiffuse, vUv + dir * 1.3846153846) + texture2D(tDiffuse, vUv - dir * 1.3846153846)) * .3162162162;
      s += (texture2D(tDiffuse, vUv + dir * 3.2307692308) + texture2D(tDiffuse, vUv - dir * 3.2307692308)) * .0702702703;
      gl_FragColor = s;
    }`,
};
export class ContactShadows {
  constructor({ width = 4, depth = 4, res = 512, height = 1.2, darkness = 1.6, blur = 1.6, opacity = .8 } = {}) {
    const rt = () => { const t = new THREE.WebGLRenderTarget(res, res); t.texture.generateMipmaps = false; return t; };
    Object.assign(this, { rt: rt(), rt2: rt(), blur, res });
    this.group = new THREE.Group(); this.group.position.y = .003;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, depth).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ map: this.rt.texture, transparent: true, opacity, depthWrite: false }));
    plane.scale.y = -1; plane.renderOrder = 1; plane.userData.contact = true;
    this.group.add(plane);
    this.cam = new THREE.OrthographicCamera(-width / 2, width / 2, depth / 2, -depth / 2, 0, height);
    this.cam.rotation.x = Math.PI / 2; this.group.add(this.cam);
    this.depthMat = new THREE.MeshDepthMaterial();
    this.depthMat.userData.darkness = { value: darkness };
    this.depthMat.onBeforeCompile = (sh) => {
      sh.uniforms.darkness = this.depthMat.userData.darkness;
      sh.fragmentShader = `uniform float darkness;\n${sh.fragmentShader.replace('gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );', 'gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * darkness );')}`;
    };
    this.depthMat.depthTest = this.depthMat.depthWrite = false;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ ...BlurShader, uniforms: THREE.UniformsUtils.clone(BlurShader.uniforms), depthTest: false }));
    this.quadScene = new THREE.Scene(); this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  // hide: objects that must not cast (the floor, walls, the shadow plane itself)
  update(renderer, scene, hide = []) {
    const was = { bg: scene.background, ov: scene.overrideMaterial, rt: renderer.getRenderTarget(), clear: renderer.getClearAlpha() };
    const vis = hide.map((o) => o.visible); hide.forEach((o) => { o.visible = false; }); this.group.visible = false;
    scene.background = null; scene.overrideMaterial = this.depthMat;
    renderer.setRenderTarget(this.rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, this.cam);
    scene.overrideMaterial = was.ov; scene.background = was.bg;
    hide.forEach((o, i) => { o.visible = vis[i]; }); this.group.visible = true;
    const u = this.quad.material.uniforms;
    for (const [src, dst, d] of [[this.rt, this.rt2, [1, 0]], [this.rt2, this.rt, [0, 1]]]) {
      u.tDiffuse.value = src.texture; u.dir.value.set(d[0] * this.blur / this.res, d[1] * this.blur / this.res);
      renderer.setRenderTarget(dst); renderer.clear(); renderer.render(this.quadScene, this.quadCam);
    }
    renderer.setRenderTarget(was.rt); renderer.setClearAlpha(was.clear);
  }
}
