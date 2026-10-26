// UI language: English (default) or Bahasa Indonesia, chosen per browser (Menu → Language, Floor settings).
// All UI copy goes through t('English text', { vars }): the English text is the key; ui/i18n/en.json lists every
// key and ui/i18n/id.json translates each ("kamu", no emoji). Placeholders are {name}. Text that comes from the
// server (Attention cards, Autopilot notes, errors) goes through tx(), which also matches keys with placeholders
// as patterns ("{name} asks you"). Agent-written text is never translated. Code, file names and JSON keys stay
// English.
export const LANGS = { en: 'English', id: 'Bahasa Indonesia' };
const KEY = 'aisquad.lang';
export const LANG = (() => { try { const l = localStorage.getItem(KEY); return LANGS[l] ? l : 'en'; } catch { return 'en'; } })();
let table = {}, patterns = [];

export function setTable(t) {
  table = t || {};
  patterns = Object.keys(table).filter((k) => /\{\w+\}/.test(k)).map((k) => {
    const names = [];
    const re = new RegExp(`^${k.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\w+)\}/g, (m, n) => { names.push(n); return '([\\s\\S]+?)'; })}$`);
    return { re, names, k };
  });
}
if (LANG !== 'en' && typeof fetch === 'function') {
  try { setTable(await (await fetch(`./i18n/${LANG}.json`)).json()); } catch { /* offline or missing: English */ }
}

const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : s);
// UI copy: t('Send task'), t('{n} agents working', { n: 3 })
export const t = (s, vars) => fill(table[s] ?? s, vars);
// text from the server: an exact key, else a pattern key ("{name} is waiting for you"), else as it is
export function tx(s) {
  if (s == null || !patterns.length && !Object.keys(table).length) return s;   // English: no table
  const str = String(s);
  if (table[str] != null) return table[str];
  for (const p of patterns) {
    const m = str.match(p.re);
    if (m) return fill(table[p.k], Object.fromEntries(p.names.map((n, i) => [n, tx(m[i + 1])])));
  }
  return str;
}
export function setLang(l) {
  try { localStorage.setItem(KEY, LANGS[l] ? l : 'en'); } catch { /* private mode */ }
  location.reload();                                         // every module renders with the new table
}
// static HTML: elements with data-i18n (text), data-i18n-html (text with tags) or data-i18n-title / -aria /
// -placeholder (attributes) keep English in the markup and are translated once at start
export function translateDom(root = document) {
  if (LANG === 'en') return;
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.textContent.trim()); });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.innerHTML.trim().replace(/\s+/g, ' ')); });   // our own table only
  for (const a of ['title', 'aria-label', 'placeholder']) root.querySelectorAll(`[data-i18n-${a === 'aria-label' ? 'aria' : a}]`).forEach((el) => { el.setAttribute(a, t(el.getAttribute(a))); });
}
