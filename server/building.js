// ~/.aisquad/building.json: the Floors registered on this machine (absolute paths live only here).
import fs from 'node:fs';
import path from 'node:path';
import { paths } from './config.js';
import { readJson, writeJson, uniqueId, bad, notFound } from './util.js';

export const MAX_FLOOR = 99;

export function loadBuilding() {
  const b = readJson(paths.building(), null) || {};
  return { name: String(b.name || 'The AI Squad'), floors: Array.isArray(b.floors) ? b.floors : [], prefs: b.prefs || {} };
}
export const saveBuilding = (b) => writeJson(paths.building(), b);

export function floorEntry(id) {
  const f = loadBuilding().floors.find((x) => x.id === id);
  if (!f) throw notFound(`Floor not found: ${id}`);
  return f;
}

export const nextFloorNumber = (b = loadBuilding()) => { const used = new Set(b.floors.map((f) => f.number)); let n = 1; while (used.has(n)) n++; return n; };

export function registerFloor(dir, { name, number } = {}) {
  const b = loadBuilding();
  const abs = path.resolve(dir);
  if (!fs.statSync(abs, { throwIfNoEntry: false })?.isDirectory()) throw bad(`Directory not found: ${abs}`);
  if (b.floors.some((f) => f.path === abs)) throw bad('This directory is already a Floor');
  const n = number ? Number(number) : nextFloorNumber(b);
  if (!Number.isInteger(n) || n < 1 || n > MAX_FLOOR) throw bad(`Floor number must be 1-${MAX_FLOOR}`);
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
  if (!Number.isInteger(n) || n < 1 || n > MAX_FLOOR) throw bad(`Floor number must be 1-${MAX_FLOOR}`);
  const b = loadBuilding();
  const f = b.floors.find((x) => x.id === id);
  if (!f) throw notFound(`Floor not found: ${id}`);
  const other = b.floors.find((x) => x.number === n && x !== f);
  if (other) other.number = f.number;
  f.number = n;
  saveBuilding(b);
  return f;
}

export function setBuildingName(name) {
  const b = loadBuilding();
  b.name = String(name || '').trim().slice(0, 60) || b.name;
  saveBuilding(b);
}
