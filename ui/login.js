// SPDX-License-Identifier: Apache-2.0
// The sign-in page (1.9): in public mode nothing else loads before a session. The PIN goes to the server once and
// is never kept in the browser; an Owner session in public mode then asks for the code sent to the Owner's Telegram.
import { t, tx } from './i18n.js';

const $ = (id) => document.getElementById(id);
try { document.documentElement.dataset.theme = localStorage.getItem('aisquad.theme') || 'light'; localStorage.removeItem('aisquad.pin'); } catch { /* private mode */ }
$('pinNote').textContent = t('Sign in with your PIN.'); $('pinGo').textContent = t('Sign in');
$('codeNote').textContent = t('We sent a 6-digit code to the Owner\'s Telegram.'); $('codeLabel').textContent = t('Code');
$('codeResend').textContent = t('Send again'); $('codeGo').textContent = t('Verify');

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  return { status: r.status, j: await r.json().catch(() => ({})) };
}
// 401: the wrong PIN or code; 429: a wait (in this language) or the lock (the server's words, translated)
const why = (r, wrong) => (r.status === 401 ? wrong : r.status === 429 && !r.j.locked ? t('Too many wrong PINs: try again in {n} minutes', { n: Math.max(1, Math.ceil((r.j.retryAfter || 60) / 60)) }) : tx(r.j.error) || t('Could not reach the server'));
const enter = () => location.replace('/' + location.hash);

$('loginForm').onsubmit = async (e) => {
  e.preventDefault();
  $('pinGo').disabled = true; $('pinErr').textContent = '';
  try {
    const r = await post('/api/session', { pin: $('pin').value.trim() });
    $('pin').value = '';
    if (r.status !== 200) { $('pinErr').textContent = why(r, t('Wrong PIN')); return; }
    if (r.j.secondFactor === 'sent') { $('loginForm').hidden = true; $('codeForm').hidden = false; $('code').focus(); return; }
    if (r.j.secondFactor === 'unavailable') { $('pinErr').textContent = t('The code could not be sent. Owner settings stay locked until it can.'); setTimeout(enter, 3500); return; }
    enter();
  } catch { $('pinErr').textContent = t('Could not reach the server'); } finally { $('pinGo').disabled = false; }
};
$('codeForm').onsubmit = async (e) => {
  e.preventDefault();
  $('codeGo').disabled = true; $('codeErr').textContent = '';
  try {
    const r = await post('/api/session/verify', { code: $('code').value.trim() });
    if (r.status === 200) return enter();
    $('codeErr').textContent = why(r, t('Wrong or expired code'));
  } catch { $('codeErr').textContent = t('Could not reach the server'); } finally { $('codeGo').disabled = false; }
};
$('codeResend').onclick = async () => {
  const r = await post('/api/session/code').catch(() => ({ status: 0, j: {} }));
  $('codeErr').textContent = r.status === 200 ? t('Code sent again') : tx(r.j.error) || t('Could not reach the server');
};
