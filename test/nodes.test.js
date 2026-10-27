// SPDX-License-Identifier: Apache-2.0
// More machines: a Head (this process) and real worker processes (`aisquad node`) with the fake headless Claude.
// A job of a Space pinned to a worker runs there in a clone, its events come back, its branch is pushed and fetched;
// a worker that goes silent loses its job, which is queued again.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scratch } from './helpers.js';
import { configure, config } from '../server/config.js';
import { createHandler } from '../server/api.js';
import { loadPin } from '../server/pin.js';
import * as nodes from '../server/nodes.js';
import * as worker from '../server/worker.js';
import * as floors from '../server/floors.js';
import * as building from '../server/building.js';
import * as squad from '../server/squad.js';
import * as dispatcher from '../server/dispatcher.js';
import * as squadLog from '../server/log.js';
import * as access from '../server/access.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = scratch();
const FAKE = path.join(here, 'fixtures', 'fake-claude-stream.cjs');
configure({ claudeBin: FAKE, useHooks: false, useSystemd: false });
const pin = loadPin();
const server = http.createServer(createHandler({ pin }));
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
const kids = [];
after(() => { for (const k of kids) { try { k.kill('SIGKILL'); } catch { /* gone */ } } server.close(); });
const call = async (method, url, body, headers = { 'x-aisquad-pin': pin }) => { const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
const until = async (fn, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 150)); } return fn(); };
const g = (cwd, ...a) => execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { encoding: 'utf8' }).trim();
squad.setResourceReader(() => ({ mem: { available: 6 * 2 ** 30, total: 8 * 2 ** 30 }, cpus: 4, load: [.2, .2, .2] }));

function startWorker(name, token, mode) {
  const home = path.join(root, `w-${name}`);
  const k = spawn(process.execPath, [path.join(here, '..', 'bin', 'aisquad.js'), 'node', '--head', base, '--name', name, '--token', token], {
    env: { ...process.env, AISQUAD_HOME: home, CLAUDE_BIN: FAKE, FAKE_CLAUDE_MODE: mode, FAKE_CLAUDE_LOG: path.join(home, 'fake.log'), AISQUAD_NO_HOOKS: '1', AISQUAD_NO_SYSTEMD: '1' }, stdio: 'ignore' });
  kids.push(k);
  return { k, home };
}
const origin = path.join(root, 'origin.git'), proj = path.join(root, 'projects', 'pos');
let fid = '', agent = '', box2 = null;

test('placement, free slots and arguments on a worker', () => {
  assert.equal(nodes.workerFree({ maxAgents: 6, running: ['a'], resources: { mem: { available: 5 * 2 ** 30 } }, sessionRss: 2 ** 30 }), 3, 'RAM: 3 more after the 2 GB kept free');
  assert.equal(nodes.workerFree({ maxAgents: 2, running: ['a'] }, 1), 0, 'one already handed over');
  assert.deepEqual(worker.localArgs(['-p', '--add-dir', '/head/pos/../lib', '--add-dir', root, '--settings', '{"autoMemoryDirectory":"/head/pos/.claude/aisquad/memory"}'], '/head/pos', '/w/pos'),
    ['-p', '--add-dir', root, '--settings', '{"autoMemoryDirectory":"/w/pos/.claude/aisquad/memory"}'], 'its own paths, no missing folders');
  assert.throws(() => nodes.addNode('head'), /not "head"/);
  assert.equal(access.requiredRole('GET', '/api/nodes'), 'owner');
});

test('a Space pinned to a worker: the job runs in its clone, the events come back, the branch is pushed and fetched', async () => {
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  await floors.createFloor({ name: 'POS', directory: { mode: 'new', path: proj }, team: [{ displayName: 'Budi - Developer', template: 'fullstack-developer' }] });
  fid = building.loadBuilding().floors[0].id; agent = floors.readFloor(proj).team.agents[0].id;
  g(proj, 'remote', 'add', 'origin', origin); g(proj, 'push', '-q', '-u', 'origin', 'main');
  const added = await call('POST', '/api/nodes', { name: 'box-2' });
  assert.equal(added.status, 200); assert.match(added.body.command, /aisquad node --head .* --name box-2 --token [0-9a-f]{48}$/);
  assert.ok(!fs.readFileSync(path.join(config.home, 'nodes.json'), 'utf8').includes(added.body.token), 'only its hash is kept');
  assert.equal((await call('GET', '/api/nodes/work', null, { 'x-aisquad-node': 'box-2:wrong' })).status, 401);
  box2 = startWorker('box-2', added.body.token, 'commit');
  assert.ok(await until(async () => (await call('GET', '/api/nodes')).body.nodes.find((n) => n.name === 'box-2' && n.online)), 'the worker says hello');
  assert.equal((await call('PATCH', `/api/floors/${fid}`, { node: 'box-2' })).status, 200);
  const r = await call('POST', `/api/floors/${fid}/agents/${agent}/jobs`, { prompt: 'Add the receipt printer setting' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.job.node, 'box-2');
  const id = r.body.job.id;
  const done = await until(async () => { const j = (await call('GET', `/api/jobs/${id}`)).body; return j.status !== 'running' ? j : null; });
  assert.equal(done.status, 'done', JSON.stringify(done));
  assert.match(done.text, /^Done: Add the receipt printer setting/);
  assert.equal(done.branch, `${agent}/job-${id}`);
  assert.ok(done.events.some((e) => e.kind === 'tool'), 'the event stream came back');
  const ran = JSON.parse(fs.readFileSync(path.join(box2.home, 'fake.log'), 'utf8').trim().split('\n').at(-1));
  assert.equal(ran.cwd, path.join(box2.home, 'worker', 'repos', fid), 'in the worker\'s clone');
  assert.ok(fs.existsSync(path.join(ran.cwd, '.claude', 'agents', `${agent}.md`)), 'with the agent file from the Head');
  assert.equal(ran.apiKey, false, 'no credentials from the Head');
  assert.ok(await until(() => { try { return g(proj, 'branch', '--list', done.branch); } catch { return ''; } }), 'the Head fetched the branch');
  assert.match(g(proj, 'log', '-1', '--format=%s', done.branch), /^work /);
  const ev = squadLog.read(fid, { type: 'job.ended' }).at(-1);
  assert.equal(ev.data.node, 'box-2'); assert.equal(ev.data.branch, done.branch);
  assert.equal(squad.buildingSnapshot().limits.running, 0, 'a worker\'s job does not use this machine\'s slots');
});

test('a worker that goes silent loses its job; the job is queued again for another machine', async () => {
  const added = await call('POST', '/api/nodes', { name: 'box-3' });
  const box3 = startWorker('box-3', added.body.token, 'slow');
  await until(async () => (await call('GET', '/api/nodes')).body.nodes.find((n) => n.name === 'box-3' && n.online));
  await call('PATCH', `/api/floors/${fid}`, { node: 'box-3' });
  const r = await call('POST', `/api/floors/${fid}/agents/${agent}/jobs`, { prompt: 'Write the migration' });
  assert.equal(r.body.job.node, 'box-3');
  const id = r.body.job.id;
  await until(() => fs.existsSync(path.join(box3.home, 'jobs', `${id}.json`)));
  const pid = JSON.parse(fs.readFileSync(path.join(box3.home, 'jobs', `${id}.json`), 'utf8')).pid;
  box3.k.kill('SIGKILL');
  try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ }
  const lost = squad.failoverTick(Date.now() + nodes.OFFLINE_MS + 5000);
  assert.deepEqual(lost.map((x) => [x.job, x.node]), [[id, 'box-3']]);
  const j = (await call('GET', `/api/jobs/${id}`)).body;
  assert.equal(j.status, 'failed'); assert.equal(j.error, 'lost: the machine box-3 stopped answering');
  const q = dispatcher.load().find((x) => x.id === lost[0].queued);
  assert.equal(q.priority, 'P1'); assert.equal(q.via, 'failover');
  assert.match(q.task, /^Write the migration\n\n\(Note from The AI Squad: this task ran on the machine box-3/);
  assert.equal(squadLog.read(fid, { type: 'node.lost' }).at(-1).data.node, 'box-3');
  assert.equal(squad.failoverTick(Date.now() + nodes.OFFLINE_MS + 5000).length, 0, 'once');
  // a worker cannot report a job that is not its own
  assert.equal((await call('POST', `/api/nodes/jobs/${id}`, { status: 'done' }, { 'x-aisquad-node': `box-2:${'0'.repeat(48)}` })).status, 401);
  dispatcher.remove(q.id);
});
