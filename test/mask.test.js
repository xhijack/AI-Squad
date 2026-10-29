// SPDX-License-Identifier: Apache-2.0
// Masking an integration's secrets (1.6.1): keys in URL paths and query values, credential-named parameters,
// userinfo, UUIDs and JWTs are masked; ordinary paths stay readable; text that echoes a URL or a key is scrubbed;
// the MCP client's errors never carry the URL's key out. No real ~/.claude.json, no network beyond 127.0.0.1.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import * as mask from '../server/mask.js';
import * as mcp from '../server/mcp.js';
import { fakeMcpHttp } from './fixtures/fake-mcp-http.js';

const KEY = '9f86d081884c7d659a2feaa0c55ad015a1b2';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvd25lciJ9.c2lnbmF0dXJlLXZhbHVl';
const H = fakeMcpHttp({ mode: 'echo' });
const base = await H.listen();
after(() => H.close());

test('keys in a URL: path segments, query values, credential-named parameters, userinfo, UUIDs, JWTs', () => {
  assert.equal(mask.maskUrl(`https://postiz.sopwer.net/api/mcp/${KEY}`), 'https://postiz.sopwer.net/api/mcp/••••a1b2');
  assert.equal(mask.maskUrl('https://x.io/mcp/3f2b8c1e-9d4a-4f6b-8e2a-1c5d7e9f0a1b/sse'), 'https://x.io/mcp/••••0a1b/sse', 'a UUID');
  assert.equal(mask.maskUrl(`https://x.io/t/${JWT}`), 'https://x.io/t/••••bHVl', 'a JWT');
  assert.equal(mask.maskUrl('https://x.io/mcp?api_key=abc&sig=zz&token=t0k&team=marketing'), 'https://x.io/mcp?api_key=••••&sig=••••&token=••••&team=marketing', 'named like a key, however short');
  assert.equal(mask.maskUrl(`https://x.io/mcp?id=${KEY}`), 'https://x.io/mcp?id=••••a1b2', 'a key-like value under an innocent name');
  assert.equal(mask.maskUrl('https://ramdani:hunter2@x.io/mcp'), 'https://••••@x.io/mcp');
  assert.equal(mask.maskUrl(`https://${KEY}@x.io/mcp`), 'https://••••@x.io/mcp', 'a key as the user name');
  assert.equal(mask.maskUrl('https://x.io/mcp#frag'), 'https://x.io/mcp#…');
});

test('ordinary URLs stay readable; ${VAR} references are not secrets', () => {
  for (const u of ['https://x.io/api/mcp', 'http://127.0.0.1:8197/v1/sse', 'https://mcp.example.com/mcp?team=marketing&limit=20', 'https://x.io/api/v2/streamable-http',
    'https://x.io/mcp/${POSTIZ_KEY}', '${AISQUAD_ERP_URL}/api/method/frappe_assistant_core.api.fac_endpoint.handle_mcp']) assert.equal(mask.maskUrl(u), u);
  assert.equal(mask.looksLikeKey('frappe_assistant_core'), false);
  assert.equal(mask.looksLikeKey('streamable-http-endpoint'), false);
});

test('scrub: a text that echoes the URL or a key, and every string of a result', () => {
  const def = { url: `https://postiz.sopwer.net/api/mcp/${KEY}`, headers: { Authorization: 'Bearer pz_live_9f8e7d6c5b4a39281706' }, env: { DB_PASSWORD: 'hunter2hunter2' }, args: ['--token', 'abcd1234efgh5678'] };
  const s = mask.scrub(`404 for https://postiz.sopwer.net/api/mcp/${KEY} (key ${KEY}, auth Bearer pz_live_9f8e7d6c5b4a39281706, pw hunter2hunter2, t abcd1234efgh5678)`, def);
  for (const x of [KEY, 'pz_live_9f8e7d6c5b4a39281706', 'hunter2hunter2', 'abcd1234efgh5678']) assert.ok(!s.includes(x), `${x} gone from: ${s}`);
  assert.match(s, /postiz\.sopwer\.net\/api\/mcp\/••••a1b2/);
  assert.match(mask.scrub('see https://other.io/x?access_token=qq', {}), /access_token=••••/, 'any URL in the text');
  assert.deepEqual(mask.scrubDeep({ n: 4, items: [{ text: `called /api/mcp/${KEY}` }] }, def), { n: 4, items: [{ text: 'called /api/mcp/••••a1b2' }] });
  assert.deepEqual(mask.maskArgs(['mcp-remote', `https://x.io/mcp/${KEY}`, `--url=https://x.io/mcp?key=k`]), ['mcp-remote', 'https://x.io/mcp/••••a1b2', '--url=https://x.io/mcp?key=••••']);
});

test('the MCP client\'s errors never carry the URL\'s key, even when the server echoes the URL', async () => {
  const def = { transport: 'http', url: `${base}/${KEY}?api_key=s3cr3tvalue`, headers: {} };
  await assert.rejects(mcp.listTools('m1', def), (e) => {
    assert.match(e.message, /HTTP 404: No MCP endpoint at/);
    assert.ok(!e.message.includes(KEY) && !e.message.includes('s3cr3tvalue'), e.message);
    assert.match(e.message, /••••a1b2\?api_key=••••/);
    return true;
  });
  await assert.rejects(mcp.listTools('m2', { transport: 'http', url: `http://127.0.0.1:9/mcp/${KEY}` }), (e) => !e.message.includes(KEY));
});
