// Server meter: /proc parsing, process groups, danger levels and the 6 minute history (fake /proc tree).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratch } from './helpers.js';
import * as m from '../server/meter.js';

const proc = path.join(scratch({ seed: false }), 'proc');
const put = (f, t) => { fs.mkdirSync(path.dirname(path.join(proc, f)), { recursive: true }); fs.writeFileSync(path.join(proc, f), t); };
const stat = (pid, comm, ticks, pages) => `${pid} (${comm}) S 1 1 1 0 -1 0 0 0 0 0 ${ticks} 0 0 0 20 0 1 0 100 1000 ${pages} 0`;
const GB = 2 ** 30;
const meminfo = (availGb) => `MemTotal: ${16 * GB / 1024} kB\nMemFree: 100 kB\nMemAvailable: ${availGb * GB / 1024} kB\nSwapTotal: ${4 * GB / 1024} kB\nSwapFree: ${3 * GB / 1024} kB\n`;

test('parses /proc/stat, meminfo and process stat lines', () => {
  assert.deepEqual(m.parseCpu('cpu  100 0 50 800 50 0 0 0 0 0\ncpu0 1 2 3'), { idle: 850, total: 1000 });
  assert.deepEqual(m.parseMeminfo(meminfo(8)), { total: 16 * GB, available: 8 * GB, swapTotal: 4 * GB, swapFree: 3 * GB });
  assert.deepEqual(m.parseProcStat(stat(42, 'my (odd) name', 30, 1000)), { comm: 'my (odd) name', ppid: 1, ticks: 30, rss: 4096000 });
});

test('groups processes by name without exposing command lines', () => {
  assert.equal(m.groupOf('claude', '/usr/bin/claude --agent x'), 'Claude Code');
  assert.equal(m.groupOf('node', 'node /opt/aisquad/server/index.js --port 8097'), 'The AI Squad');
  assert.equal(m.groupOf('node', 'node app.js'), 'Node.js');
  assert.equal(m.groupOf('postgres', ''), 'Databases & caches');
  assert.equal(m.groupOf('chrome', ''), 'Browsers');
  assert.equal(m.groupOf('xyz', ''), 'Other');
});

test('samples CPU from the difference between two reads, history and danger levels', () => {
  put('stat', 'cpu  100 0 0 900 0 0 0 0 0 0\n'); put('meminfo', meminfo(8));
  put('42/stat', stat(42, 'claude', 100, 300000)); put('42/cmdline', 'claude\0--agent\0x\0SECRET=1');
  put('43/stat', stat(43, 'bash', 1, 10)); put('43/cmdline', 'bash');
  const meter = m.createMeter({ proc, diskPath: proc, ncpu: 4 });
  meter.sample();
  put('stat', 'cpu  400 0 100 1500 0 0 0 0 0 0\n');       // +1000 jiffies, 600 idle -> 40 % busy
  put('42/stat', stat(42, 'claude', 300, 300000));         // 200 of the 1000 jiffies -> 20 % of the machine
  const s = meter.sample();
  assert.equal(s.cpu, 40);
  assert.deepEqual(s.top.map((p) => [p.pid, p.comm, p.cpu, p.group]), [[42, 'claude', 20, 'Claude Code']]);
  assert.equal(JSON.stringify(s).includes('SECRET'), false, 'command lines never leave the meter');
  assert.deepEqual(s.groups.map((g) => g.name), ['Claude Code']);
  assert.equal(s.levels.overall, 'ok');
  assert.equal(meter.detail().hist.length, 2);
  assert.equal(meter.summary().top, undefined, 'the dock chip gets no process list');
  put('meminfo', meminfo(1));                                // 1 GB free is below the 1.5 GB limit
  assert.equal(meter.sample().levels.ram, 'bad');
  for (let i = 0; i < m.HISTORY + 5; i++) meter.sample();
  assert.equal(meter.detail().hist.length, m.HISTORY);
});
