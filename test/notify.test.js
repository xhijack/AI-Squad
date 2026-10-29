// SPDX-License-Identifier: Apache-2.0
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { scratch } from './helpers.js';
import { configure, config } from '../server/config.js';
import * as notify from '../server/notify.js';
import * as tg from '../server/telegram.js';
import * as users from '../server/users.js';
import * as building from '../server/building.js';
import * as floors from '../server/floors.js';
import { loadPin } from '../server/pin.js';
import * as access from '../server/access.js';
import * as squadLog from '../server/log.js';

const root = scratch();
// a fake Bot API: records every call, answers like Telegram
const calls = [];
let nextUpdates = [];
const fake = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
    const method = req.url.split('/').pop(), b = body ? JSON.parse(body) : {};
    calls.push({ method, body: b, token: req.url.split('/')[1] });
    const result = method === 'getMe' ? { username: 'sopwer_squad_bot' } : method === 'sendMessage' ? { message_id: calls.length } : method === 'getUpdates' ? nextUpdates.splice(0) : true;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(req.url.includes('bad') ? { ok: false, error_code: 401, description: 'Unauthorized' } : { ok: true, result }));
  });
});
await new Promise((ok) => fake.listen(0, '127.0.0.1', ok));
configure({ telegramApi: `http://127.0.0.1:${fake.address().port}` });
after(() => { notify.stop(); fake.close(); });
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw1';
const sent = () => calls.filter((c) => c.method === 'sendMessage');
const lastText = () => sent().at(-1)?.body.text;
const ownerPin = loadPin();
const T = new Date(2026, 9, 27, 10, 0).getTime();
const msg = (chatId, text, from = { first_name: 'Ramdani' }) => ({ update_id: 1, message: { chat: { id: chatId }, text, from } });
const press = (chatId, data, messageId = 1) => ({ update_id: 2, callback_query: { id: 'cb1', data, message: { chat: { id: chatId }, message_id: messageId } } });
const question = { id: 'q1', kind: 'question', floorId: 'pos', floorName: 'POS', agentId: 'rina', agentName: 'Rina - PM', text: 'Which database for the catalogue?', options: [{ n: 1, label: 'Postgres (Recommended)' }, { n: 2, label: 'MariaDB' }, { n: 3, label: 'Type something', free: true }] };
const money = { id: 'q2', kind: 'question', floorId: 'pos', floorName: 'POS', agentId: 'rina', agentName: 'Rina - PM', text: 'Set the price of the Pro plan to Rp 499.000 per month?', options: [{ n: 1, label: 'Yes' }, { n: 2, label: 'No' }] };
let items = [], answered = [];
notify.deps.items = () => items;
notify.deps.answer = async (id, option, text, where) => { if (id === 'gone') throw Object.assign(new Error('Already answered'), { status: 409 }); answered.push({ id, option, text, where }); return { ok: true }; };

test('the adapter: token shape, buttons within 64 bytes, errors carry Telegram\'s words', async () => {
  assert.equal(tg.validToken(TOKEN), true); assert.equal(tg.validToken('abc'), false);
  assert.deepEqual(tg.keyboard([[{ text: 'Yes', data: 'a:abc:1' }, { text: 'Open', url: 'https://x' }]]), { inline_keyboard: [[{ text: 'Yes', callback_data: 'a:abc:1' }, { text: 'Open', url: 'https://x' }]] });
  assert.throws(() => tg.keyboard([[{ text: 'x', data: 'y'.repeat(65) }]]), /64 bytes/);
  await assert.rejects(tg.getMe('1:bad'), /Unauthorized/);
  assert.equal(access.requiredRole('PUT', '/api/notify/telegram/token'), 'owner');
  assert.equal(access.requiredRole('GET', '/api/notify'), 'owner');
  assert.equal(access.requiredRole('POST', '/api/notify/pair'), 'member', 'a member pairs their own chat');
  assert.equal(access.requiredRole('POST', '/api/insights/i-1/accept'), 'owner');
});

test('the bot token is write-only and checked with getMe; settings are cleaned', async () => {
  await assert.rejects(notify.setToken('nope'), /does not look like a Telegram bot token/);
  const st = await notify.setToken(TOKEN);
  assert.deepEqual([st.set, st.last4, st.bot], [true, 'saw1', 'sopwer_squad_bot']);
  assert.ok(!JSON.stringify(notify.status()).includes(TOKEN), 'the status never shows the token');
  assert.equal((fs.statSync(path.join(config.home, 'secrets.json')).mode & 0o777), 0o600);
  assert.deepEqual(notify.cleanNotify({ quiet: { from: '25:00' }, maxPerHour: 0, lang: 'id' }).quiet, { enabled: true, from: '22:00', to: '07:00' });
  assert.throws(() => notify.cleanNotify({ publicUrl: 'javascript:alert(1)' }), /http/);
  building.setPrefs({ notify: notify.cleanNotify({ enabled: true, quiet: { enabled: true, from: '22:00', to: '07:00' }, digestAt: '07:30', publicUrl: 'https://squad.sopwer.id' }) });
});

test('pairing: a one-time code from the UI; strangers and wrong codes get nothing', async () => {
  const owner = users.identify(ownerPin, ownerPin);
  const p = notify.newPairing(owner, T);
  assert.match(p.code, /^\d{6}$/); assert.equal(p.bot, 'sopwer_squad_bot');
  await notify.handleUpdate(msg(555, '/status'), { now: T });
  assert.equal(sent().length, 0, 'an unpaired chat is ignored');
  await notify.handleUpdate(msg(555, '/start 000000'), { now: T });
  assert.match(lastText(), /pairing code is wrong or expired/);
  await notify.handleUpdate(msg(555, `/start ${p.code}`), { now: T });
  assert.match(lastText(), /^Paired with The AI Squad as Owner \(owner\)/);
  assert.deepEqual(notify.status().chats.map((c) => [c.chatId, c.user]), [[555, 'Owner']]);
  await notify.handleUpdate(msg(777, `/start ${p.code}`), { now: T });
  assert.match(lastText(), /wrong or expired/, 'a code works once');
});

test('a question goes out at once with its options as buttons; the rest waits for the digest; quiet hours hold', async () => {
  items = [question, { id: 'f1', kind: 'finished', floorId: 'pos', floorName: 'POS', agentId: 'budi', agentName: 'Budi - Dev', text: 'Catalogue page done, tests green.' }];
  const before = sent().length;
  const night = new Date(2026, 9, 27, 23, 0).getTime();
  assert.equal((await notify.notifyTick(night)).sent, 0, 'quiet hours');
  const r = await notify.notifyTick(T);
  assert.equal(r.sent, 1); assert.equal(r.digest, 1, 'the first tick after 07:30 also brings the digest');
  const m = sent().find((c) => /^\[Question\]/.test(c.body.text)).body;
  assert.equal(m.chat_id, 555);
  assert.match(m.text, /^\[Question\] POS · Rina - PM\nWhich database for the catalogue\?\n\n1\. Postgres \(Recommended\)\n2\. MariaDB$/);
  const kb = m.reply_markup.inline_keyboard;
  assert.deepEqual(kb[0].map((b) => b.text), ['1. Postgres (Recommended)', '2. MariaDB']);
  assert.deepEqual(kb[1].map((b) => b.text), ['Reply', 'Open'], 'a dialog is answered, not dismissed');
  assert.equal(kb[1][1].url, 'https://squad.sopwer.id/#/floor/pos/agent/rina');
  assert.equal(sent().length, before + 2, 'the finished report is only in the digest');
  assert.match(lastText(), /^Summary for 2026-10-27\n\nWaiting for you \(2\):/);
  assert.equal((await notify.notifyTick(T + 1000)).sent, 0, 'sent once');
});

test('a button answers through the same path as the browser, as the paired person; answered elsewhere takes the buttons off', async () => {
  const tok = notify.loadState().sent.q1.tok;
  await notify.handleUpdate(press(555, `a:${tok}:1`), { now: T });
  assert.deepEqual(answered.at(-1), { id: 'q1', option: 1, text: '', where: { floorId: 'pos', agentId: 'rina', kind: 'question' } });
  assert.equal(lastText(), 'Done: Postgres (Recommended)');
  items = [];
  const r = await notify.notifyTick(T + 2000);
  assert.equal(r.cleared, 1);
  assert.equal(calls.at(-1).method, 'editMessageReplyMarkup');
});

test('a hard stop (money) needs a 4-digit code; anything else cancels', async () => {
  items = [money];
  await notify.notifyTick(T + 3000);
  assert.match(lastText(), /Hard stop: money/);
  const tok = notify.loadState().sent.q2.tok;
  const n = answered.length;
  await notify.handleUpdate(press(555, `a:${tok}:1`), { now: T });
  const code = lastText().match(/Type (\d{4}) within 5 minutes to confirm "Yes"/)?.[1];
  assert.ok(code, lastText());
  await notify.handleUpdate(msg(555, '1234' === code ? '9999' : '1234'), { now: T });
  assert.equal(lastText(), 'Cancelled: nothing was sent.'); assert.equal(answered.length, n);
  await notify.handleUpdate(press(555, `a:${tok}:1`), { now: T });
  const code2 = lastText().match(/Type (\d{4})/)[1];
  await notify.handleUpdate(msg(555, code2), { now: T });
  assert.equal(answered.length, n + 1); assert.equal(lastText(), 'Done: Yes');
});

test('the same question under a new id (the screen, then the hook) is one Telegram message', async () => {
  const q = { ...question, text: 'Which payment gateway for the shop?' };
  items = [{ ...q, id: 'dup-a' }];
  const n = sent().length;
  await notify.notifyTick(T + 6000);
  assert.equal(sent().length, n + 1);
  items = [{ ...q, id: 'dup-b' }];
  await notify.notifyTick(T + 9000);
  assert.equal(sent().length, n + 1, 'not again');
  assert.ok(notify.loadState().sent['dup-b'].duplicate);
  items = [];
});

test('a stall notice reaches Telegram only once it has lasted 15 minutes, even when stalls are sent at once', async () => {
  const prev = building.loadBuilding().prefs.notify;
  building.setPrefs({ notify: notify.cleanNotify({ ...prev, immediate: [...notify.IMMEDIATE, 'stall'] }) });
  try {
    items = [{ id: 'st1', kind: 'stall', notice: true, muted: true, notifyAt: T + 15 * 60e3, floorId: 'pos', floorName: 'POS', agentId: 'budi', text: 'Budi - Dev: "build" has written no output for 11 min' }];
    const n = sent().length;
    await notify.notifyTick(T + 60e3);
    assert.equal(sent().length, n); assert.equal(notify.loadState().sent.st1, undefined, 'not marked: it may still be sent later');
    await notify.notifyTick(T + 16 * 60e3);
    assert.equal(sent().length, n + 1); assert.match(lastText(), /written no output/);
  } finally { building.setPrefs({ notify: prev }); items = []; }
});

test('reply by text, an item that moved on, a viewer who can only read, and expired buttons', async () => {
  items = [{ id: 'gone', kind: 'reply', floorId: 'pos', floorName: 'POS', agentId: 'budi', agentName: 'Budi - Dev', text: 'Should I also add the wishlist?' }];
  await notify.notifyTick(T + 4000);
  const tok = notify.loadState().sent.gone.tok;
  await notify.handleUpdate(press(555, `r:${tok}`), { now: T });
  assert.equal(lastText(), 'Type your reply to Budi - Dev.');
  await notify.handleUpdate(msg(555, 'Not yet, next sprint'), { now: T });
  assert.equal(lastText(), 'Already answered or no longer open.');
  const v = users.addUser({ name: 'Vino', role: 'viewer' }, ownerPin);
  const p = notify.newPairing(v.user, T);
  await notify.handleUpdate(msg(901, `/start ${p.code}`), { now: T });
  await notify.handleUpdate(press(901, `r:${tok}`), { now: T });
  assert.equal(calls.at(-1).method, 'answerCallbackQuery'); assert.match(calls.at(-1).body.text, /can only read/);
  await notify.handleUpdate(press(555, 'a:deadbeef00:1'), { now: T });
  assert.match(calls.at(-1).body.text, /expired/);
});

test('/chat talks to an agent by name; its answer comes back; Owner-only Spaces stay hidden from members', async () => {
  const sales = path.join(root, 'projects', 'sales'), legal = path.join(root, 'projects', 'legal');
  await floors.createFloor({ name: 'Sales', directory: { mode: 'new', path: sales }, team: [{ displayName: 'Rudi - Researcher', template: 'lead-researcher' }] });
  await floors.createFloor({ name: 'Legal', directory: { mode: 'new', path: legal }, team: [{ displayName: 'Lina - Legal Counsel', template: 'lead-researcher' }] });
  const legalId = building.loadBuilding().floors.find((f) => f.path === legal).id;
  floors.updateFloorConfig(legal, { access: 'owner' });
  const chats = [];
  notify.deps.chat = async (floorId, agentId, text, o) => { chats.push({ floorId, agentId, text, user: o.user.name }); return { ok: true, delivery: 'job' }; };
  await notify.handleUpdate(msg(555, '/chat rudi'), { now: T });
  assert.equal(lastText(), 'Chatting with Rudi - Researcher in Sales. Type your message; /end stops.');
  await notify.handleUpdate(msg(555, 'Find three coffee chains in Bandung'), { now: T });
  assert.deepEqual(chats.at(-1), { floorId: building.loadBuilding().floors.find((f) => f.path === sales).id, agentId: 'rudi-researcher', text: 'Find three coffee chains in Bandung', user: 'Owner' });
  assert.equal(lastText(), 'Sent to Rudi - Researcher.');
  assert.equal(await notify.forwardChatReply({ floorId: chats.at(-1).floorId, agentId: 'rudi-researcher', agentName: 'Rudi - Researcher', text: 'Kopi Kenangan, Fore, Janji Jiwa.' }), 1);
  assert.equal(lastText(), 'Rudi - Researcher: Kopi Kenangan, Fore, Janji Jiwa.');
  await notify.handleUpdate(msg(555, '/end'), { now: T });
  // a member does not find the Owner-only Legal Space
  const d = users.addUser({ name: 'Dewi', role: 'member' }, ownerPin);
  const p = notify.newPairing(d.user, T);
  await notify.handleUpdate(msg(902, `/start ${p.code}`), { now: T });
  await notify.handleUpdate(msg(902, '/chat lina'), { now: T });
  assert.equal(lastText(), 'No agent called "lina". Try its name or id.');
  const n = sent().length;
  items = [{ ...question, id: 'legal1', floorId: legalId, floorName: 'Legal' }];
  await notify.notifyTick(T + 5000);
  assert.deepEqual(sent().slice(n).map((c) => c.body.chat_id), [555], 'only the Owner hears of an Owner-only Space');
});

test('the digest: what still waits, the last day, in the chosen language', async () => {
  items = [question];
  const owner = users.identify(ownerPin, ownerPin);
  const d = notify.digestFor(owner, { items, now: T, lang: 'id' });
  assert.match(d, /^Ringkasan 2026-10-27\n\nMenunggumu \(1\):\n- POS · Rina - PM: Which database/);
  assert.match(d, /24 jam terakhir: 0 job latar belakang selesai/);
  assert.equal(notify.inQuiet({ enabled: true, from: '22:00', to: '07:00' }, new Date(2026, 9, 27, 6, 59).getTime()), true);
  assert.equal(notify.inQuiet({ enabled: true, from: '22:00', to: '07:00' }, new Date(2026, 9, 27, 7, 0).getTime()), false);
  // once a day after the digest time, outside the quiet hours
  const n = sent().length;
  const morning = new Date(2026, 9, 28, 7, 45).getTime();
  const r = await notify.notifyTick(morning);
  assert.equal(r.digest, 3, 'one per paired chat');
  assert.equal((await notify.notifyTick(morning + 60e3)).digest, 0);
  assert.ok(sent().slice(n).some((c) => /^Summary for 2026-10-28/.test(c.body.text)));
});

test('cadence and targets that act (1.5): a recovery plan arrives with Approve / Dismiss; the digest counts routines and triggered targets', async () => {
  const plan = { id: '5e1c0a9b7d2f', kind: 'target-plan', floorId: building.loadBuilding().floors.find((f) => f.path.endsWith('sales')).id, floorName: 'Sales', agentId: 'rudi', agentName: 'Rudi - Researcher',
    text: 'Leads this week: 4 of 12 leads, behind\n\nRecovery plan:\n1. Call the ten warmest leads.', options: [{ n: 1, label: 'Approve' }, { n: 2, label: 'Dismiss' }] };
  items = [plan];
  const day = new Date(2026, 9, 28, 11, 0).getTime();
  assert.equal((await notify.notifyTick(day)).sent > 0, true, 'at once, not in the digest');
  const m = sent().find((c) => /^\[Target behind: plan to approve\] Sales · Rudi - Researcher/.test(c.body.text)).body;
  const kb = m.reply_markup.inline_keyboard;
  assert.deepEqual(kb[0].map((b) => b.text), ['1. Approve', '2. Dismiss']);
  assert.ok(!kb.flat().some((b) => b.text === 'Reply' || b.text === 'Dismiss'), 'no free reply, no second Dismiss');
  await notify.handleUpdate(press(555, kb[0][0].callback_data), { now: day });
  assert.deepEqual(answered.at(-1), { id: plan.id, option: 1, text: '', where: { floorId: plan.floorId, agentId: 'rudi', kind: 'target-plan' } });
  // the digest
  const fid = plan.floorId, at = day - 3600e3;
  squadLog.append(fid, { type: 'cadence.done', ts: at, data: { routine: 'follow-up-list', title: 'Follow-up list', status: 'done', cost: 0.2, ms: 9000 } });
  squadLog.append(fid, { type: 'cadence.done', ts: at, data: { routine: 'follow-up-list', title: 'Follow-up list', status: 'failed', cost: 0.1, ms: 3000 } });
  squadLog.append(fid, { type: 'cadence.skipped', ts: at, data: { routine: 'weekly', title: 'Weekly', reason: 'outside the Space\'s shift' } });
  squadLog.append(fid, { type: 'kpi.behind', ts: at, data: { kpi: 'leads', name: 'Leads', value: 4, target: 12, mode: 'suggest' } });
  const owner = users.identify(ownerPin, ownerPin);
  const d = notify.digestFor(owner, { items: [], now: day, lang: 'en' });
  assert.match(d, /Routines today: 1 done, 1 failed, 1 skipped\./);
  assert.match(d, /Targets that raised work:\n- Sales · Leads: a plan to approve/);
  assert.match(notify.digestFor(owner, { items: [], now: day, lang: 'id' }), /Rutinitas hari ini: 1 selesai, 1 gagal, 1 dilewati\.\nTarget yang memicu pekerjaan:\n- Sales · Leads: rencana untuk disetujui/);
});
