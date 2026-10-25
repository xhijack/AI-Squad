// Floor geometry and desk layout presets (Rows, Pods, Circle, Open Space). Units are metres; the office spans
// x -8..8 and z -6.5..6.5. The isometric camera looks from +x +z, so the back wall (z -6.5) and the left wall
// (x -8) are the two walls you see; the front half holds the lounge (right) and the ping-pong table (left).
export const FW = 16, FD = 13, FH = 3.4, SLAB = .4, GAP = 3.2;
// the Lobby stacks the Floors with air between them (a cutaway dollhouse) so every office stays visible
export const floorY = (n) => n * (FH + SLAB + GAP);
export const LAYOUT_NAMES = { rows: 'Rows', pods: 'Pods', circle: 'Circle', 'open-space': 'Open Space' };

// desks live in the work zone: the back two thirds of the room, clear of the pantry on the left wall
const WORK = { x0: -5.8, x1: 7, z0: -4.6, z1: 1.6 };
const clampX = (x) => Math.max(WORK.x0, Math.min(WORK.x1, x));
const clampZ = (z) => Math.max(WORK.z0, Math.min(WORK.z1 + 2.4, z));
const CX = (WORK.x0 + WORK.x1) / 2;

export function presetSpots(n, layout) {
  const out = [];
  if (layout === 'circle') {
    const r = Math.min(3.6, 1.6 + n * .35);
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + Math.PI / 2;
      const x = CX + Math.cos(a) * r * 1.4, z = -1.5 + Math.sin(a) * r * .85;
      out.push({ x, z, ry: Math.atan2(CX - x, -1.5 - z) });           // everyone faces the centre
    }
  } else if (layout === 'pods') {
    const pods = Math.ceil(n / 4);
    for (let i = 0; i < n; i++) {
      const pod = Math.floor(i / 4), k = i % 4;
      const px = CX + (pod - (pods - 1) / 2) * 6.6, side = k % 2 ? 1 : -1, front = k < 2;
      out.push({ x: px + side * 1.65, z: front ? .5 : -3.6, ry: front ? Math.PI : 0 });
    }
  } else if (layout === 'open-space') {
    const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(n * 1.6))));
    for (let i = 0; i < n; i++) {
      const c = i % cols, r = Math.floor(i / cols);
      const jitter = ((i * 7919) % 13) / 13 - .5;                    // deterministic, looks hand-placed
      out.push({ x: CX + (c - (cols - 1) / 2) * 3.3 + jitter * .6, z: -3.8 + r * 3 + (c % 2) * .5, ry: jitter * .6 });
    }
  } else {
    const per = Math.min(4, Math.max(1, Math.ceil(n / 2)));
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / per), c = i % per, cols = Math.min(per, n - r * per);
      out.push({ x: CX + (c - (cols - 1) / 2) * 3.2, z: -3.9 + r * 3.1, ry: 0 });
    }
  }
  return out.map((s) => ({ x: +clampX(s.x).toFixed(3), z: +clampZ(s.z).toFixed(3), ry: +s.ry.toFixed(3) }));
}

// saved desk positions win; agents without a desk get their preset spot
export function desksFor(agents, desks = [], layout = 'rows') {
  const spots = presetSpots(agents.length, layout);
  return agents.map((a, i) => {
    const d = desks.find((x) => x.agent === a.id);
    return d ? { ...d } : { agent: a.id, ...spots[i], device: 'laptop' };
  });
}

// the lounge corner (front right) for every preset: rug, sofa facing the TV, beanbags
export function loungeFor() {
  return {
    rug: { x: 4.6, z: 4.4, ry: 0 }, sofa: { x: 4.6, z: 5.75, ry: Math.PI }, tv: { x: 4.6, z: 2.9, ry: 0 },
    beanbag: { x: 2.3, z: 4.1, ry: .4 },
  };
}
