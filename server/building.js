// ~/.aisquad/building.json: the Floors registered on this machine (absolute paths live only here).
import fs from 'node:fs';
import path from 'node:path';
import { paths } from './config.js';
import { readJson, writeJson, uniqueId, bad, notFound } from './util.js';

export const MAX_FLOOR = 99;
// Floor 1 is reserved for the independent agents found on this machine; squads start at Floor 2
export const INDEPENDENT_FLOOR = 1, FIRST_SQUAD_FLOOR = 2;
const range = `${FIRST_SQUAD_FLOOR}-${MAX_FLOOR} (Floor ${INDEPENDENT_FLOOR} is for independent agents)`;
const validNumber = (n) => Number.isInteger(n) && n >= FIRST_SQUAD_FLOOR && n <= MAX_FLOOR;

// Floors created before Floor 1 was reserved move up, keeping their order: 1, 2, 3 -> 2, 3, 4
export function renumberFrom2(floors) {
  let next = FIRST_SQUAD_FLOOR, moved = false;
  for (const f of [...floors].sort((a, b) => a.number - b.number)) {
    const n = Math.max(f.number, next);
    if (n !== f.number) { f.number = n; moved = true; }
    next = n + 1;
  }
  return moved;
}

export function loadBuilding() {
  const b = readJson(paths.building(), null) || {};
  const out = { name: String(b.name || 'The AI Squad'), floors: Array.isArray(b.floors) ? b.floors : [], prefs: b.prefs || {} };
  if (out.floors.some((f) => f.number < FIRST_SQUAD_FLOOR) && renumberFrom2(out.floors)) saveBuilding(out);
  return out;
}
export const saveBuilding = (b) => writeJson(paths.building(), b);

export function floorEntry(id) {
  const f = loadBuilding().floors.find((x) => x.id === id);
  if (!f) throw notFound(`Floor not found: ${id}`);
  return f;
}

export const nextFloorNumber = (b = loadBuilding()) => { const used = new Set(b.floors.map((f) => f.number)); let n = FIRST_SQUAD_FLOOR; while (used.has(n)) n++; return n; };

export function registerFloor(dir, { name, number } = {}) {
  const b = loadBuilding();
  const abs = path.resolve(dir);
  if (!fs.statSync(abs, { throwIfNoEntry: false })?.isDirectory()) throw bad(`Directory not found: ${abs}`);
  if (b.floors.some((f) => f.path === abs)) throw bad('This directory is already a Floor');
  const n = number ? Number(number) : nextFloorNumber(b);
  if (!validNumber(n)) throw bad(`Floor number must be ${range}`);
  if (b.floors.some((f) => f.number === n)) throw bad(`Floor ${n} is already taken`);
  const entry = { id: uniqueId(name || path.basename(abs), b.floors.map((f) => f.id), 'floor'), path: abs, number: n, createdAt: new Date().toISOString() };
  b.floors.push(entry);
  saveBuilding(b);
  return entry;
}

export function unregisterFloor(id) {
  const b = loadBuilding();
  const n = b.floors.length;
  b.floors = b.floors.filter((f) => f.id !== id);
  if (b.floors.length === n) throw notFound(`Floor not found: ${id}`);
  saveBuilding(b);
}

// moving onto an occupied number swaps the two Floors
export function setFloorNumber(id, number) {
  const n = Number(number);
  if (!validNumber(n)) throw bad(`Floor number must be ${range}`);
  const b = loadBuilding();
  const f = b.floors.find((x) => x.id === id);
  if (!f) throw notFound(`Floor not found: ${id}`);
  const other = b.floors.find((x) => x.number === n && x !== f);
  if (other) other.number = f.number;
  f.number = n;
  saveBuilding(b);
  return f;
}

export function setPrefs(over) {
  const b = loadBuilding();
  b.prefs = { ...b.prefs, ...over };
  saveBuilding(b);
}

export function setBuildingName(name) {
  const b = loadBuilding();
  b.name = String(name || '').trim().slice(0, 60) || b.name;
  saveBuilding(b);
}
