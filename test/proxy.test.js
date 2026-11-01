// SPDX-License-Identifier: Apache-2.0
// Public mode and the proxy in front (1.9): the flag, the setting and proxy headers turn it on and it stays on;
// trustProxy finds the client address, the scheme and the host only through trusted hops from a loopback peer;
// spoofed headers from any other peer are ignored. Plain objects stand in for requests: no sockets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as proxy from '../server/proxy.js';

const req = (peer, headers = {}, encrypted = false) => ({ socket: { remoteAddress: peer, encrypted }, headers });

test('public mode: by flag, by setting, by proxy headers; once on it stays on', () => {
  assert.equal(proxy.publicMode({ flag: true }).reason(), 'flag');
  let on = false;
  const bySetting = proxy.publicMode({ setting: () => on });
  assert.equal(bySetting.on(), false);
  on = true; assert.equal(bySetting.reason(), 'setting');
  on = false; assert.equal(bySetting.on(), true, 'turning the setting off waits for a restart');
  const auto = proxy.publicMode();
  assert.equal(auto.observe(req('127.0.0.1', {})), false);
  for (const h of ['x-forwarded-for', 'forwarded', 'cf-connecting-ip']) {
    const m = proxy.publicMode();
    assert.equal(m.observe(req('127.0.0.1', { [h]: '203.0.113.9' })), true, h);
    assert.equal(m.observe(req('127.0.0.1', {})), true, `${h}: still on`);
    assert.equal(m.reason(), 'proxy-headers');
  }
});

test('trustProxy hops: default 1 in public mode, 0 otherwise, a number when set', () => {
  assert.equal(proxy.hopsOf(undefined, true), 1);
  assert.equal(proxy.hopsOf(undefined, false), 0);
  assert.equal(proxy.hopsOf(0, true), 0);
  assert.equal(proxy.hopsOf('2', false), 2);
  assert.equal(proxy.hopsOf(-1, true), 1);
});

test('client address: the right hop of X-Forwarded-For, Forwarded or CF-Connecting-IP from a loopback proxy', () => {
  assert.equal(proxy.clientAddress(req('127.0.0.1', { 'x-forwarded-for': '203.0.113.9' }), 1), '203.0.113.9');
  assert.equal(proxy.clientAddress(req('::ffff:127.0.0.1', { 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }), 1), '203.0.113.9', 'a spoofed first entry is not believed');
  assert.equal(proxy.clientAddress(req('127.0.0.1', { 'x-forwarded-for': '203.0.113.9, 10.0.0.2' }), 2), '203.0.113.9', 'two hops');
  assert.equal(proxy.clientAddress(req('127.0.0.1', { 'x-forwarded-for': '203.0.113.9' }), 5), '203.0.113.9', 'more hops than entries: the farthest');
  assert.equal(proxy.clientAddress(req('::1', { forwarded: 'for=6.6.6.6, for="[2001:db8::7]:4711";proto=https' }), 1), '2001:db8::7');
  assert.equal(proxy.clientAddress(req('127.0.0.1', { 'cf-connecting-ip': '198.51.100.4' }), 1), '198.51.100.4');
  assert.equal(proxy.clientAddress(req('127.0.0.1', { 'x-forwarded-for': '203.0.113.9:5555' }), 1), '203.0.113.9', 'a port is dropped');
});

test('spoofed headers: never believed from a non-loopback peer, nor with trustProxy 0', () => {
  const lan = req('192.168.1.50', { 'x-forwarded-for': '127.0.0.1', 'cf-connecting-ip': '127.0.0.1', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'evil.example' });
  for (const hops of [0, 1, 3]) {
    assert.equal(proxy.clientAddress(lan, hops), '192.168.1.50');
    assert.equal(proxy.isHttps(lan, hops), false);
    assert.equal(proxy.requestHost({ ...lan, headers: { ...lan.headers, host: '192.168.1.10:8097' } }, hops), '192.168.1.10:8097');
  }
  assert.equal(proxy.clientAddress(req('127.0.0.1', { 'x-forwarded-for': '203.0.113.9' }), 0), '127.0.0.1');
});

test('scheme and host through the proxy; local tools are loopback peers without proxy headers', () => {
  assert.equal(proxy.isHttps(req('127.0.0.1', { 'x-forwarded-proto': 'https' }), 1), true);
  assert.equal(proxy.isHttps(req('127.0.0.1', { forwarded: 'for=1.2.3.4;proto=https' }), 1), true);
  assert.equal(proxy.isHttps(req('127.0.0.1', { 'x-forwarded-proto': 'http' }), 1), false);
  assert.equal(proxy.isHttps(req('192.168.1.5', {}, true), 0), true, 'TLS on the socket itself');
  assert.equal(proxy.requestHost(req('127.0.0.1', { host: '127.0.0.1:8097', 'x-forwarded-host': 'squad.example.com' }), 1), 'squad.example.com');
  assert.equal(proxy.requestHost(req('127.0.0.1', { host: 'Squad.Example.com' }), 1), 'squad.example.com');
  assert.equal(proxy.isLocalTool(req('127.0.0.1', {})), true);
  assert.equal(proxy.isLocalTool(req('127.0.0.1', { 'cf-connecting-ip': '1.2.3.4' })), false);
  assert.equal(proxy.isLocalTool(req('192.168.1.5', {})), false);
});
