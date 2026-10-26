// Rendering quality ("soft 3D", Phase 3): image-based light from a small studio HDRI, ambient occlusion (GTAO),
// gentle colour grading with a vignette, SMAA, and soft contact shadows under the characters. Quality Low renders
// like before (one pass); High adds the effects; Auto starts on High and drops to Low when frames are slow.
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
  constructor(renderer, scene, { hemi = null, hdri = './assets/hdri/studio_small_09_1k.hdr' } = {}) {
    Object.assign(this, { renderer, scene, hemi, hdri, chosen: savedQuality(), active: null, composer: null, env: null, frames: [], size: { w: 1, h: 1 } });
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
    this.renderer.toneMappingExposure = high ? .8 : 1.05;
    if (!high) { this.composer?.dispose(); this.composer = null; }
    else this.buildComposer();
  }
  loadEnv() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    new RGBELoader().load(this.hdri, (hdr) => {
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
    c.addPass(this.renderPass); c.addPass(this.ao);
    c.addPass(new OutputPass());                                       // tone mapping and sRGB
    c.addPass(new ShaderPass(GradeShader));
    c.addPass(new SMAAPass(w * pr, h * pr));
    c.setSize(w, h);
    this.composer = c;
  }
  resize(w, h) { this.size = { w, h }; this.composer?.setSize(w, h); }
  // one frame with the camera in use; keeps Auto honest by timing frames for a few seconds
  render(camera, dt) {
    if (!this.composer) { this.renderer.render(this.scene, camera); }
    else {
      if (this.renderPass.camera !== camera) { this.renderPass.camera = camera; this.ao.camera = camera; setCameraDefine(this.ao, camera); }
      this.composer.render(dt);
    }
    if (this.chosen === 'auto' && this.active === 'high' && dt > 0) {
      this.frames.push(dt);
      if (this.frames.length > 120) {
        const avg = this.frames.slice(30).reduce((a, b) => a + b, 0) / (this.frames.length - 30);
        if (avg > 1 / 40) this.apply('low');                           // under 40 fps on High: drop the effects
        this.frames = [];
      }
    }
  }
}
