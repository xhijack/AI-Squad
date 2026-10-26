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

// ---------- Voice settings (menu) ----------
async function settingsDialog() {
  const info = await api('GET', '/api/voice');
  const floorsList = (ctx.state.building?.floors || []).filter((f) => !f.independent && !f.missing);
  const s = info.settings, u = info.usage, pct = s.budgetChars ? Math.min(100, Math.round(u.chars / s.budgetChars * 100)) : 0;
  const body = openModal(`<div class="mHead"><h3 class="grow">${t('Voice')}</h3><button class="ghost iconBtn" data-close aria-label="${t('Close')}">×</button></div>
    <form class="mBody" id="vForm" novalidate>
      <p class="note" style="margin-top:0">${t("Agents speak with ElevenLabs voices. The server calls ElevenLabs; the browser never sees the key. Without a key (or past the budget) the browser's own voice speaks. The dock's speaker button switches voices on and off.")}</p>
      <label>${t('ElevenLabs API key')} ${info.key.set ? `<span class="chip ok">${info.key.source === 'environment' ? t('set ····{last4} (service environment)', { last4: esc(info.key.last4) }) : t('set ····{last4}', { last4: esc(info.key.last4) })}</span>` : `<span class="chip">${t('not set')}</span>`}</label>
      <div class="row"><input name="key" type="password" autocomplete="off" placeholder="${info.key.set ? t('Paste a new key to replace it') : t('Paste your key')}" class="grow">
        <button type="button" class="small" data-savekey>${t('Save key')}</button>${info.key.set && info.key.source !== 'environment' ? `<button type="button" class="small ghost danger" data-delkey>${t('Remove')}</button>` : ''}<button type="button" class="small ghost" data-test ${info.key.set ? '' : 'disabled'}>${t('Test voice')}</button></div>
      <p class="note">${t('Stored in <code>~/.aisquad/secrets.json</code> (only you can read it), never in a repository or a log. <code>ELEVENLABS_API_KEY</code> in the service environment wins.')}</p>
      <div class="grid2"><div><label>${t('Model')}</label><select name="model">${info.models.map((m) => `<option ${m === s.model ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
        <div><label>${t('Monthly budget (characters)')}</label><input name="budget" type="number" min="0" step="1000" value="${s.budgetChars}"></div></div>
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
    if (/audio\//.test(r.headers.get('content-type') || '')) { new Audio(URL.createObjectURL(await r.blob())).play(); toast(t('The voice works')); } else { const j = await r.json().catch(() => ({})); err.textContent = tx(j.reason || j.error) || t('The test did not work'); }
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

// ---------- a voice per agent (Desk → Profile) ----------
async function chooseVoice(el) {
  const floorId = ctx.state.route.floorId, agentId = el.dataset.agent;
  let list = [];
  try { list = (await api('GET', '/api/voice/voices')).voices; } catch (e) { toast(e.message); return; }
  if (!list.length) { toast(t('No voices: set the ElevenLabs key in Menu → Voice first')); return; }
  const body = openModal(`<div class="mHead"><h3 class="grow">${t('Voice for {name}', { name: esc(el.dataset.name || agentId) })}</h3><button class="ghost iconBtn" data-close aria-label="${t('Close')}">×</button></div>
    <div class="mBody"><ul class="vList">${list.map((v) => `<li><span class="grow"><b>${esc(v.name)}</b> <span class="note">${esc(Object.values(v.labels || {}).join(' · '))}</span></span>
      ${v.preview ? `<button type="button" class="small ghost" data-preview="${esc(v.preview)}">${t('Preview')}</button>` : ''}<button type="button" class="small ${el.dataset.voice === v.id ? '' : 'gold'}" data-use="${esc(v.id)}">${el.dataset.voice === v.id ? t('In use') : t('Use')}</button></li>`).join('')}</ul></div>`);
  body.parentElement.querySelector('[data-close]').onclick = () => closeModal();
  body.querySelectorAll('[data-preview]').forEach((b) => { b.onclick = () => new Audio(b.dataset.preview).play().catch(() => toast(t('Could not play the preview'))); });
  body.querySelectorAll('[data-use]').forEach((b) => { b.onclick = async () => { await api('PATCH', `/api/floors/${floorId}/agents/${agentId}`, { voice: b.dataset.use }); closeModal(); toast(t('Voice saved')); ctx.refresh(); }; });
}

ctx.actions['voice-settings'] = () => settingsDialog();
ctx.actions['choose-voice'] = (el) => chooseVoice(el);
