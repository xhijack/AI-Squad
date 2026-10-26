// SPDX-License-Identifier: Apache-2.0
// The agent's portrait in the conversation view: the same chibi as in the office (look, colours, a desk toy),
// in its own small WebGL canvas. Idle breathing and blinking, a simple talking animation while a message appears;
// with reduced motion it is drawn once and stays still. dispose() frees the canvas when the dialog closes.
import * as THREE from 'three';
import { buildChibi, resetPose, arms } from './chibi.js';
import { lookFor } from './scene.js';
import { propsFor, TOYS } from './props.js';

export function createPortrait(canvas, agent, { reducedMotion = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#d9cfc0', 1.6));
  const sun = new THREE.DirectionalLight('#ffffff', 1.4); sun.position.set(1.5, 3, 2.5); scene.add(sun);
  const camera = new THREE.PerspectiveCamera(28, 1, .1, 20);
  camera.position.set(.2, 1.05, 3.6); camera.lookAt(0, .78, 0);           // head to knees, a little from the side
  const R = buildChibi(lookFor(agent.appearance || {}));
  R.root.rotation.y = -.25;
  scene.add(R.root);
  // one of the agent's desk toys on a small stand beside it
  const toy = propsFor(agent).props[0];
  if (toy && TOYS[toy]) {
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(.16, .18, .5, 24), new THREE.MeshToonMaterial({ color: '#efe6d8' }));
    stand.position.set(.5, .25, .1); scene.add(stand);
    const t = new THREE.Group(); t.position.set(.5, .5, .1); t.scale.setScalar(1.8); TOYS[toy](t); scene.add(t);
  }
  const st = { rig: R, blinkAt: 0 };
  let talkUntil = 0, raf = 0, disposed = false, level = 0;
  const size = () => {
    const w = canvas.clientWidth || 200, h = canvas.clientHeight || 240;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    // fit about 1.7 units across (the character and its toy) in narrow canvases, head to knees in wide ones
    const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = Math.max(2.9, .62 / (half * camera.aspect));
    camera.position.set(.2 * dist / 3.6, 1.1, dist); camera.lookAt(.08, .85, 0);
    camera.updateProjectionMatrix();
  };
  const pose = (t) => {
    resetPose(R);
    R.hips.position.y += Math.sin(t * 1.8) * .006;                  // breathing
    R.torso.rotation.x = Math.sin(t * 1.8) * .015;
    arms(R, [-.15, .2, -.35], [-.15, -.2, -.35]);
    if (t > st.blinkAt) st.blinkAt = t + 2.5 + Math.random() * 3;
    const blink = st.blinkAt - t < .12 ? .12 : 1;
    for (const e of R.eyes) e.scale.y = blink;
    const talking = performance.now() < talkUntil || level > .02;
    R.mouth.scale.set(1, level > .02 ? .6 + level * 2.2 : talking ? .6 + Math.abs(Math.sin(t * 14)) * 1.4 : 1, 1);
    R.head.rotation.set(talking ? Math.sin(t * 6) * .05 : 0, Math.sin(t * .5) * .08, talking ? Math.sin(t * 3.1) * .04 : 0);
    if (talking) arms(R, null, [-.55 - Math.sin(t * 4) * .15, -.35, -1.1]);   // a small gesture while talking
  };
  const frame = (ms) => {
    if (disposed) return;
    pose(ms / 1000);
    renderer.render(scene, camera);
    if (!reducedMotion) raf = requestAnimationFrame(frame);
  };
  size();
  frame(performance.now());
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { size(); if (reducedMotion) frame(performance.now()); }) : null;
  ro?.observe(canvas);
  return {
    talk(ms) { if (!reducedMotion) talkUntil = performance.now() + ms; },
    setLevel(v) { level = reducedMotion ? 0 : v; },                       // the voice's amplitude moves the mouth
    dispose() {
      disposed = true; cancelAnimationFrame(raf); ro?.disconnect();
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });      // materials are shared with the office (cached): keep them
      renderer.dispose(); renderer.forceContextLoss();
    },
  };
}
