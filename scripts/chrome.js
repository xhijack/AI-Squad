// SPDX-License-Identifier: Apache-2.0
// Headless Chrome over the DevTools protocol (no dependencies), shared by the dev scripts.
//   const c = await openChrome(); await c.send('Page.navigate', { url }); await c.evaluate('1 + 1'); c.close();
//   SHOT_OFFLINE=1 blocks every host but 127.0.0.1 (checks the UI works without a CDN)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function openChrome() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aisquad-chrome-'));
  const chrome = spawn(process.env.CHROME_BIN || 'google-chrome', ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--hide-scrollbars', '--mute-audio', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), ...(process.env.SHOT_OFFLINE ? ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'] : []), `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore', detached: true });
  let port;
  for (let i = 0; i < 100 && !port; i++) { await sleep(100); try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { /* starting */ } }
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let seq = 0;
  const pending = new Map();
  const logs = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') logs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  };
  await send('Page.enable'); await send('Runtime.enable');
  const close = async () => { ws.close(); try { process.kill(-chrome.pid, 'SIGKILL'); } catch { chrome.kill(); }   // the whole group: GPU and renderer processes too
    await sleep(300); fs.rmSync(profile, { recursive: true, force: true }); };
  return { send, evaluate, logs, close };
}
