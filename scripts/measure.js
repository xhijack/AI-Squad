#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Browser-side cost of a page, measured in headless Chrome over a window of seconds after it settles:
// frames rendered per second (an idle Floor should render none), JS ms per frame, draw calls, triangles, textures,
// geometries, shader programs, JS heap, polls (JSON bytes, fetch ms, DOM + scene ms). Read only: it loads the page,
// wraps the scene's frame() to count, and reads counters (ui/scene.js stats, ui/app.js ctx.stats); it clicks nothing.
//   node scripts/measure.js <url> [settle seconds = 15] [window seconds = 20] [renderer = page default | three | iso]
//   MEASURE_STORAGE='{"aisquad.overview":"office","aisquad.quality":"low"}'   localStorage keys set before loading
//   MEASURE_MOVE=1   pans the camera a little every display frame during the window (frame cost under motion)
// Note: headless Chrome draws with SwiftShader (the CPU), so ms per frame here is far above a real GPU; frames per
// second idle, draw calls, triangles and payloads are what compare across changes.
import { openChrome, sleep } from './chrome.js';

const [url, settle = 15, span = 20, renderer = ''] = process.argv.slice(2);
if (!url) { console.error('usage: measure.js <url> [settle s] [window s]'); process.exit(1); }
const c = await openChrome();
await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const storage = { ...(renderer ? { 'aisquad.renderer': renderer } : {}), ...JSON.parse(process.env.MEASURE_STORAGE || '{}') };
if (Object.keys(storage).length) {
  await c.send('Page.navigate', { url: new URL('/', url).href }); await sleep(800);
  for (const [k, v] of Object.entries(storage)) await c.evaluate(`localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)})`);
  await c.send('Page.navigate', { url: 'about:blank' }); await sleep(200);
}
await c.send('Page.navigate', { url });
await sleep(settle * 1000);
// count frames by wrapping the scene's frame() (works on builds without ui/scene.js stats too)
// and every pass of a frame in renderer.info (three resets it per render call; the composer makes several);
// display ticks (requestAnimationFrame callbacks) show how often the loop could have drawn
await c.evaluate(`(() => { const s = window.aisquad?.scene; if (!s || s.__measured || s.kind === 'iso') return; const m = s.__measured = { frames: 0, ms: 0, ticks: 0, calls: 0, triangles: 0 }; const f = s.frame.bind(s), i = s.renderer.info;
  i.autoReset = false;
  s.frame = (...a) => { const before = i.render.frame; i.reset(); const t = performance.now(); f(...a); if (i.render.frame !== before || a[0] !== false) { m.frames++; m.ms += performance.now() - t; m.calls = i.render.calls || m.calls; m.triangles = i.render.triangles || m.triangles; } };
  const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => raf((x) => { m.ticks++; cb(x); }); })()`);
const snap = () => c.evaluate(`(() => {
  const s = window.aisquad?.scene, i = s?.renderer?.info, st = window.aisquad?.stats || {};
  const api = performance.getEntriesByType('resource').filter((e) => e.name.includes('/api/'));
  return { frames: (s?.stats && 'frames' in s.stats ? s.stats.frames : s?.__measured?.frames) || 0, ms: (s?.stats && 'ms' in s.stats ? s.stats.ms : s?.__measured?.ms) || 0, ticks: s?.__measured?.ticks || 0, screens: s?.stats?.screens || 0, polls: st.polls || 0, fetchMs: st.fetchMs || 0, renderMs: st.renderMs || 0,
    calls: s?.__measured?.calls, triangles: s?.__measured?.triangles, textures: i?.memory.textures, geometries: i?.memory.geometries, programs: i?.programs?.length,
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 2 ** 20).toFixed(1) : null,
    apiBytes: api.reduce((n, e) => n + (e.encodedBodySize || 0), 0), apiCount: api.length, dpr: s?.renderer?.getPixelRatio() ?? s?.dpr, quality: s?.kind === 'iso' ? 'iso' : s?.quality.active };
})()`);
const a = await snap();
if (process.env.MEASURE_MOVE) await c.evaluate(`(() => { const s = window.aisquad?.scene; if (!s?.controls) return; let k = 0; const step = () => { if (k++ > 1e5) return; s.controls.target.x += Math.sin(k / 30) * .01; s.camera.position.x += Math.sin(k / 30) * .01; requestAnimationFrame(step); }; requestAnimationFrame(step); })()`);
await sleep(span * 1000);
const b = await snap();
const d = (k) => b[k] - a[k];
const out = {
  url, window_s: +span,
  fps_rendered: +(d('frames') / span).toFixed(2), rendered_per_tick: d('ticks') ? +(d('frames') / d('ticks')).toFixed(2) : 0, js_ms_per_frame: d('frames') ? +(d('ms') / d('frames')).toFixed(1) : 0,
  screen_redraws_per_s: +(d('screens') / span).toFixed(2),
  draw_calls: b.calls, triangles: b.triangles, textures: b.textures, geometries: b.geometries, programs: b.programs, heap_mb: b.heapMB, dpr: b.dpr, quality: b.quality,
  polls_per_min: +(d('polls') / span * 60).toFixed(1), api_kb_per_poll: d('apiCount') ? +(d('apiBytes') / d('apiCount') / 1024).toFixed(1) : 0,
  fetch_ms_per_poll: d('polls') ? +(d('fetchMs') / d('polls')).toFixed(1) : 0, dom_scene_ms_per_poll: d('polls') ? +(d('renderMs') / d('polls')).toFixed(1) : 0,
};
console.log(JSON.stringify(out));
if (c.logs.length) console.error('Page errors:\n' + [...new Set(c.logs)].join('\n'));
await c.close();
process.exit(0);
