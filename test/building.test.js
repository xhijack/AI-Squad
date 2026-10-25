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
  assert.equal(a.number, 2); assert.equal(b.number, 3);
  assert.throws(() => building.registerFloor(dir('a')), /already a Floor/);
  assert.throws(() => building.registerFloor(dir('c'), { number: 2 }), /taken/);
  assert.throws(() => building.registerFloor(dir('c'), { number: 1 }), /independent agents/);
  assert.throws(() => building.registerFloor(path.join(root, 'missing')), /not found/);
});

test('moving onto an occupied number swaps', () => {
  building.setFloorNumber('shop-2', 2);
  const f = building.loadBuilding().floors;
  assert.equal(f.find((x) => x.id === 'shop').number, 3);
  assert.equal(f.find((x) => x.id === 'shop-2').number, 2);
  assert.throws(() => building.setFloorNumber('shop', 1), /2-99/);
});

test('unregister keeps the project directory', () => {
  building.unregisterFloor('shop');
  assert.equal(building.loadBuilding().floors.length, 1);
  assert.ok(fs.existsSync(path.join(root, 'a')));
  assert.equal(building.nextFloorNumber(), 3);
});

test('Floors from before Floor 1 was reserved are renumbered from 2, keeping their order', () => {
  const floors = [{ id: 'a', number: 1 }, { id: 'b', number: 2 }, { id: 'c', number: 5 }, { id: 'd', number: 3 }];
  assert.equal(building.renumberFrom2(floors), true);
  assert.deepEqual(floors.map((f) => [f.id, f.number]), [['a', 2], ['b', 3], ['c', 5], ['d', 4]]);
  assert.equal(building.renumberFrom2(floors), false);
  building.saveBuilding({ name: 'X', floors: [{ id: 'old', path: root, number: 1 }], prefs: {} });
  assert.equal(building.loadBuilding().floors[0].number, 2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'home', 'building.json'), 'utf8')).floors[0].number, 2, 'saved');
});
