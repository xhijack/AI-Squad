// SPDX-License-Identifier: Apache-2.0
// Voices in the browser: asks the server for a spoken line (ElevenLabs through the server; the browser never sees
// the key), plays it, and moves the character's mouth with the audio (Web Audio analyser). Falls back to the
// browser's own speech when the server says so (no key, budget used up), or stays silent (muted, quiet hours).
// The dock's Voice toggle switches all of it.
import { api, esc, openModal, closeModal, toast } from './lib.js';
import { ctx } from './ctx.js';
import { voiceOn } from './shout.js';
import { t, tx } from './i18n.js';

let current = null;                 // { audio, stop } of the line playing now
let actx = null;
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const pin = () => { try { return localStorage.getItem('aisquad.pin') || ''; } catch { return ''; } };

// the browser's own speech (the fallback): Indonesian or English by the words used
function browserSpeak(text, onLevel) {
  if (!('speechSynthesis' in window) || !text) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    const id = /\b(yang|dan|saya|tidak|sudah|untuk|dengan|bisa|kami|apakah|bolehkah)\b/i.test(text);
    const v = speechSynthesis.getVoices().find((x) => (id ? /^id/i : /^en/i).test(x.lang));
    if (v) u.voice = v;
    u.lang = v ? v.lang : id ? 'id-ID' : 'en-US'; u.rate = 1.05;
    let t = 0;
    const tick = () => { if (!speechSynthesis.speaking) { onLevel?.(0); return; } t += .1; onLevel?.(.25 + Math.abs(Math.sin(t * 9)) * .5); setTimeout(tick, 60); };
    u.onstart = tick;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch { /* the browser refuses speech before any interaction */ }
}

// line: { floorId, agentId, kind, text, full }; onLevel(0..1) drives a mouth (portrait, office character)
export async function playLine(line, { onLevel = null, force = false } = {}) {
  if ((!voiceOn() && !force) || !line.text) return;
  current?.stop();
  const level = (v) => { onLevel?.(v); if (line.agentId) ctx.scene?.setTalk?.(line.floorId, line.agentId, v); };
  let r;
  try {
    r = await fetch('/api/voice/speak', { method: 'POST', headers: { 'content-type': 'application/json', 'x-aisquad-pin': pin() }, body: JSON.stringify({ ...line, visible: !document.hidden }) });
  } catch { return; }
  if (!r.ok) return;
  if (!/audio\//.test(r.headers.get('content-type') || '')) {
    const j = await r.json().catch(() => ({}));
    if (j.fallback === 'browser') browserSpeak(j.text, level);
    return;
  }
  const url = URL.createObjectURL(await r.blob());
  const audio = new Audio(url);
  let raf = 0;
  const stop = () => { cancelAnimationFrame(raf); audio.pause(); URL.revokeObjectURL(url); level(0); if (current?.audio === audio) current = null; };
  current = { audio, stop };
  audio.onended = stop;
  if (!reduced()) {
    try {
      actx ||= new AudioContext();
      const src = actx.createMediaElementSource(audio), an = actx.createAnalyser();
      an.fftSize = 512; src.connect(an); an.connect(actx.destination);
      const buf = new Uint8Array(an.fftSize);
      const loop = () => { an.getByteTimeDomainData(buf); let s = 0; for (const v of buf) s += (v - 128) ** 2; level(Math.min(1, Math.sqrt(s / buf.length) / 40)); raf = requestAnimationFrame(loop); };
      loop();
    } catch { /* no Web Audio: the voice still plays */ }
  }
  audio.play().catch(() => stop());
}
export const stopVoice = () => current?.stop();

// ---------- shared pieces: ElevenLabs' error, language and voice settings ----------
// languages by their own names (not translated)
export const LANG_NAMES = { id: 'Bahasa Indonesia', en: 'English', ms: 'Bahasa Melayu', jv: 'Basa Jawa', es: 'Español', fr: 'Français', de: 'Deutsch', pt: 'Português', it: 'Italiano', nl: 'Nederlands', ja: '日本語', ko: '한국어', zh: '中文', ar: 'العربية', hi: 'हिन्दी' };
const DEFAULTS = { stability: .6, similarity_boost: .8, style: 0, use_speaker_boost: true };
// ElevenLabs' own code and message (scrubbed by the server) and what to do about it
export const errorHtml = (e) => (e ? `<div class="vErrBox"><b>ElevenLabs ${esc(e.status)} · ${esc(e.code)}</b>${e.message ? `<div class="mono">${esc(e.message)}</div>` : ''}${e.hint ? `<div class="note">${esc(tx(e.hint))}</div>` : ''}</div>` : '');
// lang: '' (inherit: the Floor's default) | auto | a code; vs: voice settings or null (inherit)
export function voiceControlsHtml(lang, vs, { inherit = '' } = {}) {
  const v = { ...DEFAULTS, ...(vs || {}) };
  const slider = (k, label) => `<label>${label} <output data-out="${k}">${v[k].toFixed(2)}</output></label><input type="range" name="vs_${k}" min="0" max="1" step="0.05" value="${v[k]}">`;
  return `<div class="grid2"><div><label>${t('Language')}</label><select name="vLang">${inherit ? `<option value="" ${!lang ? 'selected' : ''}>${esc(inherit)}</option>` : ''}
      <option value="auto" ${lang === 'auto' ? 'selected' : ''}>${t('Auto (from the words of each line)')}</option>${Object.entries(LANG_NAMES).map(([k, n]) => `<option value="${k}" ${lang === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
    <div><label class="inline" style="margin-top:var(--sp-7)"><input type="checkbox" name="vsInherit" ${!vs && inherit ? 'checked' : ''} ${inherit ? '' : 'hidden'}> ${inherit ? t('Use the Floor\'s voice settings') : ''}</label></div></div>
    <div class="grid2 vSliders">${slider('stability', t('Stability'))}${slider('similarity_boost', t('Similarity'))}${slider('style', t('Style'))}
      <label class="inline" style="align-self:end"><input type="checkbox" name="vs_use_speaker_boost" ${v.use_speaker_boost ? 'checked' : ''}> ${t('Speaker boost')}</label></div>
    <p class="note">${t('Steadier and closer to the original voice with higher stability and similarity; style adds expression (and takes longer).')}</p>`;
}
export function bindVoiceControls(root) {
  root.querySelectorAll('input[type=range][name^=vs_]').forEach((r) => { r.oninput = () => { root.querySelector(`[data-out="${r.name.slice(3)}"]`).textContent = Number(r.value).toFixed(2); const i = root.querySelector('[name=vsInherit]'); if (i) i.checked = false; }; });
}
// -> { lang, settings } (lang '' and settings null: inherit)
export function readVoiceControls(root) {
  const el = (n) => root.querySelector(`[name="${n}"]`);
  const inherit = el('vsInherit')?.checked;
  return { lang: el('vLang').value, settings: inherit ? null : { stability: +el('vs_stability').value, similarity_boost: +el('vs_similarity_boost').value, style: +el('vs_style').value, use_speaker_boost: el('vs_use_speaker_boost').checked } };
}
// a sample line with the voice settings shown (not saved yet); errors from ElevenLabs go into err
export async function previewVoice(body, err) {
  const r = await fetch('/api/voice/preview', { method: 'POST', headers: { 'content-type': 'application/json', 'x-aisquad-pin': pin() }, body: JSON.stringify(body) });
  if (/audio\//.test(r.headers.get('content-type') || '')) { err.innerHTML = ''; new Audio(URL.createObjectURL(await r.blob())).play().catch(() => toast(t('Could not play the preview'))); return; }
  const j = await r.json().catch(() => ({}));
  err.innerHTML = j.error ? errorHtml(j.error) : esc(tx(j.reason || j.error) || t('The test did not work'));
}

// ---------- Voice settings (menu) ----------
async function settingsDialog() {
  const info = await api('GET', '/api/voice');
  const floorsList = (ctx.state.building?.floors || []).filter((f) => !f.independent && !f.missing);
  const s = info.settings, u = info.usage, pct = s.budgetChars ? Math.min(100, Math.round(u.chars / s.budgetChars * 100)) : 0, a = info.account;
  const plan = !a ? '' : a.error ? `<div class="note">${t('The plan cannot be shown: {why}', { why: esc(tx(a.error.hint) || a.error.code) })}</div>`
    : `<div class="note">${t('ElevenLabs plan {tier}: {left} of {limit} characters left this period', { tier: esc(a.tier), left: a.remaining.toLocaleString(), limit: a.limit.toLocaleString() })}${a.resetAt ? ` · ${t('resets {date}', { date: new Date(a.resetAt).toLocaleDateString() })}` : ''}</div>`;
  const body = openModal(`<div class="mHead"><h3 class="grow">${t('Voice')}</h3><button class="ghost iconBtn" data-close aria-label="${t('Close')}">×</button></div>
    <form class="mBody" id="vForm" novalidate>
      <p class="note" style="margin-top:0">${t("Agents speak with ElevenLabs voices. The server calls ElevenLabs; the browser never sees the key. Without a key (or past the budget) the browser's own voice speaks. The dock's speaker button switches voices on and off.")}</p>
      <label>${t('ElevenLabs API key')} ${info.key.set ? `<span class="chip ok">${info.key.source === 'environment' ? t('set ····{last4} (service environment)', { last4: esc(info.key.last4) }) : t('set ····{last4}', { last4: esc(info.key.last4) })}</span>` : `<span class="chip">${t('not set')}</span>`}</label>
      <div class="row"><input name="key" type="password" autocomplete="off" placeholder="${info.key.set ? t('Paste a new key to replace it') : t('Paste your key')}" class="grow">
        <button type="button" class="small" data-savekey>${t('Save key')}</button>${info.key.set && info.key.source !== 'environment' ? `<button type="button" class="small ghost danger" data-delkey>${t('Remove')}</button>` : ''}<button type="button" class="small ghost" data-test ${info.key.set ? '' : 'disabled'}>${t('Test voice')}</button></div>
      <p class="note">${t('Stored in <code>~/.aisquad/secrets.json</code> (only you can read it), never in a repository or a log. <code>ELEVENLABS_API_KEY</code> in the service environment wins.')}</p>
      ${plan}
      <div id="vLast">${info.lastError ? `<label>${t('Last answer from ElevenLabs')}</label>${errorHtml(info.lastError)}` : ''}</div>
      <div class="grid2"><div><label>${t('Model')}</label><select name="model">${info.models.map((m) => `<option value="${m}" ${m === s.model ? 'selected' : ''}>${m} · ${info.langModels.includes(m) ? t('takes a language setting') : t('guesses the language')}</option>`).join('')}</select></div>
        <div><label>${t('Monthly budget (characters)')}</label><input name="budget" type="number" min="0" step="1000" value="${s.budgetChars}"></div></div>
      <p class="note">${t('Each agent (and each Floor) can set the language it speaks and its voice settings: Desk → Profile → Voice, and Floor settings.')}</p>
      <div class="note">${t('This month: {used} of {budget} characters ({calls} calls, {cached} from the cache)', { used: u.chars.toLocaleString(), budget: s.budgetChars.toLocaleString(), calls: u.calls, cached: u.cached })}</div>
      <div class="vMeter" role="img" aria-label="${t('{pct} % of the budget', { pct })}"><i style="width:${pct}%"></i></div>
      <div class="grid2"><div><label>${t('Quiet from')}</label><input name="qf" type="time" value="${esc(s.quietFrom)}"></div><div><label>${t('Quiet until')}</label><input name="qt" type="time" value="${esc(s.quietTo)}"></div></div>
      <label class="inline"><input type="checkbox" name="visible" ${s.onlyVisible ? 'checked' : ''}> ${t('Speak only while this tab is visible')}</label>
      ${floorsList.length ? `<label>${t('Muted Floors')}</label>${floorsList.map((f) => `<label class="inline"><input type="checkbox" name="mute" value="${esc(f.id)}" ${s.mutedFloors.includes(f.id) ? 'checked' : ''}> ${f.number} · ${esc(f.name)}</label>`).join('')}` : ''}
    </form><div class="mFoot"><div class="err grow" id="vErr"></div><button class="ghost" data-close>${t('Cancel')}</button><button class="gold" data-ok>${t('Save')}</button></div>`);
  const root = body.parentElement, form = root.querySelector('#vForm'), err = root.querySelector('#vErr');
  root.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => closeModal(); });
  root.querySelector('[data-savekey]').onclick = async () => { try { await api('PUT', '/api/voice/key', { key: form.elements.key.value }); form.elements.key.value = ''; toast(t('Key saved')); settingsDialog(); } catch (e) { err.textContent = e.message; } };
  root.querySelector('[data-delkey]')?.addEventListener('click', async () => { await api('DELETE', '/api/voice/key'); toast(t('Key removed')); settingsDialog(); });
  root.querySelector('[data-test]').onclick = async () => {
    const r = await fetch('/api/voice/test', { method: 'POST', headers: { 'x-aisquad-pin': pin() } });
    if (/audio\//.test(r.headers.get('content-type') || '')) { new Audio(URL.createObjectURL(await r.blob())).play(); toast(t('The voice works')); root.querySelector('#vLast').innerHTML = ''; }
    else { const j = await r.json().catch(() => ({})); if (j.error) root.querySelector('#vLast').innerHTML = `<label>${t('Last answer from ElevenLabs')}</label>${errorHtml(j.error)}`; else err.textContent = tx(j.reason || j.error) || t('The test did not work'); }
  };
  root.querySelector('[data-ok]').onclick = async () => {
    const v = (n) => form.elements[n].value;
    try {
      await api('PATCH', '/api/voice', { model: v('model'), budgetChars: Number(v('budget')), quietFrom: v('qf'), quietTo: v('qt'), onlyVisible: form.elements.visible.checked,
        mutedFloors: [...form.querySelectorAll('[name=mute]:checked')].map((x) => x.value) });
      closeModal(); toast(t('Voice settings saved'));
    } catch (e) { err.textContent = e.message; }
  };
}

// ---------- a voice per agent (Desk → Profile): voice, language, voice settings ----------
const VOICE_ID = /^[A-Za-z0-9]{10,40}$/;
async function chooseVoice(el) {
  const floorId = ctx.state.route.floorId, agentId = el.dataset.agent;
  let res = { voices: [], error: null };
  try { res = await api('GET', '/api/voice/voices'); } catch (e) { toast(e.message); return; }
  const list = res.voices || [], floorVoice = ctx.state.floor?.floor?.voice || {};
  let chosen = el.dataset.voice || '';
  const vs = el.dataset.vs ? JSON.parse(el.dataset.vs) : null;
  const inherit = t('The Floor\'s default ({lang})', { lang: floorVoice.lang && floorVoice.lang !== 'auto' ? LANG_NAMES[floorVoice.lang] || floorVoice.lang : t('auto') });
  const langs = [...new Set(list.flatMap((v) => v.languages || []))].sort();
  const row = (v) => `<li data-langs="${esc((v.languages || []).join(' '))}"><span class="grow"><b>${esc(v.name)}</b> <span class="note">${esc(Object.values(v.labels || {}).join(' · '))}</span></span>
      ${v.preview ? `<button type="button" class="small ghost" data-sample="${esc(v.preview)}">${t('Sample')}</button>` : ''}<button type="button" class="small ${chosen === v.id ? '' : 'gold'}" data-use="${esc(v.id)}">${chosen === v.id ? t('In use') : t('Use')}</button></li>`;
  const body = openModal(`<div class="mHead"><h3 class="grow">${t('Voice for {name}', { name: esc(el.dataset.name || agentId) })}</h3><button class="ghost iconBtn" data-close aria-label="${t('Close')}">×</button></div>
    <form class="mBody" id="cvForm" novalidate>
      ${voiceControlsHtml(el.dataset.lang || '', vs, { inherit })}
      <label>${t('Voice')}</label>
      ${res.error ? errorHtml(res.error) : ''}
      ${list.length ? `${langs.length ? `<div class="row"><label class="grow" style="margin:0">${t('Voices for')}</label><select data-filter style="width:auto"><option value="">${t('All languages')}</option>${langs.map((l) => `<option value="${esc(l)}">${esc(LANG_NAMES[l] || l)}</option>`).join('')}</select></div>` : ''}
        <ul class="vList">${list.map(row).join('')}</ul>` : (!res.error ? `<p class="note">${t('No voices: set the ElevenLabs key in Menu → Voice first')}</p>` : '')}
      <label>${t('Or paste a voice id (from My Voices or Voice Design)')}</label><input name="pasted" autocomplete="off" placeholder="${t('e.g. {id}', { id: '21m00Tcm4TlvDq8ikWAM' })}" value="${chosen && !list.some((v) => v.id === chosen) ? esc(chosen) : ''}">
    </form><div class="mFoot"><div class="err grow" id="cvErr"></div><button type="button" class="ghost" data-preview>${t('Preview')}</button><button class="ghost" data-close>${t('Cancel')}</button><button class="gold" data-ok>${t('Save')}</button></div>`);
  const root = body.parentElement, form = root.querySelector('#cvForm'), err = root.querySelector('#cvErr');
  bindVoiceControls(form);
  root.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => closeModal(); });
  root.querySelector('[data-filter]')?.addEventListener('change', (e) => { form.querySelectorAll('.vList li').forEach((li) => { li.hidden = !!e.target.value && !li.dataset.langs.split(' ').includes(e.target.value); }); });
  form.querySelectorAll('[data-sample]').forEach((b) => { b.onclick = () => new Audio(b.dataset.sample).play().catch(() => toast(t('Could not play the preview'))); });
  form.querySelectorAll('[data-use]').forEach((b) => { b.onclick = () => {
    chosen = b.dataset.use; form.elements.pasted.value = '';
    form.querySelectorAll('[data-use]').forEach((x) => { const on = x.dataset.use === chosen; x.textContent = on ? t('In use') : t('Use'); x.classList.toggle('gold', !on); });
  }; });
  const pick = () => { const p = form.elements.pasted.value.trim(); if (p && !VOICE_ID.test(p)) throw new Error(t('That does not look like a voice id')); return p || chosen; };
  root.querySelector('[data-preview]').onclick = async () => {
    try { const c = readVoiceControls(form); await previewVoice({ voice: pick() || undefined, lang: c.lang || floorVoice.lang || 'auto', settings: c.settings || floorVoice.settings || null }, err); } catch (e) { err.textContent = e.message; }
  };
  root.querySelector('[data-ok]').onclick = async () => {
    try {
      const c = readVoiceControls(form), v = pick();
      await api('PATCH', `/api/floors/${floorId}/agents/${agentId}`, { ...(v ? { voice: v } : {}), voiceLang: c.lang, voiceSettings: c.settings });
      closeModal(); toast(t('Voice saved')); ctx.refresh();
    } catch (e) { err.textContent = e.message; }
  };
}

ctx.actions['voice-settings'] = () => settingsDialog();
ctx.actions['choose-voice'] = (el) => chooseVoice(el);
