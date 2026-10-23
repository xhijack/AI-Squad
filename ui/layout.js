// Floor geometry and desk layout presets (Rows, Pods, Circle, Open Space). Units are metres;
// the floor spans x -7..7 and z -4.5..4.5, the open (glass) side faces +z.
export const FW = 14, FD = 9, FH = 2.7, GAP = 2.4;
export const floorY = (n) => n * (FH + GAP);
export const LAYOUT_NAMES = { rows: 'Rows', pods: 'Pods', circle: 'Circle', 'open-space': 'Open Space' };

const clampX = (x) => Math.max(-FW / 2 + 1, Math.min(FW / 2 - 1, x));
const clampZ = (z) => Math.max(-FD / 2 + 1, Math.min(FD / 2 - 1.2, z));

export function presetSpots(n, layout) {
  const out = [];
  if (layout === 'circle') {
    const r = Math.min(3.1, 1.2 + n * .35);
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + Math.PI / 2;
      const x = Math.cos(a) * r * 1.5, z = Math.sin(a) * r - .3;
      out.push({ x, z, ry: Math.atan2(-x, -z - .3) });             // everyone faces the centre
    }
  } else if (layout === 'pods') {
    const pods = Math.ceil(n / 4);
    for (let i = 0; i < n; i++) {
      const pod = Math.floor(i / 4), k = i % 4;
      const px = (pod - (pods - 1) / 2) * 4.8, side = k % 2 ? 1 : -1, front = k < 2;
      out.push({ x: px + side * .95, z: front ? 1.3 : -1.7, ry: front ? Math.PI : 0 });
    }
  } else if (layout === 'open-space') {
    const cols = Math.max(2, Math.ceil(Math.sqrt(n * 1.6)));
    for (let i = 0; i < n; i++) {
      const c = i % cols, r = Math.floor(i / cols);
      const jitter = ((i * 7919) % 13) / 13 - .5;                    // deterministic, looks hand-placed
      out.push({ x: (c - (cols - 1) / 2) * 3.1 + jitter * .6, z: -1.8 + r * 2.7 + (c % 2) * .5, ry: jitter * .8 });
    }
  } else {
    const per = Math.min(4, Math.max(1, Math.ceil(n / 2)));
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / per), c = i % per, cols = Math.min(per, n - r * per);
      out.push({ x: (c - (cols - 1) / 2) * 2.9, z: -1.6 + r * 2.7, ry: 0 });
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
