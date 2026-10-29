// SPDX-License-Identifier: Apache-2.0
// The Company Guide on Telegram (1.7): /guide in the Owner's chat runs the same interview as the web, one question
// per message: inline buttons for choices (toggles and Done for several), free text where the web has a field, Back
// and Cancel on every question. The answers go through server/guide.js into ~/.aisquad/guide.json, so the web and
// Telegram share them: a change on one side is what the other side asks next. Where the chat is in the interview
// (the question, the toggles not saved yet) is the chat's pending state in notify.json. At the end the plan comes in
// plain words with a link to the app: Build happens only there (it makes repositories and Spaces and needs the PIN).
// Members and Viewers get a polite refusal. The language is the guide's answer, else the Building's.
import * as guide from './guide.js';
import * as building from './building.js';
import { oneLine } from './util.js';

const STEP_OF = { language: 0, business: 1, goals: 2, have: 3, divisions: 4, modes: 5, capacity: 6, plan: 7 };
const L = {
  en: {
    refuse: 'The company guide is the Owner\'s: it decides which squads the company has. Ask the Owner to run it, or open The AI Squad.',
    hello: 'The company guide: a few questions about your business, then a plan for your AI company. Nothing is built here: you review the plan and press Build in the app. Back and Cancel are under every question.',
    resume: 'You stopped at: {title}. Continue there, or go through the questions again (your answers are kept)?',
    again: 'The company is built. Run the guide again to add a division or change the goals: we start at the divisions.',
    continueBtn: 'Continue', restartBtn: 'From the start', backBtn: '« Back', cancelBtn: 'Cancel', skipBtn: 'Skip', doneBtn: 'Done ✓', suggestBtn: 'Use the suggestion',
    cancelled: 'Stopped. Your answers are saved; /guide continues where you left off, here or in the app.',
    now: 'Now: {v}', none: '–', typeIt: 'Type your answer.', typeNumber: 'Type a number, or Skip.', notNumber: 'That is not a number. Type a number like 50 or 30000000, or Skip.',
    needOne: 'Pick at least one.', needName: 'The name is needed: type it.', moved: 'This question has moved on; here is the current one.', makingPlan: 'Making the plan…',
    noPlan: 'The plan could not be made: {error}', step: 'Step {n}/7',
    planTitle: 'The plan for {name}', spaceLine: '{name} ({mode}{owner})', ownerOnly: ', Owner only', targets: 'Targets: {list}', noTargets: 'Targets: none yet',
    routines: 'Routines: {list} (made off; you turn them on)', noRoutines: 'Routines: none', materials: 'Needed from you: {n} item(s)',
    waits: 'What waits for you: {list}', hardStops: 'money, contracts, production deploys, secrets and deleting data, in every Space',
    later: 'Later: {list}', budget: 'AI budget: {usd} USD per month, split across the Spaces', summary: 'Summary: {text}',
    buildInApp: 'Build happens only in the app: it creates a repository and a Space per division and needs your PIN and a careful look. Review the plan there and press Build.',
    openLink: 'Review and build: {url}', openApp: 'Open The AI Squad → Lobby → Set up the company to review and build.', exists: 'already there',
    q: {
      language: 'Which language do you want to work in? The app, this bot and the agents use it.',
      type: 'What is your business? Pick the closest.', name: 'The company or product name?', description: 'In one sentence: what do you sell, and to whom?',
      picks: 'What should the company reach in the next 3 months? Pick one or two, then Done.', leads: 'How many leads per month?', revenue: 'Revenue per month ({currency})?', launch: 'What launches, and when?',
      have: 'What do you already have? Tick everything that exists, then Done. The rest becomes work for the squads.',
      divisions: 'Which divisions should run? Each becomes a Space with its own squad. Suggested for you: {list}.',
      mode: '{division}: how much should it do by itself? Money, contracts, production deploys, secrets and deleting data always wait for you.',
      machines: 'Machines?', hours: 'When should the squads work?', budget: 'AI budget per month in USD (split across the divisions)?',
    },
    type: { saas: 'A SaaS product', 'erp-consultant': 'ERPNext consulting', consultant: 'Consulting', 'software-house': 'Software house', agency: 'Agency', clinic: 'Clinic or practice', retail: 'Shop or retail', other: 'Something else' },
    goal: { revenue: 'More revenue', leads: 'More leads', launch: 'Launch a product', cost: 'Lower costs', service: 'Better service' },
    have: { products: 'Products with prices', brand: 'Brand rules', website: 'A website', social: 'Social media', erpnext: 'ERPNext', tools: 'Other tools', repos: 'Code repositories', team: 'People on the team', legal: 'Company documents' },
    division: { product: 'Product', engineering: 'Engineering', implementation: 'Implementation (ERPNext)', marketing: 'Marketing', sales: 'Sales', legal: 'Legal (Owner only)', finance: 'Finance (Owner only)', support: 'Support' },
    mode: { automatic: 'Automatic', supervised: 'Supervised', manual: 'Manual' },
    modeText: { automatic: 'routine work runs and ships by itself', supervised: 'the squad prepares, you approve what goes out', manual: 'the squad drafts only, you decide everything' },
    hours: { day: 'Daytime', night: 'At night (22:00–05:00)', always: 'Around the clock' },
    machines: { this: 'This machine only', more: 'More machines later' },
  },
  id: {
    refuse: 'Panduan perusahaan adalah milik Owner: di sinilah ditentukan squad apa saja yang dimiliki perusahaan. Minta Owner menjalankannya, atau buka The AI Squad.',
    hello: 'Panduan perusahaan: beberapa pertanyaan tentang bisnismu, lalu rencana untuk perusahaan AI-mu. Di sini tidak ada yang dibangun: kamu meninjau rencananya dan menekan Build di aplikasi. Kembali dan Batal ada di bawah setiap pertanyaan.',
    resume: 'Terakhir kamu berhenti di: {title}. Lanjutkan dari situ, atau ulangi pertanyaannya (jawabanmu tetap tersimpan)?',
    again: 'Perusahaan sudah dibangun. Jalankan panduan lagi untuk menambah divisi atau mengubah tujuan: kita mulai dari divisi.',
    continueBtn: 'Lanjutkan', restartBtn: 'Dari awal', backBtn: '« Kembali', cancelBtn: 'Batal', skipBtn: 'Lewati', doneBtn: 'Selesai ✓', suggestBtn: 'Pakai saran',
    cancelled: 'Dihentikan. Jawabanmu tersimpan; /guide melanjutkan dari titik terakhir, di sini atau di aplikasi.',
    now: 'Sekarang: {v}', none: '–', typeIt: 'Ketik jawabanmu.', typeNumber: 'Ketik angka, atau Lewati.', notNumber: 'Itu bukan angka. Ketik angka seperti 50 atau 30000000, atau Lewati.',
    needOne: 'Pilih minimal satu.', needName: 'Namanya perlu diisi: ketik namanya.', moved: 'Pertanyaan ini sudah lewat; ini pertanyaan yang sekarang.', makingPlan: 'Membuat rencana…',
    noPlan: 'Rencana tidak bisa dibuat: {error}', step: 'Langkah {n}/7',
    planTitle: 'Rencana untuk {name}', spaceLine: '{name} ({mode}{owner})', ownerOnly: ', khusus Owner', targets: 'Target: {list}', noTargets: 'Target: belum ada',
    routines: 'Rutinitas: {list} (dibuat mati; kamu yang menyalakan)', noRoutines: 'Rutinitas: tidak ada', materials: 'Yang dibutuhkan darimu: {n} hal',
    waits: 'Yang menunggumu: {list}', hardStops: 'uang, kontrak, deploy ke production, rahasia dan menghapus data, di setiap Space',
    later: 'Nanti: {list}', budget: 'Anggaran AI: {usd} USD per bulan, dibagi ke semua Space', summary: 'Ringkasan: {text}',
    buildInApp: 'Build hanya dari aplikasi: Build membuat repositori dan Space per divisi, dan butuh PIN-mu serta tinjauan yang teliti. Tinjau rencananya di sana lalu tekan Build.',
    openLink: 'Tinjau dan bangun: {url}', openApp: 'Buka The AI Squad → Lobi → Siapkan perusahaan untuk meninjau dan membangun.', exists: 'sudah ada',
    q: {
      language: 'Bahasa apa yang ingin kamu pakai? Aplikasi, bot ini dan para agent memakainya.',
      type: 'Apa bisnismu? Pilih yang paling mendekati.', name: 'Nama perusahaan atau produknya?', description: 'Dalam satu kalimat: apa yang kamu jual, dan kepada siapa?',
      picks: 'Apa yang harus dicapai perusahaan dalam 3 bulan ke depan? Pilih satu atau dua, lalu Selesai.', leads: 'Berapa lead per bulan?', revenue: 'Omzet per bulan ({currency})?', launch: 'Apa yang diluncurkan, dan kapan?',
      have: 'Apa yang sudah kamu punya? Centang semua yang sudah ada, lalu Selesai. Sisanya menjadi pekerjaan squad.',
      divisions: 'Divisi mana yang dijalankan? Setiap divisi menjadi Space dengan squad sendiri. Saran untukmu: {list}.',
      mode: '{division}: seberapa banyak yang dikerjakan sendiri? Uang, kontrak, deploy ke production, rahasia dan menghapus data selalu menunggumu.',
      machines: 'Mesin?', hours: 'Kapan squad bekerja?', budget: 'Anggaran AI per bulan dalam USD (dibagi ke semua divisi)?',
    },
    type: { saas: 'Produk SaaS', 'erp-consultant': 'Konsultan ERPNext', consultant: 'Konsultan', 'software-house': 'Software house', agency: 'Agensi', clinic: 'Klinik atau praktik', retail: 'Toko atau ritel', other: 'Lainnya' },
    goal: { revenue: 'Omzet naik', leads: 'Lead bertambah', launch: 'Meluncurkan produk', cost: 'Biaya turun', service: 'Layanan lebih baik' },
    have: { products: 'Produk dengan harga', brand: 'Aturan brand', website: 'Website', social: 'Media sosial', erpnext: 'ERPNext', tools: 'Tools lain', repos: 'Repositori kode', team: 'Orang di tim', legal: 'Dokumen perusahaan' },
    division: { product: 'Produk', engineering: 'Engineering', implementation: 'Implementasi (ERPNext)', marketing: 'Marketing', sales: 'Sales', legal: 'Legal (khusus Owner)', finance: 'Keuangan (khusus Owner)', support: 'Dukungan' },
    mode: { automatic: 'Otomatis', supervised: 'Diawasi', manual: 'Manual' },
    modeText: { automatic: 'pekerjaan rutin berjalan dan dikirim sendiri', supervised: 'squad menyiapkan, kamu menyetujui yang keluar', manual: 'squad hanya membuat draf, kamu yang memutuskan semuanya' },
    hours: { day: 'Siang hari', night: 'Malam hari (22:00–05:00)', always: 'Sepanjang waktu' },
    machines: { this: 'Mesin ini saja', more: 'Tambah mesin nanti' },
  },
};
const STEP_TITLE = { en: ['Language', 'Your business', 'Your goals', 'What you have', 'Divisions', 'How much runs by itself', 'Machine and budget', 'The plan'], id: ['Bahasa', 'Bisnismu', 'Tujuanmu', 'Yang kamu punya', 'Divisi', 'Seberapa otomatis', 'Mesin dan anggaran', 'Rencana'] };
const fill = (s, vars = {}) => String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));

// the owner's language: the guide's answer, else the Building's
export const langOf = (st = guide.load()) => (guide.LANGUAGES.includes(st.answers?.language) ? st.answers.language : building.loadBuilding().prefs.language === 'id' ? 'id' : 'en');
const answersOf = (st = guide.load()) => guide.cleanAnswers(st.answers || {});

// ---------- the questions, in order, for the answers so far ----------
export function questions(a) {
  const qs = [
    { id: 'language', step: 'language', kind: 'choice', options: guide.LANGUAGES },
    { id: 'type', step: 'business', kind: 'choice', options: guide.TYPES },
    { id: 'name', step: 'business', kind: 'text', required: true },
    { id: 'description', step: 'business', kind: 'text' },
    { id: 'picks', step: 'goals', kind: 'multi', options: guide.GOALS, min: 1 },
    ...['leads', 'revenue'].filter((g) => a.goals.picks.includes(g)).map((g) => ({ id: g, step: 'goals', kind: 'number' })),
    ...(a.goals.picks.includes('launch') ? [{ id: 'launch', step: 'goals', kind: 'text' }] : []),
    { id: 'have', step: 'have', kind: 'multi', options: guide.HAVE },
    { id: 'divisions', step: 'divisions', kind: 'multi', options: Object.keys(guide.DIVISIONS), min: 1 },
    ...a.divisions.filter((d) => guide.DIVISIONS[d]).map((d) => ({ id: `m.${d}`, step: 'modes', kind: 'choice', options: guide.MODES })),
    { id: 'machines', step: 'capacity', kind: 'choice', options: guide.MACHINES },
    { id: 'hours', step: 'capacity', kind: 'choice', options: guide.HOURS },
    { id: 'budget', step: 'capacity', kind: 'number' },
  ];
  return qs;
}
const find = (a, id) => questions(a).find((q) => q.id === id) || null;
// the value a question has now, and the answers with a new one
function valueOf(a, id) {
  if (id === 'language') return a.language;
  if (['type', 'name', 'description'].includes(id)) return a.business[id];
  if (['picks', 'leads', 'revenue', 'launch'].includes(id)) return a.goals[id];
  if (['have', 'divisions'].includes(id)) return a[id];
  if (id.startsWith('m.')) return a.modes[id.slice(2)];
  return a.capacity[id];
}
function patchOf(a, id, v) {
  if (id === 'language') return { language: v };
  if (['type', 'name', 'description'].includes(id)) return { business: { ...a.business, [id]: v } };
  if (['picks', 'leads', 'revenue', 'launch'].includes(id)) return { goals: { ...a.goals, [id]: v } };
  if (['have', 'divisions'].includes(id)) return { [id]: v };
  if (id.startsWith('m.')) return { modes: { ...a.modes, [id.slice(2)]: v } };
  return { capacity: { ...a.capacity, [id]: v } };
}
// "30.000.000", "30,000,000" and "2.5" as numbers
export function parseNumber(text) {
  const t = String(text || '').trim().replace(/[\s_]/g, '').replace(/^(rp|usd|\$|idr)/i, '').replace(/[.,](?=\d{3}(?:\D|$))/g, '').replace(',', '.');
  const n = Number(t);
  return t && Number.isFinite(n) && n >= 0 ? n : null;
}

// ---------- the messages ----------
const label = (lang, q, v) => {
  const T = L[lang];
  if (q.id === 'language') return v === 'id' ? 'Bahasa Indonesia' : 'English';
  if (q.id === 'type') return T.type[v] || v;
  if (q.id === 'picks') return T.goal[v] || v;
  if (q.id === 'have') return T.have[v] || v;
  if (q.id === 'divisions') return T.division[v] || v;
  if (q.id.startsWith('m.')) return T.mode[v] || v;
  return (T[q.id] || {})[v] || v;
};
const nowText = (lang, q, v) => (v == null || v === '' || (Array.isArray(v) && !v.length) ? '' : Array.isArray(v) ? v.map((x) => label(lang, q, x)).join(', ') : q.kind === 'choice' ? label(lang, q, v) : String(v));
export function questionMessage(q, a, lang, sel = null) {
  const T = L[lang], n = STEP_OF[q.step] + 1;
  let ask = q.id.startsWith('m.') ? fill(T.q.mode, { division: T.division[q.id.slice(2)] }) : fill(T.q[q.id], { currency: a.goals.currency, list: guide.suggestFor(a.business.type, a.have).map((d) => T.division[d]).join(', ') });
  if (q.id.startsWith('m.')) ask += `\n${guide.MODES.map((m) => `• ${T.mode[m]}: ${T.modeText[m]}`).join('\n')}`;
  const cur = nowText(lang, q, sel ?? valueOf(a, q.id));
  const text = [`${fill(T.step, { n })} · ${STEP_TITLE[lang][STEP_OF[q.step]]}`, ask, ...(cur && q.kind !== 'multi' ? [fill(T.now, { v: cur })] : []), ...(q.kind === 'text' ? [T.typeIt] : q.kind === 'number' ? [T.typeNumber] : [])].join('\n\n');
  const rows = [];
  if (q.kind === 'choice' || q.kind === 'multi') {
    const picked = q.kind === 'multi' ? sel ?? valueOf(a, q.id) ?? [] : [];
    const btns = q.options.map((o) => ({ text: `${q.kind === 'multi' && picked.includes(o) ? '✓ ' : ''}${label(lang, q, o)}`, data: `g:${q.kind === 'multi' ? 't' : 'a'}:${q.id}:${o}` }));
    for (let i = 0; i < btns.length; i += 2) rows.push(btns.slice(i, i + 2));
    if (q.id === 'divisions') rows.push([{ text: T.suggestBtn, data: 'g:u:divisions' }]);
    if (q.kind === 'multi') rows.push([{ text: T.doneBtn, data: `g:d:${q.id}` }]);
  }
  if ((q.kind === 'text' || q.kind === 'number') && !q.required) rows.push([{ text: T.skipBtn, data: `g:s:${q.id}` }]);
  rows.push([...(q.id !== 'language' ? [{ text: T.backBtn, data: 'g:b' }] : []), { text: T.cancelBtn, data: 'g:x' }]);
  return { text, buttons: rows };
}
// the plan in plain words: the Spaces, their targets and routines, what waits for the owner, and Build in the app
export function planMessage(p, lang, publicUrl = '') {
  const T = L[lang];
  const lines = [fill(T.planTitle, { name: p.company.name }), ''];
  if (p.summary) lines.push(fill(T.summary, { text: oneLine(p.summary, 500) }), '');
  for (const sp of p.spaces.filter((x) => !x.skip || x.exists)) {
    lines.push(`• ${fill(T.spaceLine, { name: sp.name, mode: T.mode[sp.mode] || sp.mode, owner: sp.access === 'owner' ? T.ownerOnly : '' })}${sp.exists ? ` · ${T.exists}` : ''}`);
    if (sp.exists) continue;
    const targets = sp.kpis.map((k) => `${k.name}${k.target != null ? ` ${k.target}${k.unit ? ` ${k.unit}` : ''}` : ''}`);
    lines.push(`  ${targets.length ? fill(T.targets, { list: targets.join('; ') }) : T.noTargets}`);
    const on = (sp.routines || []).filter((r) => r.on);
    lines.push(`  ${on.length ? fill(T.routines, { list: on.map((r) => `${r.title} ${r.at}`).join('; ') }) : T.noRoutines}`);
    const missing = sp.materials.filter((m) => m.status === 'missing').length;
    if (missing) lines.push(`  ${fill(T.materials, { n: missing })}`);
  }
  const modes = [...new Set(p.spaces.filter((x) => !x.skip).map((x) => x.mode))];
  lines.push('', fill(T.waits, { list: [...modes.map((m) => `${T.mode[m]}: ${T.modeText[m]}`), T.hardStops].join('; ') }));
  if (p.later?.length) lines.push(fill(T.later, { list: p.later.map((d) => T.division[d] || d).join(', ') }));
  if (p.capacity?.budget) lines.push(fill(T.budget, { usd: p.capacity.budget }));
  lines.push('', T.buildInApp, publicUrl ? fill(T.openLink, { url: `${publicUrl}/#/guide` }) : T.openApp);
  return lines.join('\n');
}

// ---------- the conversation ----------
// io: { send(text, buttons), edit(messageId, text, buttons), ack(text), pending (the chat's guide state or null),
// setPending(p|null), publicUrl, plan(opts) (guide.plan, swappable in tests) }
const ask = (io, q, a, lang, sel = null) => { io.setPending({ mode: 'guide', q: q.id, ...(sel ? { sel } : {}) }); const m = questionMessage(q, a, lang, sel); return io.send(m.text, m.buttons); };
// the web opens where Telegram is; the first answers carry the Building's language, never English by default
const stepTo = (q) => { const st = guide.load(); guide.answer(st.answers ? {} : { language: langOf(st) }, STEP_OF[q.step], { via: 'telegram' }); };
async function goTo(io, q) {
  if (!q) return makePlan(io);
  stepTo(q);
  const st = guide.load();
  return ask(io, q, answersOf(st), langOf(st));
}
async function makePlan(io) {
  const lang = langOf();
  io.setPending(null);
  await io.send(L[lang].makingPlan, []);
  let p;
  try { p = await io.plan({ via: 'telegram' }); } catch (e) { return io.send(fill(L[lang].noPlan, { error: e.message }), []); }
  return io.send(planMessage(p, langOf(), io.publicUrl), io.publicUrl ? [[{ text: lang === 'id' ? 'Buka rencana' : 'Open the plan', url: `${io.publicUrl}/#/guide` }]] : []);
}
const nextAfter = (a, id) => { const qs = questions(a), i = qs.findIndex((q) => q.id === id); return i < 0 ? qs[0] : qs[i + 1] || null; };
const firstOfStep = (a, step) => questions(a).find((q) => STEP_OF[q.step] >= step) || null;

// /guide: the Owner starts or resumes; anyone else is refused politely
export async function start(io, user) {
  const st = guide.load(), lang = langOf(st);
  if (user?.role !== 'owner') return io.send(L[lang].refuse, []);
  const T = L[lang], a = answersOf(st);
  if (st.done) { await io.send(T.again, []); return goTo(io, find(a, 'divisions')); }
  if (!st.answers) { await io.send(T.hello, []); return goTo(io, questions(a)[0]); }
  io.setPending({ mode: 'guide', q: '' });
  const step = Math.min(Number(st.step) || 0, 7);
  return io.send(fill(T.resume, { title: STEP_TITLE[lang][step] }), [[{ text: T.continueBtn, data: 'g:c' }, { text: T.restartBtn, data: 'g:r' }], [{ text: T.cancelBtn, data: 'g:x' }]]);
}
// a button: g:<act>[:<question>[:<value>]]
export async function press(io, user, data, messageId) {
  const st = guide.load(), lang = langOf(st), T = L[lang];
  if (user?.role !== 'owner') { await io.ack(''); return io.send(T.refuse, []); }
  const [, act, id = '', ...rest] = String(data).split(':'), v = rest.join(':');
  const a = answersOf(st), p = io.pending;
  await io.ack('');
  if (act === 'x') { io.setPending(null); return io.send(T.cancelled, []); }
  if (act === 'c') { if (st.plan && Number(st.step) >= 7) return makePlan(io); return goTo(io, firstOfStep(a, Number(st.step) || 0)); }
  if (act === 'r') return goTo(io, questions(a)[0]);
  if (!p || p.mode !== 'guide') return start(io, user);                    // an old message after Cancel: start again
  const q = find(a, p.q);
  if (act === 'b') { const qs = questions(a), i = qs.findIndex((x) => x.id === p.q); return goTo(io, qs[Math.max(0, i - 1)] || qs[0]); }
  if (!q || id !== q.id) { await io.send(T.moved, []); return q ? ask(io, q, a, lang, p.sel) : goTo(io, firstOfStep(a, Number(st.step) || 0)); }
  if (act === 'a' && q.kind === 'choice' && q.options.includes(v)) {
    const next = guide.answer(patchOf(a, q.id, v), undefined, { via: 'telegram' }).answers;
    return goTo(io, nextAfter(guide.cleanAnswers(next), q.id));
  }
  if (act === 't' && q.kind === 'multi' && q.options.includes(v)) {
    const cur = p.sel ?? valueOf(a, q.id) ?? [];
    const sel = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    io.setPending({ ...p, sel });
    const m = questionMessage(q, a, lang, sel);
    return messageId ? io.edit(messageId, m.text, m.buttons) : io.send(m.text, m.buttons);
  }
  if (act === 'u' && q.id === 'divisions') {
    const sel = guide.suggestFor(a.business.type, a.have);
    io.setPending({ ...p, sel });
    const m = questionMessage(q, a, lang, sel);
    return messageId ? io.edit(messageId, m.text, m.buttons) : io.send(m.text, m.buttons);
  }
  if (act === 'd' && q.kind === 'multi') {
    const sel = (p.sel ?? valueOf(a, q.id) ?? []).filter((x) => q.options.includes(x));
    if (q.min && sel.length < q.min) return io.send(T.needOne, []);
    const next = guide.answer(patchOf(a, q.id, q.options.filter((o) => sel.includes(o))), undefined, { via: 'telegram' }).answers;
    return goTo(io, nextAfter(guide.cleanAnswers(next), q.id));
  }
  if (act === 's' && !q.required && (q.kind === 'text' || q.kind === 'number')) return goTo(io, nextAfter(a, q.id));
  return ask(io, q, a, lang, p.sel);
}
// free text while a question waits: the answer to a text or number question
export async function text(io, user, body) {
  const st = guide.load(), lang = langOf(st), T = L[lang];
  if (user?.role !== 'owner') return io.send(T.refuse, []);
  const a = answersOf(st), q = find(a, io.pending?.q);
  if (!q) return goTo(io, firstOfStep(a, Number(st.step) || 0));
  if (q.kind === 'choice' || q.kind === 'multi') return ask(io, q, a, lang, io.pending.sel);   // buttons, not text
  let v = String(body || '').trim();
  if (q.kind === 'number') { const n = parseNumber(v); if (n === null) return io.send(T.notNumber, []); v = n; }
  if (q.required && !v) return io.send(T.needName, []);
  const next = guide.answer(patchOf(a, q.id, v), undefined, { via: 'telegram' }).answers;
  return goTo(io, nextAfter(guide.cleanAnswers(next), q.id));
}
