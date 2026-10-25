// Server as a service: systemd user unit / launchd agent generation, start, stop, status and uninstall
// with a recorded fake systemctl (nothing touches the real machine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratch } from './helpers.js';
import * as svc from '../server/service.js';

const root = scratch({ seed: false });
const unitFile = path.join(root, 'systemd', 'aisquad.service');
const recorder = (fail = () => false) => { const calls = []; const run = (file, args) => { calls.push([file, ...args].join(' ')); if (fail(file, args)) { const e = new Error('no'); e.stdout = 'inactive\n'; throw e; } return 'active\n'; }; return { calls, run }; };

test('the unit runs node with the plugin path, keeps restarting and leaves agents alone', () => {
  const cmd = svc.serverCommand({ port: 8097, host: '127.0.0.1', node: '/opt/node/bin/node', root: '/plug/aisquad 0.2', env: { PATH: '/usr/bin', AISQUAD_HOME: 'rel/home', SECRET: 'x' } });
  assert.deepEqual(cmd.args, ['/opt/node/bin/node', '/plug/aisquad 0.2/server/index.js', '--port', '8097', '--host', '127.0.0.1']);
  assert.equal(cmd.vars.PATH, '/opt/node/bin:/usr/bin', 'node and its neighbours (claude via nvm) are found');
  assert.equal(cmd.vars.AISQUAD_HOME, path.resolve('rel/home'));
  assert.equal(cmd.vars.SECRET, undefined, 'only AI Squad settings travel');
  const unit = svc.renderUnit(cmd, '/home/u/.aisquad/server.log');
  assert.match(unit, /^ExecStart=\/opt\/node\/bin\/node "\/plug\/aisquad 0\.2\/server\/index\.js" --port 8097 --host 127\.0\.0\.1$/m);
  assert.match(unit, /^Restart=always$/m);
  assert.match(unit, /^KillMode=process$/m);
  assert.match(unit, /^WantedBy=default\.target$/m);
  const plist = svc.renderPlist(cmd, '/tmp/log');
  assert.match(plist, /<key>KeepAlive<\/key><true\/>/);
  assert.match(plist, /<string>\/plug\/aisquad 0\.2\/server\/index\.js<\/string>/);
});

test('mode: systemd when the user manager answers, launchd on macOS, detached otherwise', () => {
  assert.equal(svc.detectMode({ run: recorder().run, platform: 'linux', env: {} }), 'systemd');
  assert.equal(svc.detectMode({ run: recorder(() => true).run, platform: 'linux', env: {} }), 'detached');
  assert.equal(svc.detectMode({ platform: 'darwin', env: {} }), 'launchd');
  assert.equal(svc.detectMode({ platform: 'linux', env: { AISQUAD_SERVICE: 'detached' } }), 'detached');
});

test('start writes the unit once, enables and starts it; a moved plugin rewrites and restarts', () => {
  const r = recorder();
  assert.deepEqual(svc.start({ unitFile, root: '/plug/v1' }, { run: r.run, mode: 'systemd' }), { mode: 'systemd', changed: true, started: true });
  assert.deepEqual(r.calls, ['systemctl --user daemon-reload', 'systemctl --user enable aisquad.service', 'systemctl --user restart aisquad.service']);
  r.calls.length = 0;
  assert.equal(svc.start({ unitFile, root: '/plug/v1' }, { run: r.run, mode: 'systemd' }).changed, false);
  assert.deepEqual(r.calls, ['systemctl --user enable aisquad.service', 'systemctl --user start aisquad.service']);
  r.calls.length = 0;
  assert.equal(svc.start({ unitFile, root: '/plug/v2' }, { run: r.run, mode: 'systemd' }).changed, true);
  assert.match(fs.readFileSync(unitFile, 'utf8'), /\/plug\/v2\/server\/index\.js/);
  assert.ok(r.calls.includes('systemctl --user restart aisquad.service'));
});

test('status, stop and uninstall', () => {
  const r = recorder((f, a) => a.includes('is-enabled'));
  const st = svc.status({ run: r.run, mode: 'systemd', unitFile });
  assert.deepEqual([st.installed, st.active, st.enabled], [true, 'active', 'inactive']);
  r.calls.length = 0;
  assert.deepEqual(svc.uninstall({ run: r.run, mode: 'systemd', unitFile }), { mode: 'systemd', removed: true });
  assert.deepEqual(r.calls, ['systemctl --user disable --now aisquad.service', 'systemctl --user daemon-reload']);
  assert.equal(fs.existsSync(unitFile), false);
  assert.equal(svc.status({ run: r.run, mode: 'systemd', unitFile }).installed, false);
});

test('detached mode spawns the server command itself', () => {
  let got = null;
  svc.start({ port: 9 }, { mode: 'detached', spawnDetached: (cmd) => { got = cmd; } });
  assert.deepEqual(got.args.slice(-4), ['--port', '9', '--host', '127.0.0.1']);
});
