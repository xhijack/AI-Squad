// Small shared helpers for the UI: DOM, formatting, API calls with the local PIN, toast, modal.
export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = (n) => `$${(+n || 0).toFixed(2)}`;
export const gb = (b) => `${(b / 2 ** 30).toFixed(1)} GB`;

export function ago(ts) {
  if (!ts) return 'never';
  const s = (Date.now() - ts) / 1000;
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
export const initials = (name) => String(name || '?').split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
export function avatar(a, cls = '') {
  const ap = a.appearance || {};
  return `<span class="avatar ${cls}" style="--shirt:${esc(ap.shirt || '#3d82d6')};--hair:${esc(ap.hair || '#2b2440')}" aria-hidden="true">${esc(initials(a.displayName))}</span>`;
}
export const STATE_TEXT = { working: 'Working', waiting: 'Waiting for you', idle: 'Idle', stopped: 'Stopped' };

export function toast(text, ms = 2800) {
  const t = $('toast');
  t.textContent = text; t.classList.add('on');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), ms);
}

// ---------- PIN + API ----------
const PIN_KEY = 'aisquad.pin';
let pin = (() => { try { return localStorage.getItem(PIN_KEY) || ''; } catch { return ''; } })();
export const hasPin = () => !!pin;

export function askPin() {
  return new Promise((resolve) => {
    const d = $('pinDlg');
    $('pinIn').value = '';
    d.showModal();
    d.onclose = () => {
      if (d.returnValue !== 'ok') return resolve(false);
      pin = $('pinIn').value.trim();
      try { localStorage.setItem(PIN_KEY, pin); } catch { /* private mode */ }
      resolve(true);
    };
  });
}

// reads: send the PIN too (servers bound off loopback lock every API call); 401 is reported, not prompted
export async function getJson(url) {
  const r = await fetch(url, { headers: pin ? { 'x-aisquad-pin': pin } : {} });
  if (r.status === 401) throw Object.assign(new Error('PIN required'), { status: 401 });
  if (r.status === 404) return { notFound: true };
  return r.json();
}

// image with the PIN header (servers off loopback lock reads); null on any failure
export async function fetchImage(url) {
  try {
    const r = await fetch(url, { headers: pin ? { 'x-aisquad-pin': pin } : {} });
    return r.ok ? await createImageBitmap(await r.blob()) : null;
  } catch { return null; }
}

export async function api(method, url, body, { raw = null, headers = {}, quiet401 = false } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const init = { method, headers: { 'x-aisquad-pin': pin, ...headers } };
    if (raw) init.body = raw;
    else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['content-type'] = 'application/json'; }
    const r = await fetch(url, init);
    if (r.status === 401) {
      if (quiet401) throw Object.assign(new Error('PIN required'), { status: 401 });
      if (!(await askPin())) throw Object.assign(new Error('PIN required'), { status: 401 });
      continue;
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `Request failed (${r.status})`), { status: r.status });
    return j;
  }
  throw new Error('Wrong PIN');
}

// ---------- modal ----------
export function openModal(html, { onClose } = {}) {
  const d = $('modal');
  $('modalBody').innerHTML = html;
  d.className = '';                                   // a wide dialog (board, performance) never leaks into the next one
  if (!d.open) d.showModal();
  d.onclose = () => { $('modalBody').innerHTML = ''; onClose?.(); };
  return $('modalBody');
}
export const closeModal = () => { if ($('modal').open) $('modal').close(); };

export function segHtml(name, options, value) {
  return `<div class="seg" data-seg="${esc(name)}">${options.map(([v, label]) => `<button type="button" data-v="${esc(v)}" aria-pressed="${v === value}">${esc(label)}</button>`).join('')}</div>`;
}
export function bindSegs(root, onChange) {
  root.querySelectorAll('[data-seg]').forEach((seg) => seg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    onChange?.(seg.dataset.seg, b.dataset.v);
  }));
}
export const segValue = (root, name) => root.querySelector(`[data-seg="${name}"] [aria-pressed=true]`)?.dataset.v;

export function diffHtml(diff) {
  return `<div class="diff mono">${diff.map((l) => `<span class="${l.op === '+' ? 'add' : l.op === '-' ? 'del' : 'same'}">${esc(l.op)} ${esc(l.text) || '&nbsp;'}</span>`).join('')}</div>`;
}
