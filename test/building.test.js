import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratch } from './helpers.js';
import * as building from '../server/building.js';

const root = scratch({ seed: false });
const dir = (n) => { const d = path.join(root, n); fs.mkdirSync(d, { recursive: true }); return d; };

test('register floors with unique ids and numbers', () => {
  const a = building.registerFloor(dir('a'), { name: 'Shop' });
  const b = building.registerFloor(dir('b'), { name: 'Shop' });
  assert.equal(a.id, 'shop'); assert.equal(b.id, 'shop-2');
  assert.equal(a.number, 1); assert.equal(b.number, 2);
  assert.throws(() => building.registerFloor(dir('a')), /already a Floor/);
  assert.throws(() => building.registerFloor(dir('c'), { number: 2 }), /taken/);
  assert.throws(() => building.registerFloor(path.join(root, 'missing')), /not found/);
});

test('moving onto an occupied number swaps', () => {
  building.setFloorNumber('shop-2', 1);
  const f = building.loadBuilding().floors;
  assert.equal(f.find((x) => x.id === 'shop').number, 2);
  assert.equal(f.find((x) => x.id === 'shop-2').number, 1);
  assert.throws(() => building.setFloorNumber('shop', 0), /1-99/);
});

test('unregister keeps the project directory', () => {
  building.unregisterFloor('shop');
  assert.equal(building.loadBuilding().floors.length, 1);
  assert.ok(fs.existsSync(path.join(root, 'a')));
  assert.equal(building.nextFloorNumber(), 2);
});
