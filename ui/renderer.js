// SPDX-License-Identifier: Apache-2.0
// Which renderer draws the Building (0.16): three.js (3D, everything: first person, live screens, Edit Mode) or
// Iso Pixel (Canvas 2D, light). The host looks like one scene to the rest of the UI: it remembers what the page
// last told it (Floors, view, insets, theme) and replays that into a renderer it switches to. The renderer not in
// use is disposed, so its memory (and the WebGL context) is given back.
//   Auto: Iso on phones, on devices with 4 GB or less, or with more than 12 agents; three.js otherwise.
//   The first person, screen and follow views and Edit Mode always use three.js.
// The Lobby has three overviews (0.17): the Building (stacked Floors), the Office (one floor plan for the whole
// company; in 3D too since 1.1.0) and the List (plain DOM, the default on phones). The Building and the Office follow
// the chosen renderer; on Auto the 3D Office falls back to Iso Pixel on this browser once it cannot hold ~30 fps.
import { BuildingScene } from './scene.js';
import { IsoScene } from './iso.js';
import { ListScene } from './list.js';
import { autoRenderer as auto } from './scene-model.js';

export const RENDERERS = ['auto', 'three', 'iso'];
const KEY = 'aisquad.renderer';
export const savedRenderer = () => { try { const r = localStorage.getItem(KEY); return RENDERERS.includes(r) ? r : 'auto'; } catch { return 'auto'; } };
const isPhone = () => matchMedia('(max-width: 760px)').matches;
const SLOW_KEY = 'aisquad.office3dSlow';
const officeSlow = () => { try { return localStorage.getItem(SLOW_KEY) === '1'; } catch { return false; } };
export const autoRenderer = ({ agents = 0 } = {}) => auto({ agents, phone: isPhone(), memory: navigator.deviceMemory || 8 });

export function createSceneHost(container, handlers) {
  // the 3D Office measured too slow on Auto: Iso Pixel from now on in this browser (choosing 3D still gets 3D)
  handlers = { ...handlers, onOfficeSlow: () => { try { localStorage.setItem(SLOW_KEY, '1'); } catch { /* private mode */ } if (host.chosen === 'auto') setTimeout(() => host.use(host.want()), 0); } };   // not inside the renderer's own frame
  const host = {
    chosen: savedRenderer(),
    kind: null, impl: null, last: {},
    // what the page wants now: the route and Edit Mode decide when only three.js can do it
    overview: null,
    want(route = host.last.view || {}, editing = false, overview = host.overview) {
      if (editing || route.eyes || route.screen || route.follow) return 'three';
      if (route.mode === 'lobby' && overview === 'list') return 'list';
      if (host.chosen !== 'auto') return host.chosen;
      const agents = (host.last.floors || []).reduce((n, f) => n + (f.agents?.length || 0), 0);
      if (route.mode === 'lobby' && overview === 'office' && officeSlow()) return 'iso';
      return autoRenderer({ agents });
    },
    route(route, editing, overview) { host.overview = overview; host.use(host.want(route, editing, overview)); },
    choose(kind) {
      host.chosen = RENDERERS.includes(kind) ? kind : 'auto';
      try { localStorage.setItem(KEY, host.chosen); } catch { /* private mode */ }
      host.use(host.want());
      return host.chosen;
    },
    use(kind) {
      if (host.kind === kind && host.impl) return host.impl;
      host.impl?.dispose?.();
      host.kind = kind;
      host.impl = kind === 'iso' ? new IsoScene(container, handlers) : kind === 'list' ? new ListScene(container, handlers) : new BuildingScene(container, handlers);
      const l = host.last;
      if (l.theme) host.impl.setTheme(...l.theme);
      if (l.insets) host.impl.setInsets(l.insets);
      if (l.floors) host.impl.sync(l.floors);
      if (l.company) host.impl.setCompany?.(l.company);
      if (l.view) host.impl.setView(l.view);
      host.impl._viewKey = null;
      return host.impl;
    },
    sync(floors) { host.last.floors = floors; host.impl.sync(floors); },
    setView(view) { host.last.view = view; host.impl.setView(view); },
    setInsets(insets) { host.last.insets = insets; host.impl.setInsets(insets); },
    setTheme(...a) { host.last.theme = a; host.impl.setTheme(...a); },
    setCompany(c) { host.last.company = c; host.impl.setCompany?.(c); },
  };
  host.use(host.want());
  // everything else goes to the renderer in use (Edit Mode reaches three.js internals this way)
  return new Proxy(host, {
    get(t, p) { if (p in t) return t[p]; const v = t.impl?.[p]; return typeof v === 'function' ? v.bind(t.impl) : v; },
    set(t, p, v) { if (p in t) t[p] = v; else if (t.impl) t.impl[p] = v; return true; },
  });
}
