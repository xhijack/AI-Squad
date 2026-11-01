// SPDX-License-Identifier: Apache-2.0
// The Owner's second factor and security messages on Telegram (1.9), with a fake Bot API on 127.0.0.1: the code goes
// only to the Owner's paired chats, works once, expires, allows 5 tries; it is needed only in public mode for Owner
// sessions on owner-level routes; /unlock from the Owner's chat lifts the PIN lock, from anyone else it does not.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { scratch } from './helpers.js';
import { configure } from '../server/config.js';
import * as notify from '../server/notify.js';
import * as users from '../server/users.js';
import * as limits from '../server/limits.js';
import * as second from '../server/secondfactor.js';
import { loadPin } from '../server/pin.js';

scratch();
const calls = [];
const fake = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
    const method = req.url.split('/').pop();
    calls.push({ method, body: body ? JSON.parse(body) : {} });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, result: method === 'getMe' ? { username: 'squad_bot' } : method === 'sendMessage' ? { message_id: calls.length } : true }));
  });
});
await new Promise((ok) => fake.listen(0, '127.0.0.1', ok));
configure({ telegramApi: `http://127.0.0.1:${fake.address().port}` });
after(() => { notify.stop(); fake.close(); });
const sent = () => calls.filter((c) => c.method === 'sendMessage');
const T0 = Date.parse('2026-11-01T08:00:00Z');
const ownerPin = loadPin();
const msg = (chatId, text) => ({ update_id: 1, message: { chat: { id: chatId }, text, from: { first_name: 'X' } } });
const sendFn = (text) => notify.toOwner(text);

test('nothing paired: the second factor is off and a code cannot be sent', async () => {
  assert.equal(notify.ownerPaired(), false);
  assert.equal(second.enabled({ setting: undefined, paired: notify.ownerPaired() }), false);
  await assert.rejects(second.send('s1', { sendFn, now: T0 }), /pair the Owner's Telegram chat/);
});

test('pair the Owner and a member; codes reach only the Owner\'s chat', async () => {
  await notify.setToken('123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw1');
  const { code } = notify.newPairing(users.OWNER, T0);
  await notify.handleUpdate(msg(111, `/start ${code}`), { now: T0 });
  const m = users.addUser({ name: 'Rina', role: 'member' }, ownerPin);
  const p2 = notify.newPairing(m.user, T0);
  await notify.handleUpdate(msg(222, `/start ${p2.code}`), { now: T0 });
  assert.equal(notify.ownerPaired(), true);
  assert.equal(second.enabled({ setting: undefined, paired: true }), true);
  assert.equal(second.enabled({ setting: false, paired: true }), false, 'prefs.secondFactor false turns it off');
  const before = sent().length;
  await second.send('s1', { sendFn, now: T0 });
  const out = sent().slice(before);
  assert.equal(out.length, 1);
  assert.equal(out[0].body.chat_id, 111);
  const code6 = out[0].body.text.match(/\b(\d{6})\b/)[1];
  assert.equal(second.verify('s2', code6, T0 + 1000), false, 'another session cannot use it');
  assert.equal(second.verify('s1', code6, T0 + 1000), true);
  assert.equal(second.verify('s1', code6, T0 + 2000), false, 'only once');
});

test('codes expire after 5 minutes, allow 5 tries, and are not re-sent within 30 seconds', async () => {
  second.reset();
  await second.send('s3', { sendFn, now: T0 });
  const code = sent().at(-1).body.text.match(/\b(\d{6})\b/)[1];
  assert.equal(second.verify('s3', code, T0 + second.CODE_MS + 1), false);
  second.reset();
  const n = sent().length;
  await second.send('s4', { sendFn, now: T0 });
  assert.equal((await second.send('s4', { sendFn, now: T0 + 10e3 })).resent, false);
  assert.equal(sent().length, n + 1);
  const right = sent().at(-1).body.text.match(/\b(\d{6})\b/)[1];
  const wrong = right === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) assert.equal(second.verify('s4', wrong, T0 + 1000), false);
  assert.equal(second.verify('s4', right, T0 + 1000), false, 'after 5 wrong tries the code is gone');
});

test('needed only in public mode, for an Owner session, on owner-level routes, until passed', () => {
  const s = { secondAt: 0 }, owner = { role: 'owner' };
  assert.equal(second.needed({ isPublic: true, on: true, user: owner, need: 'owner', session: s }), true);
  assert.equal(second.needed({ isPublic: true, on: true, user: owner, need: 'viewer', ownerSpace: true, session: s }), true, 'an Owner-only Space');
  assert.equal(second.needed({ isPublic: true, on: true, user: owner, need: 'member', session: s }), false);
  assert.equal(second.needed({ isPublic: false, on: true, user: owner, need: 'owner', session: s }), false);
  assert.equal(second.needed({ isPublic: true, on: false, user: owner, need: 'owner', session: s }), false);
  assert.equal(second.needed({ isPublic: true, on: true, user: owner, need: 'owner', session: { secondAt: T0 } }), false);
  assert.equal(second.needed({ isPublic: true, on: true, user: owner, need: 'owner', session: null }), false, 'the PIN header of a local tool');
  assert.equal(second.needed({ isPublic: true, on: true, user: { role: 'member' }, need: 'owner', session: s }), false, 'refused by role anyway');
});

test('/unlock: the Owner\'s chat lifts the PIN lock; a member\'s chat cannot', async () => {
  for (let i = 0; i < limits.PER_DAY; i++) limits.fail(`198.51.100.${i}`, T0 + i);
  assert.equal(limits.status(T0).locked, true);
  await notify.handleUpdate(msg(222, '/unlock'), { now: T0 });
  assert.equal(limits.status(T0).locked, true);
  assert.match(sent().at(-1).body.text, /Only the Owner/);
  await notify.handleUpdate(msg(111, '/unlock'), { now: T0 });
  assert.equal(limits.status(T0).locked, false);
  assert.match(sent().at(-1).body.text, /unlocked again/);
  assert.match(notify.say('lockAccount', { fails: 20 }), /aisquad unlock/);
});
