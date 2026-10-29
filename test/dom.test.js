// SPDX-License-Identifier: Apache-2.0
// Panel updates in a real browser (1.0.3): typing survives snapshot updates (same element, text, caret), a click
// during an update still sends once, and a second click or Ctrl+Enter while it runs does nothing. Headless Chrome;
// skipped when there is none or the machine is short of memory (swap above 80 %).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = (() => { try { execFileSync('which', [process.env.CHROME_BIN || 'google-chrome'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const swapFull = (() => { try { const m = fs.readFileSync('/proc/meminfo', 'utf8'); const v = (k) => +(m.match(new RegExp(`${k}:\\s+(\\d+)`)) || [])[1]; return v('SwapTotal') > 0 && (v('SwapTotal') - v('SwapFree')) / v('SwapTotal') > .8; } catch { return false; } })();
const skip = !chrome ? 'no Chrome' : swapFull ? 'swap above 80 %' : false;

const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const f = u === '/' ? path.join(ROOT, 'test/fixtures/dom-patch.html') : path.join(ROOT, u);
  if (!(f.startsWith(path.join(ROOT, 'ui')) || f.startsWith(path.join(ROOT, 'test/fixtures'))) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.json') ? 'application/json' : 'text/html' });
  res.end(fs.readFileSync(f));
});

test('typing keeps its field through updates; Send during an update sends once', { skip }, async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  after(() => server.close());
  const { openChrome, sleep } = await import('../scripts/chrome.js');
  const c = await openChrome();
  after(() => c.close());
  await c.send('Emulation.setDeviceMetricsOverride', { width: 800, height: 600, deviceScaleFactor: 1, mobile: false });
  await c.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  for (let i = 0; i < 50 && !(await c.evaluate('window.ready === true')); i++) await sleep(100);
  // the task field (a kept node): focus, type, put the caret in the middle, then several updates
  await c.evaluate("document.querySelector('textarea[name=text]').focus()");
  await c.send('Input.insertText', { text: 'Fix the checkout page' });
  await c.evaluate("document.querySelector('textarea[name=text]').setSelectionRange(4, 7)");
  await c.evaluate('window.ta = document.querySelector("textarea[name=text]"); for (let i = 0; i < 5; i++) window.update()');
  const s = await c.evaluate("({ same: document.activeElement === window.ta, value: window.ta.value, start: window.ta.selectionStart, end: window.ta.selectionEnd, status: document.querySelector('.status').textContent })");
  assert.deepEqual(s, { same: true, value: 'Fix the checkout page', start: 4, end: 7, status: 'status 6' }, 'the panel updated around the field');
  await c.send('Input.insertText', { text: 'X' });
  assert.equal(await c.evaluate('window.ta.value'), 'Fix X checkout page', 'typing goes on where the caret was');
  // a rebuilt field (the reply card): an update waits while it has focus, and comes once it loses it
  await c.evaluate("document.getElementById('reply').focus()");
  await c.send('Input.insertText', { text: 'Looks good' });
  await c.evaluate('window.reply = document.getElementById("reply"); window.update(); window.update()');
  assert.deepEqual(await c.evaluate("({ same: document.activeElement === window.reply, value: window.reply.value, side: document.querySelector('#side p').textContent })"), { same: true, value: 'Looks good', side: 'reply card 6' }, 'the reply card waits');
  await c.evaluate('window.reply.blur()'); await sleep(50);
  assert.equal(await c.evaluate("document.querySelector('#side p').textContent"), 'reply card 8', 'applied after the field let go');
  // Send: the pointer goes down, an update arrives, the pointer comes up: one click, one submission
  const box = await c.evaluate("(() => { const r = document.getElementById('send').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()");
  const mouse = (type) => c.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await mouse('mousePressed');
  await c.evaluate('window.update(); window.update()');
  await mouse('mouseReleased');
  await sleep(30);
  assert.equal(await c.evaluate('window.sent'), 1, 'the click arrived');
  // a second click and Ctrl+Enter while it runs: nothing more
  await mouse('mousePressed'); await mouse('mouseReleased');
  await c.evaluate('window.ta.focus()');
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 2 });
  await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 2 });
  assert.equal(await c.evaluate("document.getElementById('send').disabled && document.getElementById('send').classList.contains('busy')"), true, 'a spinner, disabled');
  await sleep(600);
  assert.equal(await c.evaluate('window.sent'), 1, 'still one');
  assert.equal(await c.evaluate("document.getElementById('send').disabled"), false, 'enabled again once it settled');
  assert.deepEqual(c.logs, [], 'no page errors');
});
