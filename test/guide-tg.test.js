// SPDX-License-Identifier: Apache-2.0
// The Company Guide on Telegram (1.7) against a fake Bot API: /guide for the Owner only, one question per message
// with buttons, toggles edited in place, free text and numbers, Back, Cancel, resume, both languages, a change on
// the web seen on Telegram, the plan in plain words with Build only in the app.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { scratch } from './helpers.js';
import { configure } from '../server/config.js';
import * as notify from '../server/notify.js';
import * as guide from '../server/guide.js';
import * as gtg from '../server/guide-tg.js';
import * as users from '../server/users.js';
import * as building from '../server/building.js';
import { loadPin } from '../server/pin.js';

const root = scratch();
building.setPrefs({ squadsDir: path.join(root, 'squads') });
const calls = [];
const fake = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
    const method = req.url.split('/').pop(), b = body ? JSON.parse(body) : {};
    calls.push({ method, body: b });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, result: method === 'getMe' ? { username: 'sopwer_squad_bot' } : method === 'sendMessage' ? { message_id: calls.length } : true }));
  });
});
await new Promise((ok) => fake.listen(0, '127.0.0.1', ok));
configure({ telegramApi: `http://127.0.0.1:${fake.address().port}` });
after(() => { notify.stop(); fake.close(); });
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw1';
const T = new Date(2026, 9, 29, 10, 0).getTime();
const ownerPin = loadPin();
const msg = (chatId, text) => ({ update_id: 1, message: { chat: { id: chatId }, text, from: { first_name: 'Nanda' } } });
const press = (chatId, data, messageId = 7) => ({ update_id: 2, callback_query: { id: 'cb', data, message: { chat: { id: chatId }, message_id: messageId } } });
const sent = () => calls.filter((c) => c.method === 'sendMessage');
const last = () => sent().at(-1).body;
const buttons = (m = last()) => (m.reply_markup?.inline_keyboard || []).flat();
const data = (label, m = last()) => buttons(m).find((b) => b.text === label || b.text.endsWith(label))?.callback_data;
const say = (text) => notify.handleUpdate(msg(555, text), { now: T });
const tap = async (label, m = last()) => { const d = data(label, m); assert.ok(d, `a button "${label}" in: ${m.text.slice(0, 80)}`); await notify.handleUpdate(press(555, d), { now: T }); };
guide.deps.ask = async () => { throw new Error('offline'); };          // the plan's defaults

test('pairing the Owner and a Member', async () => {
  await notify.setToken(TOKEN);
  building.setPrefs({ language: 'en', notify: notify.cleanNotify({ enabled: true, publicUrl: 'https://squad.sopwer.id' }) });
  const owner = users.identify(ownerPin, ownerPin);
  await notify.handleUpdate(msg(555, `/start ${notify.newPairing(owner, T).code}`), { now: T });
  const m = users.addUser({ name: 'Dewi', role: 'member' }, ownerPin);
  await notify.handleUpdate(msg(902, `/start ${notify.newPairing(m.user, T).code}`), { now: T });
  await say('/help');
  assert.match(last().text, /\/guide set up the company/);
  await notify.handleUpdate(msg(902, '/help'), { now: T });
  assert.doesNotMatch(last().text, /\/guide/, 'only the Owner is told about /guide');
});

test('a Member is refused politely, and so is a Member\'s button', async () => {
  await notify.handleUpdate(msg(902, '/guide'), { now: T });
  assert.match(last().text, /^The company guide is the Owner's/);
  assert.equal(last().chat_id, 902);
  await notify.handleUpdate(press(902, 'g:a:language:id'), { now: T });
  assert.match(last().text, /^The company guide is the Owner's/);
  assert.equal(guide.load().answers, null, 'nothing was answered');
});

test('the interview: one question per message, buttons, toggles, text, numbers, Back; the plan with Build in the app', async () => {
  await say('/guide');
  assert.match(sent().at(-2).body.text, /^The company guide: a few questions/);
  assert.match(last().text, /^Step 1\/7 · Language\n\nWhich language/);
  assert.deepEqual(buttons().map((b) => b.text), ['English', 'Bahasa Indonesia', 'Cancel'], 'no Back on the first question');
  assert.equal(guide.load().via, 'telegram');
  await tap('Bahasa Indonesia');
  assert.equal(building.loadBuilding().prefs.language, 'id', 'the language is saved for the app, the bot and the agents');
  assert.match(last().text, /^Langkah 2\/7 · Bisnismu\n\nApa bisnismu\?/);
  await tap('Produk SaaS');
  assert.match(last().text, /Nama perusahaan atau produknya\?[\s\S]*Ketik jawabanmu\./);
  assert.ok(!data('Lewati'), 'the name cannot be skipped');
  await say('');
  await say('Kasir');
  assert.match(last().text, /Dalam satu kalimat/);
  await tap('Lewati');
  // several choices: toggles edit the message in place, Done saves them
  assert.match(last().text, /Langkah 3\/7 · Tujuanmu/);
  const goals = last();
  assert.ok(!data('Lewati', goals), 'no Skip on a multi choice');
  await tap('Selesai ✓', goals);
  assert.equal(last().text, 'Pilih minimal satu.');
  await tap('Lead bertambah', goals);
  const edit = calls.filter((c) => c.method === 'editMessageText').at(-1).body;
  assert.equal(edit.message_id, 7);
  assert.ok(edit.reply_markup.inline_keyboard.flat().some((b) => b.text === '✓ Lead bertambah'));
  await notify.handleUpdate(press(555, 'g:t:picks:service'), { now: T });
  await tap('Selesai ✓', goals);
  assert.deepEqual(guide.load().answers.goals.picks, ['leads', 'service']);
  assert.match(last().text, /Berapa lead per bulan\?/);
  await say('lima puluh');
  assert.match(last().text, /^Itu bukan angka/);
  await say('50');
  assert.equal(guide.load().answers.goals.leads, 50);
  // Back: to the leads question again, the answer shown; then forward
  assert.match(last().text, /Langkah 4\/7 · Yang kamu punya/);
  await tap('« Kembali');
  assert.match(last().text, /Berapa lead per bulan\?\n\nSekarang: 50/);
  await say('60');
  const have = last();
  await notify.handleUpdate(press(555, 'g:t:have:erpnext'), { now: T });
  await notify.handleUpdate(press(555, 'g:t:have:website'), { now: T });
  await tap('Selesai ✓', have);
  assert.deepEqual(guide.load().answers.have, ['website', 'erpnext']);
  // divisions: the suggestion includes Support (saas) and Finance (ERPNext is there)
  assert.match(last().text, /Saran untukmu: Produk, Engineering, Marketing, Sales, Dukungan, Legal \(khusus Owner\), Keuangan \(khusus Owner\)\./);
  const div = last();
  await tap('Pakai saran', div);
  await notify.handleUpdate(press(555, 'g:t:divisions:product'), { now: T });
  await notify.handleUpdate(press(555, 'g:t:divisions:engineering'), { now: T });
  await notify.handleUpdate(press(555, 'g:t:divisions:legal'), { now: T });
  await tap('Selesai ✓', div);
  assert.deepEqual(guide.load().answers.divisions, ['marketing', 'sales', 'finance', 'support']);
  // one question per division for the mode
  for (const [d, mode] of [['Marketing', 'Otomatis'], ['Sales', 'Diawasi'], ['Keuangan', 'Manual'], ['Dukungan', 'Diawasi']]) {
    assert.match(last().text, new RegExp(`^Langkah 6/7 · Seberapa otomatis\\n\\n${d}`));
    await tap(mode);
  }
  assert.deepEqual(guide.load().answers.modes, { marketing: 'automatic', sales: 'supervised', finance: 'manual', support: 'supervised' });
  await tap('Mesin ini saja');
  await tap('Siang hari');
  // a stale button from an earlier question
  await notify.handleUpdate(press(555, 'g:a:type:retail'), { now: T });
  assert.equal(sent().at(-2).body.text, 'Pertanyaan ini sudah lewat; ini pertanyaan yang sekarang.');
  assert.match(last().text, /Anggaran AI per bulan/);
  assert.equal(guide.load().answers.business.type, 'saas', 'not changed by the stale button');
  await say('Rp 1.000');
  // the plan in plain words; Build only in the app
  assert.equal(sent().at(-2).body.text, 'Membuat rencana…');
  const plan = last();
  assert.match(plan.text, /^Rencana untuk Kasir\n/);
  assert.match(plan.text, /• Kasir Finance \(Manual, khusus Owner\)\n  Target: Overdue receivables; Cash in bank; Days to close the month 5 days; Unreconciled bank lines\n  Rutinitas: tidak ada\n  Yang dibutuhkan darimu: 3 hal/);
  assert.match(plan.text, /• Kasir Support \(Diawasi\)\n  Target: First response time 24 hours; Open tickets; Tickets resolved; Customer satisfaction 90 %\n  Rutinitas: Morning triage 08:00/);
  assert.match(plan.text, /Yang menunggumu: .*uang, kontrak, deploy ke production, rahasia dan menghapus data, di setiap Space/);
  assert.match(plan.text, /Anggaran AI: 1000 USD per bulan/);
  assert.match(plan.text, /Build hanya dari aplikasi[\s\S]*Tinjau dan bangun: https:\/\/squad\.sopwer\.id\/#\/guide$/);
  assert.deepEqual(buttons(plan).map((b) => b.url), ['https://squad.sopwer.id/#/guide']);
  assert.ok(!buttons(plan).some((b) => /build/i.test(b.text)), 'no Build button on Telegram');
  const st = guide.state();
  assert.deepEqual([st.step, st.done, st.via, st.plan.spaces.length], [7, false, 'telegram', 4], 'the web opens on the plan');
  assert.equal(building.loadBuilding().floors.filter((f) => !f.independent).length, 0, 'nothing was built');
  assert.equal(notify.loadState().pending[555], undefined, 'the chat is free again');
});

test('resume, a change on the web seen on Telegram, Cancel', async () => {
  guide.answer({ business: { ...guide.load().answers.business, name: 'Kasir Pintar' } }, 1, { via: 'web' });
  await say('/guide');
  assert.match(last().text, /^Terakhir kamu berhenti di: Bisnismu\. Lanjutkan/);
  await tap('Lanjutkan');
  assert.match(last().text, /Apa bisnismu\? Pilih yang paling mendekati\.\n\nSekarang: Produk SaaS/);
  await tap('Produk SaaS');
  assert.match(last().text, /Nama perusahaan atau produknya\?\n\nSekarang: Kasir Pintar/, 'the web\'s answer');
  await tap('Batal');
  assert.match(last().text, /^Dihentikan\. Jawabanmu tersimpan/);
  assert.equal(notify.loadState().pending[555], undefined);
  await say('Kasir Lagi');
  assert.match(last().text, /^Perintah:/, 'after Cancel, text is not an answer');
  assert.equal(guide.load().answers.business.name, 'Kasir Pintar');
  await say('/guide');
  await tap('Dari awal');
  assert.match(last().text, /^Langkah 1\/7 · Bahasa\n\nBahasa apa/);
  await tap('English');
  assert.match(last().text, /^Step 2\/7 · Your business\n\nWhat is your business\? Pick the closest\.\n\nNow: A SaaS product/, 'English from here on');
  await say('/cancel');
  assert.match(last().text, /^Stopped\. Your answers are saved/);
  assert.equal(guide.load().answers.business.name, 'Kasir Pintar');
});

test('the plan message in English, and numbers as owners type them', () => {
  const p = guide.draftPlan(guide.cleanAnswers({ language: 'en', business: { type: 'saas', name: 'Kasir' }, divisions: ['finance'], capacity: {} }));
  const text = gtg.planMessage(p, 'en', '');
  assert.match(text, /^The plan for Kasir\n\n• Kasir Finance \(Manual, Owner only\)/);
  assert.match(text, /Build happens only in the app[\s\S]*Open The AI Squad → Lobby → Set up the company/);
  for (const [s, n] of [['50', 50], ['30.000.000', 30000000], ['30,000,000', 30000000], ['2.5', 2.5], ['Rp 1.500', 1500], ['$ 100', 100], ['x', null], ['-3', null], ['', null]]) assert.equal(gtg.parseNumber(s), n, s);
});
