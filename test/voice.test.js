// Voices: the key never leaves the server, spoken text, cache, budget, fallbacks, with a mocked ElevenLabs API.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratch } from './helpers.js';
import { config } from '../server/config.js';
import * as voice from '../server/voice.js';

scratch({ seed: false });
const KEY = 'sk_test_0123456789abcdefWXYZ';
delete process.env.ELEVENLABS_API_KEY;
const calls = [];
voice.setFetch(async (url, init = {}) => {
  calls.push({ url, init });
  if (url.endsWith('/voices')) return new Response(JSON.stringify({ voices: [{ voice_id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', preview_url: 'https://x/p.mp3', labels: { accent: 'american' }, category: 'premade' }] }), { status: 200 });
  if (/text-to-speech\/bad0000000000voice/.test(url)) return new Response('nope', { status: 401 });
  return new Response(Buffer.from(`MP3:${JSON.parse(init.body).text}`), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
});
after(() => voice.setFetch(null));

test('the key: stored 0600, the UI only learns "set" and the last 4 characters', () => {
  assert.deepEqual(voice.keyStatus(), { set: false, last4: '', source: '' });
  assert.throws(() => voice.setKey('short'), /does not look like/);
  assert.deepEqual(voice.setKey(`  ${KEY}  `), { set: true, last4: 'WXYZ', source: 'settings' });
  const f = path.join(config.home, 'secrets.json');
  assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  assert.ok(!JSON.stringify(voice.keyStatus()).includes(KEY.slice(0, -4)), 'never the key itself');
  process.env.ELEVENLABS_API_KEY = 'env_key_0123456789ABCD';
  assert.equal(voice.keyStatus().source, 'environment', 'the service environment wins');
  delete process.env.ELEVENLABS_API_KEY;
});

test('spoken text: headline and up to two sentences, no markdown, code, tables or links', () => {
  const t = voice.spokenText('## Server inventory done\n\nThe server is **shared** with 6 apps. Nothing was changed. Free ports are 8300-8399. More later.\n\n| a | b |\n|---|---|\n\n```\nrm -rf /\n```\nSee https://docs.netlify.com for details.');
  assert.equal(t, 'Server inventory done. The server is shared with 6 apps. Nothing was changed.');
  assert.equal(voice.spokenText('Bolehkah saya mulai dengan sisi server saja?'), 'Bolehkah saya mulai dengan sisi server saja?');
  assert.ok(voice.spokenText('x'.repeat(500)).length <= 240);
});

test('speak: the key goes only in a header, audio is cached, usage counted, secrets are not said', async () => {
  const s = { ...voice.DEFAULTS, budgetChars: 1000 };
  const r = await voice.speak({ text: 'Deploy done. DB_PASSWORD=hunter2 is set.', voice: '21m00Tcm4TlvDq8ikWAM', settings: s });
  assert.equal(r.cached, false); assert.match(r.audio.toString(), /^MP3:Deploy done\./);
  assert.doesNotMatch(r.text, /hunter2/, 'redacted before speaking');
  const c = calls.at(-1);
  assert.match(c.url, /\/text-to-speech\/21m00Tcm4TlvDq8ikWAM\?output_format=mp3/);
  assert.equal(c.init.headers['xi-api-key'], KEY); assert.ok(!c.url.includes(KEY) && !c.init.body.includes(KEY));
  assert.equal(JSON.parse(c.init.body).model_id, 'eleven_flash_v2_5');
  const n = calls.length;
  const again = await voice.speak({ text: 'Deploy done. DB_PASSWORD=hunter2 is set.', voice: '21m00Tcm4TlvDq8ikWAM', settings: s });
  assert.equal(again.cached, true); assert.equal(calls.length, n, 'no second call');
  assert.deepEqual([voice.usage().calls, voice.usage().cached], [1, 1]);
  assert.equal(voice.usage().chars, r.chars);
});

test('fallbacks: over budget, no key, an API error (without the key in it)', async () => {
  const over = await voice.speak({ text: 'A long enough sentence to go over the budget.', settings: { ...voice.DEFAULTS, budgetChars: 10 } });
  assert.equal(over.fallback, 'browser'); assert.match(over.reason, /budget of 10 characters/); assert.match(over.text, /^A long enough/);
  const err = await voice.speak({ text: 'Hello there.', voice: 'bad0000000000voice', settings: voice.DEFAULTS });
  assert.equal(err.fallback, 'browser'); assert.match(err.reason, /401/); assert.ok(!err.reason.includes(KEY));
  voice.clearKey();
  assert.deepEqual(voice.keyStatus(), { set: false, last4: '', source: '' });
  const none = await voice.speak({ text: 'Hello there.' });
  assert.deepEqual([none.fallback, none.reason], ['browser', 'no ElevenLabs key']);
  voice.setKey(KEY);
});

test('voices list, voice per agent, quiet hours, settings', async () => {
  assert.deepEqual(await voice.voices({ fresh: true }), [{ id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', preview: 'https://x/p.mp3', labels: { accent: 'american' }, category: 'premade' }]);
  assert.equal(voice.voiceFor({ voice: 'AZnzlk1XvdvUeBnXmlld' }), 'AZnzlk1XvdvUeBnXmlld');
  assert.equal(voice.voiceFor({ role: { template: 'qa-engineer' } }), 'EXAVITQu4vr4xnSDxMaL');
  assert.equal(voice.voiceFor({ lead: true, role: { template: 'x' } }), voice.ROLE_VOICES.lead);
  assert.equal(voice.voiceFor({ voice: '<bad>' }), voice.DEFAULT_VOICE);
  const night = { quietFrom: '22:00', quietTo: '07:00' };
  assert.equal(voice.quietNow(night, new Date(2026, 9, 26, 23, 30)), true); assert.equal(voice.quietNow(night, new Date(2026, 9, 26, 12, 0)), false);
  assert.equal(voice.quietNow({}, new Date()), false);
  assert.deepEqual(voice.cleanSettings({ model: 'x', budgetChars: '-5', quietFrom: '25:00', mutedFloors: ['shop', '../x'] }), { model: 'eleven_flash_v2_5', budgetChars: 0, quietFrom: '', quietTo: '', onlyVisible: true, mutedFloors: ['shop'] });
});
